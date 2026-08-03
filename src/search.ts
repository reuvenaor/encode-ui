// Hybrid retrieval: dense (vec0 exact KNN) + lexical (FTS5/BM25), fused with
// Reciprocal Rank Fusion, collapsed to items.
//
// RRF is rank-based on purpose. The reference implementation fused by raw score and
// stamped every keyword hit with `similarity: 1.0`, so any lexical match outranked
// every genuine vector hit — a whole retrieval arm silently disabled. Ranks have no
// scale to reconcile, so that failure mode cannot occur here.
import { lexicalOnly } from './config.ts'
import { knnCeiling, l2ToCosine, openIndex, toVectorBlob } from './db.ts'
import { embedQuery } from './embed.ts'
import { DEFAULT_K } from './engine.ts'
import {
  ITEM_SUMMARY_PROJECTION,
  MAX_CHUNKS_PER_ITEM,
  dependencyClosure,
  fetchSummaries,
  itemColumns,
  itemFilterSql,
  toSearchHit,
} from './items.ts'
import type { DB } from './db.ts'
import type { ItemFilters, ItemSummaryRow, SearchHit } from './items.ts'

export interface SearchOptions extends ItemFilters {
  k?: number
  /** Candidate depth per arm before fusion. */
  poolSize?: number
  /**
   * Restrict both arms to a subset of facets. Used by the eval to ablate a facet
   * and check it earns its keep — `code` alone is 76% of total embedding cost.
   */
  facets?: readonly string[]
  /**
   * true = only transitively dependency-free items; false = only dep-carrying.
   * Resolved into an ItemFilters.names IN-list (the closure is computed, not a
   * column), so both arms still pre-filter and ranking is untouched.
   */
  dependencyFree?: boolean
}

export interface SearchResult {
  hits: SearchHit[]
  /** True when the embedding model was unavailable and only lexical ran. */
  degraded: boolean
}

export interface Ranked {
  chunkId: number
  itemName: string
  facet: string
  /** vec0 L2 distance — present only on dense-arm rows. */
  distance?: number
}

/**
 * Fusion constants — swept, not guessed (`eval/sweep.ts`, 52 labeled queries):
 *
 *   config                            r@1     r@5     MRR@10
 *   dense only                       86.5%   100.0%   0.925
 *   k=60 wLex=1.00  (textbook RRF)   78.8%    98.1%   0.870   ← loses to dense alone
 *   k=10 wLex=0.25  (shipped)        90.4%   100.0%   0.943
 *
 * Two corrections to the obvious defaults:
 *
 * 1. `k = 10`, not the canonical 60. The 60 in the original RRF paper suits large
 *    candidate pools; over a 40-candidate pool it compresses every rank into a
 *    narrow 1/61…1/100 band and throws away the ordering signal.
 *
 * 2. Lexical is a TIEBREAKER at 0.25, not a co-equal arm. Once the `code` and `demo`
 *    facets exist, dense retrieval already handles exact names (they contain the
 *    literal token), so an equal-weight lexical arm mostly injects noise — at w=1.0
 *    with a 3x name boost it pulled `reveal-text`/`toggle` above `password-input`
 *    for "obscured text entry with a reveal toggle". Down-weighted it still earns
 *    +3.9pp recall@1, and it remains the whole retrieval path in degraded mode.
 *
 * Caveat: recall@5 is at a ceiling (100%) on a 52-query set the author wrote, so
 * recall@1 and MRR are the metrics that discriminate here. Re-run the sweep after
 * any material change to the corpus or facets.
 */
export const RRF_K = 10
export const WEIGHT_DENSE = 1
export const WEIGHT_LEXICAL = 0.25

/** bm25 column weights: (name, text). Boosting `name` no longer pays — see above. */
const BM25_NAME_WEIGHT = 1.0
const BM25_TEXT_WEIGHT = 1.0

/**
 * DEFAULT_K/MAX_K live in engine.ts now (the engine contract shared with the
 * catalog engine) so mcp/schemas.ts can read them without this module's native
 * import chain. Re-exported here for the existing importers (tests, eval).
 */
export { DEFAULT_K, MAX_K } from './engine.ts'

/**
 * Candidate CHUNKS per arm before fusion. Table-derived, then swept: the value
 * comes from the filtered-recovery measurements in docs/mcp-hardening-plan.md
 * §2.2/§7.2, and eval/sweep.ts sweeps pool ∈ [20, 40, 60, 100] — re-run it
 * before changing this.
 *
 * Note the unit mismatch that used to be a bug: the pool counts chunks, `k` counts
 * items. At up to MAX_CHUNKS_PER_ITEM chunks each, a 40-chunk pool cannot express
 * 25 items, so `k=25` silently returned fewer. See poolFor().
 */
const DEFAULT_POOL = 40

/**
 * With the predicates pushed into SQL and the pool at least `k × MAX_CHUNKS_PER_ITEM`
 * chunks deep, the ONLY way search() returns fewer than `k` hits is that fewer than
 * `k` items in the index satisfy the filters at all.
 */
const poolFor = (k: number, requested?: number): number =>
  Math.max(requested ?? DEFAULT_POOL, k * MAX_CHUNKS_PER_ITEM)

/**
 * FTS5 MATCH is a query language, not a string: bare user input containing a quote,
 * `*`, `^`, `-`, or a bareword like `AND`/`NEAR` either throws or silently changes
 * meaning. Reduce to quoted terms OR'd together, which is the behaviour a search box
 * implies. Hyphenated input is also split, so "magnetic-button" matches the
 * de-hyphenated form indexed in `ftsName`.
 */
export function toFtsQuery(raw: string): string {
  const terms = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
  if (terms.length === 0) return ''
  return [...new Set(terms)].map((t) => `"${t}"`).join(' OR ')
}

/** SQL fragment + params for an optional facet restriction. */
function facetFilter(facets: readonly string[] | undefined): { sql: string; params: string[] } {
  if (!facets || facets.length === 0) return { sql: '', params: [] }
  return { sql: ` AND c.facet IN (${facets.map(() => '?').join(',')})`, params: [...facets] }
}

/**
 * Both arms restrict on the SAME predicates, in SQL, before fusion.
 *
 * They used to be applied afterwards, over an already-ranked pool, which threw
 * away retrieved candidates: `{group:'forms', k:25}` returned 17 of the 31 items
 * forms actually holds. Worse, an UNKNOWN slug filtered everything out and
 * rendered as "No matching components" — an empty answer standing in for a wrong
 * question. The item join is emitted only when there is something to filter on.
 */
const itemJoin = (needed: boolean): string => (needed ? 'JOIN items i ON i.name = c.item_name' : '')

/**
 * Exported for eval/sweep.ts, which used to re-implement this arm with a
 * different SQL shape — its numbers then described a similar algorithm, not the
 * shipped one. `nameBoost` is the one knob the sweep varies; production always
 * uses BM25_NAME_WEIGHT.
 */
export function lexicalArm(
  db: DB,
  query: string,
  limit: number,
  facets: readonly string[] | undefined,
  filters: ItemFilters,
  nameBoost: number = BM25_NAME_WEIGHT,
): Ranked[] {
  const match = toFtsQuery(query)
  if (!match) return []
  const facet = facetFilter(facets)
  const item = itemFilterSql(filters)
  return db
    .prepare(
      `SELECT f.chunk_id AS chunkId, c.item_name AS itemName, c.facet AS facet
         FROM chunks_fts f
         JOIN chunks c ON c.id = f.chunk_id
         ${itemJoin(item.params.length > 0)}
        WHERE chunks_fts MATCH ?${facet.sql}${item.sql}
        ORDER BY bm25(chunks_fts, ${nameBoost}, ${BM25_TEXT_WEIGHT})
        LIMIT ?`,
    )
    .all(match, ...facet.params, ...item.params, limit) as Ranked[]
}

/** Exported for eval/sweep.ts — takes the query VECTOR, so embed-once caching works. */
export function denseArm(
  db: DB,
  vector: readonly number[],
  limit: number,
  facets: readonly string[] | undefined,
  filters: ItemFilters,
): Ranked[] {
  const facet = facetFilter(facets)
  const item = itemFilterSql(filters)
  // `k` is a vec0 constraint evaluated BEFORE the joins, so anything filtered
  // afterwards prunes rows out of an already-capped set. Rank the whole corpus
  // (vec0 computes every distance anyway) and let SQL do the filtering, then LIMIT.
  return db
    .prepare(
      `SELECT v.chunk_id AS chunkId, c.item_name AS itemName, c.facet AS facet,
              v.distance AS distance
         FROM chunks_vec v
         JOIN chunks c ON c.id = v.chunk_id
         ${itemJoin(item.params.length > 0)}
        WHERE v.embedding MATCH ? AND k = ?${facet.sql}${item.sql}
        ORDER BY v.distance
        LIMIT ?`,
    )
    .all(toVectorBlob(vector), knnCeiling(db), ...facet.params, ...item.params, limit) as Ranked[]
}

/**
 * Weighted Reciprocal Rank Fusion, accumulated per ITEM across its chunks — an item
 * whose doc AND code AND demo all rank is genuinely stronger evidence than one that
 * matched on a single facet.
 *
 * Also carries the smallest dense distance seen per item (null when no dense row
 * ranked it), so the caller can report an ABSOLUTE similarity beside the
 * rank-derived score — RRF magnitudes cannot say "nothing here matches"; a cosine
 * can.
 *
 * `rrfK` is parameterized for eval/sweep.ts (which sweeps it); production always
 * fuses at the shipped RRF_K.
 */
export function fuse(
  arms: readonly { label: string; weight: number; rows: readonly Ranked[] }[],
  rrfK: number = RRF_K,
): Map<string, { score: number; facets: Set<string>; minDistance: number | null }> {
  const acc = new Map<string, { score: number; facets: Set<string>; minDistance: number | null }>()
  for (const { label, weight, rows } of arms) {
    rows.forEach((row, i) => {
      const entry = acc.get(row.itemName) ?? {
        score: 0,
        facets: new Set<string>(),
        minDistance: null,
      }
      entry.score += weight / (rrfK + i + 1)
      entry.facets.add(`${row.facet}:${label}`)
      if (row.distance !== undefined) {
        entry.minDistance =
          entry.minDistance === null ? row.distance : Math.min(entry.minDistance, row.distance)
      }
      acc.set(row.itemName, entry)
    })
  }
  return acc
}

export async function search(
  db: DB,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const k = opts.k ?? DEFAULT_K
  const pool = poolFor(k, opts.poolSize)
  const deps = dependencyClosure(db)
  const filters: ItemFilters = {
    ...(opts.group !== undefined ? { group: opts.group } : {}),
    ...(opts.type !== undefined ? { type: opts.type } : {}),
    ...(opts.motion !== undefined ? { motion: opts.motion } : {}),
    ...(opts.dependencyFree !== undefined
      ? {
          names: [...deps.entries()]
            .filter(([, info]) => info.pure === opts.dependencyFree)
            .map(([name]) => name),
        }
      : {}),
  }

  const lexical = lexicalArm(db, query, pool, opts.facets, filters)

  let dense: Ranked[] = []
  let degraded = lexicalOnly()
  if (!degraded) {
    try {
      dense = denseArm(db, await embedQuery(query), pool, opts.facets, filters)
    } catch (err) {
      // The model is optional at runtime: a missing download or an offline machine
      // degrades to lexical rather than failing the tool call outright.
      process.stderr.write(
        `[encode-ui-rag] dense arm unavailable, lexical only: ${(err as Error).message}\n`,
      )
      degraded = true
    }
  }

  const fused = fuse([
    { label: 'semantic', weight: WEIGHT_DENSE, rows: dense },
    // In degraded mode lexical is the ONLY arm, so it must carry full weight there —
    // otherwise every result is uniformly scaled down and the ordering is unchanged
    // but the scores become meaningless to a caller comparing them.
    { label: 'lexical', weight: degraded ? WEIGHT_DENSE : WEIGHT_LEXICAL, rows: lexical },
  ])

  // Both arms already applied the filters, so every fused entry is a real hit —
  // take the top k and fetch their rows in ONE statement. No post-filter loop:
  // one here would only mask a mistake in the SQL above.
  const ranked = [...fused].sort((a, b) => b[1].score - a[1].score).slice(0, k)
  const rows = fetchSummaries(
    db,
    ranked.map(([name]) => name),
  )

  const hits = ranked.flatMap(([name, { score, facets, minDistance }]) => {
    const row = rows.get(name)
    if (!row) return []
    const cosine = minDistance === null ? null : l2ToCosine(minDistance)
    return [toSearchHit(row, score, [...facets].sort(), cosine, deps.get(name)?.pure ?? false)]
  })

  return { hits, degraded }
}

/**
 * Neighbours of a known item, straight from the stored doc vector — needs no query
 * embedding, so it works before the model is ever downloaded.
 */
export function findSimilar(db: DB, name: string, k = DEFAULT_K): SearchHit[] {
  const seed = db
    .prepare(
      `SELECT v.embedding AS embedding FROM chunks_vec v
         JOIN chunks c ON c.id = v.chunk_id
        WHERE c.item_name = ? AND c.facet = 'doc'`,
    )
    .get(name) as { embedding: Buffer } | undefined
  if (!seed) return []

  // Same shape as the dense arm above: `k` is a vec0 constraint evaluated BEFORE
  // the joins, so rank the whole corpus and let SQL prune. The seed is excluded
  // in SQL rather than filtered out afterwards, so LIMIT k returns exactly k.
  //
  // This replaces an over-fetch of (k + 1) * 4 — enough today for all 173 seeds,
  // but a guess with no bound behind it, and the reason `slice(0, k)` could
  // silently under-return once the corpus or the facet count shifted.
  const rows = db
    .prepare(
      `SELECT ${itemColumns(ITEM_SUMMARY_PROJECTION)}, v.distance AS distance
         FROM chunks_vec v
         JOIN chunks c ON c.id = v.chunk_id
         JOIN items  i ON i.name = c.item_name
        WHERE v.embedding MATCH ? AND k = ?
          AND c.facet = 'doc'
          AND c.item_name <> ?
        ORDER BY v.distance
        LIMIT ?`,
    )
    .all(seed.embedding, knnCeiling(db), name, k) as (ItemSummaryRow & { distance: number })[]

  const deps = dependencyClosure(db)
  return rows.map((r) => {
    const cosine = l2ToCosine(r.distance)
    return toSearchHit(r, cosine, ['doc:similar'], cosine, deps.get(r.name)?.pure ?? false)
  })
}

export { openIndex }
export type { SearchHit }
