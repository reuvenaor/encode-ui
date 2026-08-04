// Retrieval eval. Prints recall@1 / recall@5 / MRR@10 for four strategies over the
// labeled query set, so "hybrid is better" is a measured claim rather than an
// architectural assertion.
//
// The reference implementation had no eval at all, which is why nobody noticed its
// similarity scores were so weak that the threshold had to be silently dropped from
// 0.6 to 0.3 to keep returning anything.
//
// Run: npm run eval
import { loadCatalog } from '../src/catalog.ts'
import { openIndex, toVectorBlob } from '../src/db.ts'
import { embedQuery } from '../src/embed.ts'
import { createCatalogEngine } from '../src/engine-catalog.ts'
import { createWebEngine } from '../src/engine-web.ts'
import { search, toFtsQuery } from '../src/search.ts'
import { loadQueries } from './queries.ts'
import type { DB } from '../src/db.ts'
import type { EvalQuery } from './queries.ts'

const db = openIndex()
const queries = loadQueries(db)

// The zero-setup engine, exactly as the MCP serves it (committed artifact +
// curated keywords/aliases; no payloads dir — search never reads bodies).
const catalogEngine = createCatalogEngine(loadCatalog(), { registryRoot: null })

// The default web engine's naive filter, over the same committed artifact —
// search never fetches (only sourceOf does), so the eval stays offline; the
// throwing fetch is a tripwire in case that ever changes.
const webEngine = createWebEngine(loadCatalog(), {
  baseUrl: 'https://eval.invalid',
  indexSource: 'seed',
  fetchImpl: () => {
    throw new Error('eval is offline — web search must never fetch')
  },
})

/** Rank (1-based) of the first relevant item; 0 = not found. */
const rankOf = (names: readonly string[], expect: readonly string[]): number =>
  names.findIndex((n) => expect.includes(n)) + 1

interface Metrics {
  recall1: number
  recall5: number
  mrr10: number
  /** Share of forbid-carrying queries with a forbidden item in the top 5; null when none carry forbid. */
  violation5: number | null
  misses: { q: string; kind: string; expect: string[]; got: string[] }[]
  violations: { q: string; kind: string; name: string; rank: number }[]
}

function score(results: readonly { q: EvalQuery; names: string[] }[]): Metrics {
  let r1 = 0
  let r5 = 0
  let mrr = 0
  const misses: Metrics['misses'] = []
  // Rank metrics run over POSITIVES only: an absence query (expect: []) can
  // never rank a relevant item, so counting it would depress every strategy by
  // the same constant instead of measuring anything.
  const positives = results.filter(({ q }) => q.expect.length > 0)
  for (const { q, names } of positives) {
    const rank = rankOf(names, q.expect)
    if (rank === 1) r1++
    if (rank >= 1 && rank <= 5) r5++
    if (rank >= 1 && rank <= 10) mrr += 1 / rank
    if (rank === 0 || rank > 5)
      misses.push({ q: q.q, kind: q.kind, expect: q.expect, got: names.slice(0, 3) })
  }
  // Precision probes: any forbidden item surfacing in the top 5 is a violation,
  // counted once per query. This is the negation metric — recall cannot see a
  // wrong item RANKING, only a right item missing.
  const violations: Metrics['violations'] = []
  const withForbid = results.filter(({ q }) => (q.forbid?.length ?? 0) > 0)
  for (const { q, names } of withForbid) {
    const idx = names.slice(0, 5).findIndex((n) => q.forbid!.includes(n))
    if (idx >= 0) violations.push({ q: q.q, kind: q.kind, name: names[idx]!, rank: idx + 1 })
  }
  const n = positives.length
  return {
    recall1: r1 / n,
    recall5: r5 / n,
    mrr10: mrr / n,
    violation5: withForbid.length > 0 ? violations.length / withForbid.length : null,
    misses,
    violations,
  }
}

// ── strategy A: the site's current substring ladder (src/site-data/search-index.ts) ──
interface ItemRow {
  name: string
  title: string
  description: string
}
const allItems = db.prepare('SELECT name, title, description FROM items').all() as ItemRow[]

function substringLadder(query: string): string[] {
  const s = query.trim().toLowerCase()
  return allItems
    .map((i) => {
      const name = i.name.toLowerCase()
      const sc = name.startsWith(s)
        ? 1
        : name.includes(s)
          ? 0.8
          : i.title.toLowerCase().includes(s)
            ? 0.6
            : i.description.toLowerCase().includes(s)
              ? 0.3
              : 0
      return { name: i.name, sc }
    })
    .filter((r) => r.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .map((r) => r.name)
}

// ── strategy B: lexical only (FTS5 + BM25) ───────────────────────────────────
function lexicalOnlyRun(db: DB, query: string, k = 10): string[] {
  const match = toFtsQuery(query)
  if (!match) return []
  // bm25() is an FTS5 auxiliary function and cannot appear in an aggregate context.
  // A plain subquery does not help — SQLite flattens it back into the outer GROUP BY.
  // MATERIALIZED forces the CTE to be evaluated separately, so bm25 is scored while
  // still querying chunks_fts directly, and only then collapsed per item.
  const rows = db
    .prepare(
      `WITH m AS MATERIALIZED (
         SELECT chunk_id, bm25(chunks_fts, 3.0, 1.0) AS s
           FROM chunks_fts WHERE chunks_fts MATCH ?
       )
       SELECT c.item_name AS name, min(m.s) AS score
         FROM m JOIN chunks c ON c.id = m.chunk_id
        GROUP BY name ORDER BY score LIMIT ?`,
    )
    .all(match, k) as { name: string }[]
  return rows.map((r) => r.name)
}

// ── strategy C: dense only ───────────────────────────────────────────────────
async function denseOnlyRun(db: DB, query: string, k = 10): Promise<string[]> {
  const vec = await embedQuery(query)
  const rows = db
    .prepare(
      `SELECT c.item_name AS name FROM chunks_vec v JOIN chunks c ON c.id = v.chunk_id
        WHERE v.embedding MATCH ? AND k = ? ORDER BY distance`,
    )
    .all(toVectorBlob(vec), k * 4) as { name: string }[]
  return [...new Set(rows.map((r) => r.name))].slice(0, k)
}

// ── strategies: 4 headline + 3 facet ablations ───────────────────────────────
// The ablations answer a concrete cost question: the `code` facet is 76% of total
// embedding cost, so it has to earn that or be dropped.
const strategies: Record<string, { q: EvalQuery; names: string[] }[]> = {
  'substring (current site)': [],
  'web (naive filter)': [],
  'catalog (MiniSearch)': [],
  'lexical only (FTS5)': [],
  'dense only (Qwen3)': [],
  'hybrid + RRF': [],
  '  ablate: doc only': [],
  '  ablate: doc+demo': [],
  '  ablate: doc+code': [],
}

const hybridNames = async (q: string, facets?: string[]): Promise<string[]> =>
  (await search(db, q, facets ? { k: 10, facets } : { k: 10 })).hits.map((h) => h.name)

// The headline hybrid also records its top hit's absolute cosine — the absence
// calibration below is the data a weak-match threshold would need, and the
// numbers the tool description's guidance is calibrated from.
const hybridTop = new Map<string, { name: string; cosine: number | null } | undefined>()

const t0 = Date.now()
for (const q of queries) {
  strategies['substring (current site)']!.push({ q, names: substringLadder(q.q).slice(0, 10) })
  strategies['web (naive filter)']!.push({
    q,
    names: (await webEngine.search(q.q, { k: 10 })).hits.map((h) => h.name),
  })
  strategies['catalog (MiniSearch)']!.push({
    q,
    names: (await catalogEngine.search(q.q, { k: 10 })).hits.map((h) => h.name),
  })
  strategies['lexical only (FTS5)']!.push({ q, names: lexicalOnlyRun(db, q.q) })
  strategies['dense only (Qwen3)']!.push({ q, names: await denseOnlyRun(db, q.q) })
  const hybridHits = (await search(db, q.q, { k: 10 })).hits
  strategies['hybrid + RRF']!.push({ q, names: hybridHits.map((h) => h.name) })
  hybridTop.set(
    q.q,
    hybridHits[0] ? { name: hybridHits[0].name, cosine: hybridHits[0].cosine } : undefined,
  )
  strategies['  ablate: doc only']!.push({ q, names: await hybridNames(q.q, ['doc']) })
  strategies['  ablate: doc+demo']!.push({ q, names: await hybridNames(q.q, ['doc', 'demo']) })
  strategies['  ablate: doc+code']!.push({ q, names: await hybridNames(q.q, ['doc', 'code']) })
  process.stderr.write(`\reval ${strategies['hybrid + RRF']!.length}/${queries.length}`)
}
process.stderr.write('\n')

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const positiveCount = queries.filter((q) => q.expect.length > 0).length
console.log(
  `\n${queries.length} queries (${positiveCount} positive) · ${allItems.length} items · ${((Date.now() - t0) / 1000).toFixed(1)}s\n`,
)
console.log(
  `${'strategy'.padEnd(26)} ${'recall@1'.padStart(9)} ${'recall@5'.padStart(9)} ${'MRR@10'.padStart(8)} ${'viol@5'.padStart(8)}`,
)
console.log('─'.repeat(65))

const scored = new Map<string, Metrics>()
for (const [label, results] of Object.entries(strategies)) {
  const m = score(results)
  scored.set(label, m)
  const viol = m.violation5 === null ? '—' : pct(m.violation5)
  console.log(
    `${label.padEnd(26)} ${pct(m.recall1).padStart(9)} ${pct(m.recall5).padStart(9)} ${m.mrr10.toFixed(3).padStart(8)} ${viol.padStart(8)}`,
  )
}

const hybrid = scored.get('hybrid + RRF')!
console.log(`\n── hybrid misses (${hybrid.misses.length}) ──`)
for (const m of hybrid.misses) {
  console.log(`[${m.kind}] "${m.q}"\n    want ${m.expect.join('|')}   got ${m.got.join(', ')}`)
}

if (hybrid.violations.length > 0) {
  console.log(`\n── hybrid forbid violations (${hybrid.violations.length}) ──`)
  for (const v of hybrid.violations) {
    console.log(`[${v.kind}] "${v.q}"\n    forbidden ${v.name} at rank ${v.rank}`)
  }
}

// Per-kind breakdown for the headline strategy — the set stresses distinct
// failure modes, and one aggregate would hide a regression in any single one.
const hybridResults = strategies['hybrid + RRF']!
console.log('\n── hybrid by kind ──')
for (const kind of [...new Set(queries.map((q) => q.kind))]) {
  const subset = hybridResults.filter((r) => r.q.kind === kind)
  const n = String(subset.length).padStart(3)
  if (subset.every((r) => r.q.expect.length === 0)) {
    console.log(`${kind.padEnd(10)} n=${n}  (absence — see calibration below)`)
    continue
  }
  const m = score(subset)
  const viol = m.violation5 === null ? '' : `  viol@5 ${pct(m.violation5)}`
  console.log(
    `${kind.padEnd(10)} n=${n}  r@1 ${pct(m.recall1).padStart(6)}  r@5 ${pct(m.recall5).padStart(6)}  MRR ${m.mrr10.toFixed(3)}${viol}`,
  )
}

// The calibration a weak-match threshold would need: do absence queries and
// correctly-answered positives separate on the top hit's absolute cosine?
const absenceQueries = queries.filter((q) => q.kind === 'absence')
if (absenceQueries.length > 0) {
  console.log(`\n── absence calibration (hybrid top-1 cosine) ──`)
  const correctTops = hybridResults
    .filter(
      (r) => r.q.expect.length > 0 && r.names[0] !== undefined && r.q.expect.includes(r.names[0]),
    )
    .map((r) => hybridTop.get(r.q.q)?.cosine)
    .filter((c): c is number => typeof c === 'number')
  const absenceCos = absenceQueries
    .map((q) => hybridTop.get(q.q)?.cosine)
    .filter((c): c is number => typeof c === 'number')
  if (correctTops.length === 0 || absenceCos.length === 0) {
    console.log('unscored — no cosines recorded (lexical-only mode?)')
  } else {
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    const minCorrect = Math.min(...correctTops)
    const overlap = absenceCos.filter((c) => c >= minCorrect).length
    console.log(
      `correct-positive top-1: mean ${mean(correctTops).toFixed(3)} · min ${minCorrect.toFixed(3)} (n=${correctTops.length})`,
    )
    console.log(
      `absence top-1:          mean ${mean(absenceCos).toFixed(3)} · max ${Math.max(...absenceCos).toFixed(3)} (n=${absenceCos.length})`,
    )
    console.log(
      `overlap: ${overlap}/${absenceCos.length} absence tops ≥ the correct-positive minimum`,
    )
    for (const q of absenceQueries) {
      const t = hybridTop.get(q.q)
      const cos = typeof t?.cosine === 'number' ? t.cosine.toFixed(3) : '  —  '
      console.log(`  ${cos}  "${q.q}" → ${t?.name ?? '(no hits)'}`)
    }
  }
}

// The gate: hybrid must beat every SINGLE-SIGNAL strategy (ablations excluded —
// they are variants of hybrid, not competitors to it). The catalog engine is
// IN the gate deliberately: if the zero-setup lexical path ever out-recalls
// the semantic index, that is a finding worth a red build.
const singleSignal = [...scored]
  .filter(([l]) => l !== 'hybrid + RRF' && !l.startsWith('  ablate'))
  .map(([, m]) => m.recall5)
const bestSingle = Math.max(...singleSignal)
const ok = hybrid.recall5 >= bestSingle
console.log(
  `\n${ok ? '✅' : '❌'} hybrid recall@5 ${pct(hybrid.recall5)} vs best single-signal ${pct(bestSingle)}`,
)

// Does the `code` facet earn its 76% share of embedding cost?
// Judged on MRR@10 and recall@1, NOT recall@5 — recall@5 saturates at 100% on this
// set, so it cannot discriminate between configurations that differ in ORDERING.
const docDemo = scored.get('  ablate: doc+demo')!
const dMrr = hybrid.mrr10 - docDemo.mrr10
const dR1 = hybrid.recall1 - docDemo.recall1
const worth = dMrr > 0.02 || dR1 > 0.02
console.log(
  `   code facet vs doc+demo: MRR ${dMrr >= 0 ? '+' : ''}${(dMrr * 100).toFixed(1)}pp, ` +
    `recall@1 ${dR1 >= 0 ? '+' : ''}${(dR1 * 100).toFixed(1)}pp ` +
    `(costs ~76% of build time) → ${worth ? 'KEEP' : 'consider dropping'}`,
)

db.close()
if (!ok) process.exit(1)
