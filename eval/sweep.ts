// Parameter sweep for the fusion. Answers, with numbers rather than intuition:
// does a WEIGHTED RRF beat dense-only, and at what dense/lexical weight, RRF k,
// FTS5 name boost, and candidate pool? Equal-weight RRF measurably loses to
// dense-only on this corpus.
//
// The sweep consumes the REAL retrieval arms and fusion exported by search.ts.
// It used to re-implement all three (a different vec0 `k`, a different FTS
// shape, its own fuse), so its numbers described a similar algorithm rather
// than the shipped one — and it held the pool constant while search.ts claimed
// the pool had been swept.
//
// Run: node --experimental-strip-types eval/sweep.ts
import { openIndex } from '../src/db.ts'
import { embedQuery } from '../src/embed.ts'
import { denseArm, fuse, lexicalArm } from '../src/search.ts'
import { loadQueries } from './queries.ts'
import type { Ranked } from '../src/search.ts'

const db = openIndex()
// Positives only: absence queries (expect: []) can never rank a relevant item,
// so they would depress every configuration by the same constant.
const queries = loadQueries(db).filter((q) => q.expect.length > 0)

// Embed every query once; the sweep is pure re-ranking after that.
const qVecs = new Map<string, number[]>()
for (const q of queries) {
  qVecs.set(q.q, await embedQuery(q.q))
  process.stderr.write(`\rembedding queries ${qVecs.size}/${queries.length}`)
}
process.stderr.write('\n')

const denseCache = new Map<string, Ranked[]>()
const lexCache = new Map<string, Ranked[]>()

function dense(q: string, pool: number): Ranked[] {
  const key = `${pool}::${q}`
  const hit = denseCache.get(key)
  if (hit) return hit
  const rows = denseArm(db, qVecs.get(q)!, pool, undefined, {})
  denseCache.set(key, rows)
  return rows
}

function lexical(q: string, nameBoost: number, pool: number): Ranked[] {
  const key = `${pool}::${nameBoost}::${q}`
  const hit = lexCache.get(key)
  if (hit) return hit
  const rows = lexicalArm(db, q, pool, undefined, {}, nameBoost)
  lexCache.set(key, rows)
  return rows
}

/** Fused-and-collapsed item names, best first — through the real fuse(). */
function rank(q: string, rrfK: number, wl: number, nb: number, pool: number): string[] {
  const fused = fuse(
    [
      { label: 'semantic', weight: 1, rows: dense(q, pool) },
      { label: 'lexical', weight: wl, rows: lexical(q, nb, pool) },
    ],
    rrfK,
  )
  return [...fused].sort((a, b) => b[1].score - a[1].score).map(([n]) => n)
}

function measure(rankFor: (q: string) => string[]): { r1: number; r5: number; mrr: number } {
  let r1 = 0
  let r5 = 0
  let mrr = 0
  for (const { q, expect } of queries) {
    const names = rankFor(q).slice(0, 10)
    const r = names.findIndex((n) => expect.includes(n)) + 1
    if (r === 1) r1++
    if (r >= 1 && r <= 5) r5++
    if (r >= 1 && r <= 10) mrr += 1 / r
  }
  const n = queries.length
  return { r1: r1 / n, r5: r5 / n, mrr: mrr / n }
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
const base = measure((q) => [...new Set(dense(q, 40).map((r) => r.itemName))])
console.log(
  `\nbaseline dense-only     r@1 ${pct(base.r1)}  r@5 ${pct(base.r5)}  MRR ${base.mrr.toFixed(3)}\n`,
)

const rows: { label: string; r1: number; r5: number; mrr: number }[] = []
for (const pool of [20, 40, 60, 100]) {
  for (const rrfK of [10, 20, 60]) {
    for (const wl of [0, 0.25, 0.5, 1]) {
      for (const nb of [1.0, 3.0]) {
        const m = measure((q) => rank(q, rrfK, wl, nb, pool))
        rows.push({
          label: `k=${String(rrfK).padStart(2)} wLex=${wl.toFixed(2)} nb=${nb.toFixed(1)} pool=${String(pool).padStart(3)}`,
          ...m,
        })
      }
    }
  }
}

// MRR first — recall@5 saturates on this set and cannot discriminate (README).
rows.sort((a, b) => b.mrr - a.mrr || b.r1 - a.r1 || b.r5 - a.r5)
console.log(`${'config'.padEnd(38)} ${'r@1'.padStart(7)} ${'r@5'.padStart(7)} ${'MRR'.padStart(7)}`)
console.log('─'.repeat(64))
for (const r of rows.slice(0, 12)) {
  const win = r.mrr > base.mrr ? ' ←' : ''
  console.log(
    `${r.label.padEnd(38)} ${pct(r.r1).padStart(7)} ${pct(r.r5).padStart(7)} ${r.mrr.toFixed(3).padStart(7)}${win}`,
  )
}
db.close()
