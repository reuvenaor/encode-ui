// What an item IS, in each of its three representations, and the SQL that maps
// between them:
//
//   Item            — the rich ingest-time shape, built from public/r/*.json
//   ItemSummaryRow  — the 9 columns retrieval needs (search + find_similar)
//   ItemDetailRow   — the 17 columns get_component renders
//   SearchHit       — the API-facing projection handed to callers
//
// Before this module the summary projection was written twice in search.ts, its
// row shape twice more as inline type assertions, and the row → SearchHit mapper
// twice verbatim; get_component read a third, larger projection into
// Record<string, unknown> and cast its way out ~15 times.
//
// db.ts is imported TYPE-ONLY (erased under verbatimModuleSyntax), so the only
// runtime imports here are registry-id.ts and the pure string helpers in
// text.ts — this file owns the SQL yet is unit-testable against an in-memory
// database with no setup.
import { suggestFromNames } from './engine.ts'
import type { DB } from './db.ts'

/** The ingest-time shape: one built registry payload, fully resolved. */
export interface Item {
  name: string
  type: string
  title: string
  description: string
  groupSlug: string | null
  groupLabel: string | null
  categories: string[]
  dependencies: string[]
  registryDeps: string[]
  /** Post-install setup the payload cannot perform itself (shadcn's `docs` field). */
  docs: string | null
  provenance: string | null
  sourceUrl: string | null
  license: string | null
  motion: boolean
  filePath: string | null
  source: string | null
  /** The `*.parts.tsx` sibling's path, or null for a single-file item. */
  partsFilePath: string | null
  /** Its source. `files[0]` IMPORTS this module, so it is embedded into the
   *  `code` facet for retrieval AND served alongside `source` — handing back
   *  files[0] alone yields a file with a dangling `./<name>.parts` import. */
  partsSource: string | null
  demoSource: string | null
  installCmd: string
  docUrl: string
}

/** One ranked result, as returned by search() and findSimilar(). */
export interface SearchHit {
  name: string
  title: string
  description: string
  group: string | null
  type: string
  installCmd: string
  docUrl: string
  score: number
  /**
   * Best dense-arm cosine behind the hit — an ABSOLUTE similarity, comparable
   * across searches (the rank-derived `score` is not). Null = no dense evidence:
   * degraded mode, a lexical-only match, or outside the dense candidate pool.
   */
  cosine: number | null
  /** Which facet(s) carried this item — 'doc' | 'code' | 'demo', and how it was found. */
  matchedOn: string[]
  provenance: string | null
  motion: boolean
  /** Transitively dependency-free — pure React + Tailwind (see dependencyClosure). */
  pure: boolean
}

// ── row shapes ───────────────────────────────────────────────────────────────

/** `motion` is the raw SQLite INTEGER — converted to boolean in exactly one place. */
export interface ItemSummaryRow {
  name: string
  title: string
  description: string
  grp: string | null
  type: string
  installCmd: string
  docUrl: string
  provenance: string | null
  motion: number
}

export interface ItemDetailRow extends ItemSummaryRow {
  /** Human label for `grp`. Selected so get_component can report both, rather
   *  than printing a slug where list_groups prints a label. */
  groupLabel: string | null
  categories: string
  dependencies: string
  registryDeps: string
  /** Post-install setup the payload cannot perform itself (shadcn's `docs` field). */
  docs: string | null
  sourceUrl: string | null
  license: string | null
  filePath: string | null
  source: string | null
  partsFilePath: string | null
  partsSource: string | null
  demoSource: string | null
}

// ── projections ──────────────────────────────────────────────────────────────
//
// alias → column. The `satisfies` clause is the point: a missing or misspelled
// alias becomes a COMPILE error against the row interface, which is the drift
// these projections exist to prevent. It costs nothing at runtime and declares no
// unused local (noUnusedLocals is on).

export const ITEM_SUMMARY_PROJECTION = {
  name: 'name',
  title: 'title',
  description: 'description',
  grp: 'group_slug',
  type: 'type',
  installCmd: 'install_cmd',
  docUrl: 'doc_url',
  provenance: 'provenance',
  motion: 'motion',
} as const satisfies Record<keyof ItemSummaryRow, string>

export const ITEM_DETAIL_PROJECTION = {
  ...ITEM_SUMMARY_PROJECTION,
  groupLabel: 'group_label',
  categories: 'categories',
  dependencies: 'dependencies',
  registryDeps: 'registry_deps',
  docs: 'docs',
  sourceUrl: 'source_url',
  license: 'license',
  filePath: 'file_path',
  source: 'source',
  partsFilePath: 'parts_file_path',
  partsSource: 'parts_source',
  demoSource: 'demo_source',
} as const satisfies Record<keyof ItemDetailRow, string>

/** `i.group_slug AS grp, i.type AS type, …` for the given alias. */
export const itemColumns = (projection: Readonly<Record<string, string>>, alias = 'i'): string =>
  Object.entries(projection)
    .map(([as, col]) => `${alias}.${col} AS ${as}`)
    .join(', ')

/**
 * Guaranteed by schema.sql: `CHECK (facet IN ('doc','code','demo'))` plus the
 * UNIQUE index on (item_name, facet). Load-bearing — the retrieval pool is sized
 * in chunks while `k` counts items, so `k × this` is a provable lower bound of
 * `k` distinct items per arm.
 */
export const MAX_CHUNKS_PER_ITEM = 3

// ── mapping ──────────────────────────────────────────────────────────────────

/** THE row → SearchHit mapping, and the only place `motion === 1` is decided. */
export const toSearchHit = (
  row: ItemSummaryRow,
  score: number,
  matchedOn: readonly string[],
  cosine: number | null,
  pure: boolean,
): SearchHit => ({
  name: row.name,
  title: row.title,
  description: row.description,
  group: row.grp,
  type: row.type,
  installCmd: row.installCmd,
  docUrl: row.docUrl,
  provenance: row.provenance,
  motion: row.motion === 1,
  score: +score.toFixed(6),
  cosine: cosine === null ? null : +cosine.toFixed(6),
  matchedOn: [...matchedOn],
  pure,
})

/**
 * `items.dependencies` / `registry_deps` / `categories` are JSON arrays in TEXT
 * columns — the one thing a STRICT table cannot constrain. openIndex() can be
 * pointed at any file (--registry-index on the server; ENCODE_UI_RAG_INDEX on
 * the build CLIs), so a stale or hand-edited index is reachable; degrade to []
 * rather than throwing a bare `Unexpected token` out of a tool call.
 */
export function jsonStringList(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

// ── dependency closure ───────────────────────────────────────────────────────

/**
 * Substrate never counted as a dependency: `shadcn init` writes lib/utils with
 * clsx + tailwind-merge, and class-variance-authority + radix-ui arrive with the
 * first shadcn/ui primitive a consumer installs (button, dialog, …) — counting
 * either pair would measure the shadcn substrate, not the item's own weight. MUST
 * stay in lockstep with the site's layer (src/site-data/dependencies.ts) and the
 * build-time port in scripts/build-agent-index.mjs — one doctrine, three
 * implementations.
 */
const BASELINE_NPM = new Set(['clsx', 'tailwind-merge', 'class-variance-authority', 'radix-ui'])

export interface DependencyInfo {
  /** Transitively dependency-free — pure React + Tailwind tokens. */
  readonly pure: boolean
  /** npm closure over the whole @encode-ui composition tree, sorted. */
  readonly transitiveDependencies: readonly string[]
}

/** The storage-agnostic input to computeDependencyClosure — arrays, not JSON text. */
export interface DependencyRow {
  name: string
  dependencies: readonly string[]
  registryDependencies: readonly string[]
}

/**
 * THE closure algorithm, pure so both engines share it: the db engine feeds it
 * parsed rows (dependencyClosure below), the catalog engine's build-time
 * generator ports it to .mjs and a test pins the two against each other over
 * the real artifact. Direct-only would lie — metrics-01 declares one dep but
 * composes line-chart, which pulls recharts.
 *
 * A registryDependencies cycle THROWS, naming the path: composition must be a
 * DAG (shadcn installs it as one), and the previous silent guard memoized the
 * empty set at the back-edge — every member of a cycle would have shipped
 * `pure: true` with no dependencies, quietly. With the throw, every memo
 * entry is provably a COMPLETED computation.
 */
export function computeDependencyClosure(
  rows: readonly DependencyRow[],
): Map<string, DependencyInfo> {
  const byName = new Map(rows.map((r) => [r.name, r]))
  const memo = new Map<string, Set<string>>()
  const bare = (dep: string) => dep.replace(/^@[^/]+\//, '')

  const closure = (name: string, trail: Set<string>): Set<string> => {
    const hit = memo.get(name)
    if (hit) return hit
    const row = byName.get(name)
    const acc = new Set<string>()
    if (row) {
      if (trail.has(name)) {
        throw new Error(
          `registryDependencies cycle: ${[...trail, name].join(' → ')} — ` +
            'composition must be acyclic; fix the manifest',
        )
      }
      trail.add(name)
      for (const dep of row.dependencies) {
        if (!BASELINE_NPM.has(dep)) acc.add(dep)
      }
      for (const edge of row.registryDependencies) {
        for (const dep of closure(bare(edge), trail)) acc.add(dep)
      }
      trail.delete(name)
    }
    memo.set(name, acc)
    return acc
  }

  return new Map(
    rows.map((r) => {
      const transitiveDependencies = [...closure(r.name, new Set())].sort()
      return [r.name, { pure: transitiveDependencies.length === 0, transitiveDependencies }]
    }),
  )
}

/**
 * Transitive npm closure over `registry_deps` composition edges, from columns
 * the index already stores. Recomputed per call: 200 items, sub-millisecond,
 * and no schema change.
 */
export function dependencyClosure(db: DB): Map<string, DependencyInfo> {
  const rows = db
    .prepare('SELECT name, dependencies, registry_deps AS registryDeps FROM items')
    .all() as { name: string; dependencies: string; registryDeps: string }[]
  return computeDependencyClosure(
    rows.map((r) => ({
      name: r.name,
      dependencies: jsonStringList(r.dependencies),
      registryDependencies: jsonStringList(r.registryDeps),
    })),
  )
}

// ── filtering ────────────────────────────────────────────────────────────────

export interface ItemFilters {
  group?: string
  type?: string
  motion?: boolean
  /**
   * Restrict to an explicit name set — how the computed dependency-free filter
   * reaches the SQL arms (the closure is derived, not a column, so an IN-list is
   * the only way to keep the "both arms pre-filter" invariant).
   */
  names?: readonly string[]
}

/**
 * SQL fragment + params for the caller-supplied item filters, so both retrieval
 * arms can apply them BEFORE fusion instead of discarding already-ranked
 * candidates afterwards.
 *
 * A plain JS `1` binds correctly against the STRICT `items.motion INTEGER` column;
 * the BigInt rule in db.ts is specific to vec0 primary keys, not general.
 */
export function itemFilterSql(
  f: ItemFilters,
  alias = 'i',
): { sql: string; params: (string | number)[] } {
  const parts: string[] = []
  const params: (string | number)[] = []
  if (f.group !== undefined) {
    parts.push(`${alias}.group_slug = ?`)
    params.push(f.group)
  }
  if (f.type !== undefined) {
    parts.push(`${alias}.type = ?`)
    params.push(f.type)
  }
  if (f.motion !== undefined) {
    parts.push(`${alias}.motion = ?`)
    params.push(f.motion ? 1 : 0)
  }
  if (f.names !== undefined) {
    if (f.names.length === 0) {
      // An empty allow-list means "nothing qualifies" — not "no filter".
      parts.push('1 = 0')
    } else {
      parts.push(`${alias}.name IN (${f.names.map(() => '?').join(',')})`)
      params.push(...f.names)
    }
  }
  return { sql: parts.length > 0 ? ` AND ${parts.join(' AND ')}` : '', params }
}

// ── queries ──────────────────────────────────────────────────────────────────

/**
 * Summaries for a set of names, in ONE statement.
 *
 * Was an N+1: the collapse loop ran a single-row lookup per fused entry, and
 * because the filters were applied inside that loop it iterated the whole fused
 * set — 60-80 lookups per filtered search rather than k.
 */
export function fetchSummaries(db: DB, names: readonly string[]): Map<string, ItemSummaryRow> {
  if (names.length === 0) return new Map()
  const rows = db
    .prepare(
      `SELECT ${itemColumns(ITEM_SUMMARY_PROJECTION)}
         FROM items i WHERE i.name IN (${names.map(() => '?').join(',')})`,
    )
    .all(...names) as ItemSummaryRow[]
  return new Map(rows.map((r) => [r.name, r]))
}

/** The full detail row behind get_component. */
export function fetchDetail(db: DB, name: string): ItemDetailRow | undefined {
  return db
    .prepare(`SELECT ${itemColumns(ITEM_DETAIL_PROJECTION)} FROM items i WHERE i.name = ?`)
    .get(name) as ItemDetailRow | undefined
}

export const knownNames = (db: DB): Set<string> =>
  new Set((db.prepare('SELECT name FROM items').all() as { name: string }[]).map((r) => r.name))

/** Group slugs actually present in the index — the valid values for the filter. */
export const groupSlugs = (db: DB): Set<string> =>
  new Set(
    (
      db
        .prepare('SELECT DISTINCT group_slug AS slug FROM items WHERE group_slug IS NOT NULL')
        .all() as { slug: string }[]
    ).map((r) => r.slug),
  )

/**
 * THE list_groups query: every group, from one statement. Themes used to be
 * excluded and re-added as a hardcoded row, because their label was missing
 * from the taxonomy and group_label held the raw slug; the label now exists at
 * the source, so there is nothing to synthesise. Themes sort last regardless
 * of size — they are palette data, not components, and a component search
 * wants components first — keyed on the registry type rather than the slug
 * string (the ordering the engine contract's orderGroups mirrors).
 */
export function listGroupRows(db: DB): { slug: string; label: string; count: number }[] {
  const rows = db
    .prepare(
      `SELECT group_slug AS slug, group_label AS label, count(*) AS count,
              max(type = 'registry:theme') AS isTheme
         FROM items WHERE group_slug IS NOT NULL
        GROUP BY group_slug
        ORDER BY isTheme, count DESC, slug`,
    )
    .all() as { slug: string; label: string; count: number; isTheme: number }[]
  return rows.map(({ slug, label, count }) => ({ slug, label, count }))
}

/** THE list_components query: one group's full membership, alphabetical. */
export function listComponentRows(
  db: DB,
  group: string,
): { name: string; title: string; description: string; label: string | null }[] {
  return db
    .prepare(
      `SELECT name, title, description, group_label AS label
         FROM items WHERE group_slug = ? ORDER BY name`,
    )
    .all(group) as { name: string; title: string; description: string; label: string | null }[]
}

/**
 * Whether an item has the doc vector findSimilar seeds from.
 *
 * Distinguishes two failures that looked identical: a name nobody has, versus a
 * name the index HAS but never embedded (reachable after a partial rebuild).
 * Reporting the second as "no such component" is the index lying about its own
 * corpus — the exact class of quiet wrongness this package is built against.
 */
export const hasDocVector = (db: DB, name: string): boolean =>
  db
    .prepare(
      `SELECT 1 FROM chunks_vec v JOIN chunks c ON c.id = v.chunk_id
        WHERE c.item_name = ? AND c.facet = 'doc' LIMIT 1`,
    )
    .get(name) !== undefined

/**
 * "Did you mean" candidates for a name that missed.
 *
 * Turns a dead end into a one-turn correction: a model that asked for
 * `magnetic-btn` can retry `magnetic-button` without another search. The
 * ranking lives in engine.ts (suggestFromNames) so the catalog engine answers
 * a missed name with the exact same suggestions.
 */
export function suggestNames(db: DB, near: string, limit = 3): string[] {
  return suggestFromNames(knownNames(db), near, limit)
}
