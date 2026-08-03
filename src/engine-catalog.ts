// The bundled-artifact engine: RegistryEngine over the committed
// agent-index.json, ranked in memory by MiniSearch (BM25-style relevance with
// field boosts — ~6 kB, zero deps, no natives). Opt-in via
// --registry-engine catalog; the default web engine shares this engine's
// core (engine-shared.ts) but filters instead of ranking.
//
// Ranking shape:
//   1. exact resolve short-circuit — a query that IS a name or curated alias
//      returns that item first (the icons resolve() doctrine);
//   2. an AND pass (every term must land) with prefix + light fuzzy;
//   3. an OR pass appended below the AND results only when they run short —
//      a lexical engine cannot uphold the db invariant "fewer than k hits ⇒
//      fewer than k items match", so the instructions tell callers to
//      enumerate for absence questions instead.
//
// Scores are rank-derived (1/(60+rank), the RRF convention): monotonically
// non-increasing by construction — the ORDER above is the intent-honoring
// product, and raw per-pass BM25 values would read as non-monotonic against
// it (an OR-fill hit can carry a bigger raw score than the AND hits ranked
// above it). Comparable only within one result set, stamped scoreKind
// 'lexical', never dressed up as a cosine (`cosine` stays null on every
// catalog hit). findSimilar keeps its structural-overlap scores: that list
// is sorted BY them, so they are already monotonic and carry real signal.
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import MiniSearch from 'minisearch'
import { resolveComponentName } from './catalog.ts'
import { DEFAULT_K } from './engine.ts'
import { catalogCore, payloadFiles, structuralSimilar, toHit } from './engine-shared.ts'
import type { Catalog, CatalogItem } from './catalog.ts'
import type { ComponentSourcePart, EngineSearchOptions, RegistryEngine, SourceResult } from './engine.ts'
import type { RemoteSource } from './remote-source.ts'
import type { SearchHit } from './items.ts'

/**
 * Field boosts: names and curated aliases are the strongest signal, keywords
 * next (behaviour phrasings authored for exactly this engine), then title,
 * description, and the group/category words as a weak tail. Starting values —
 * tuned against the 208-query eval (eval/run-eval.ts), not guessed.
 */
const FIELD_BOOSTS = {
  name: 5,
  aliases: 5,
  keywords: 3,
  title: 3,
  description: 1,
  categoriesText: 0.5,
} as const

const FUZZY = 0.15

interface IndexedDoc {
  name: string
  title: string
  keywords: string
  aliases: string
  description: string
  categoriesText: string
}

const toDoc = (item: CatalogItem): IndexedDoc => ({
  name: item.name,
  title: item.title,
  keywords: item.keywords.join(' '),
  aliases: item.aliases.join(' '),
  description: item.description,
  categoriesText: [...item.categories, item.group?.label ?? ''].join(' '),
})

export interface CatalogEngineOptions {
  /**
   * The registry checkout this package sits inside (payloads at public/r,
   * demos at src/demos) — null when running from a tarball with no checkout
   * around it. mcp.ts DETECTS this rather than assuming: the old caller passed
   * `path.resolve(HERE,'..','..')` unconditionally, which in a detached
   * `npm i` is `node_modules/@encode-ui/` — a directory that exists but holds
   * no registry, so every source request answered 'drifted' and told the
   * operator to run `registry:build` in a checkout they did not have.
   */
  registryRoot: string | null
  /**
   * Origin fetcher for bodies. Used when there is no checkout, and preferred
   * over one when the operator named an origin explicitly with --registry-url.
   */
  remote?: RemoteSource | null
  /** --registry-url was explicit — the origin outranks any local checkout. */
  preferRemote?: boolean
}

/**
 * Ranked offline retrieval over the committed artifact. Bodies come from the
 * surrounding checkout, or from the registry origin when there is none.
 */
export function createCatalogEngine(
  catalog: Catalog,
  opts: CatalogEngineOptions,
): RegistryEngine {
  const { registryRoot, remote = null, preferRemote = false } = opts
  const core = catalogCore(catalog)

  const mini = new MiniSearch<IndexedDoc>({
    idField: 'name',
    fields: ['name', 'title', 'keywords', 'aliases', 'description', 'categoriesText'],
    storeFields: [],
    searchOptions: { boost: { ...FIELD_BOOSTS }, prefix: true, fuzzy: FUZZY },
  })
  mini.addAll(catalog.items.map(toDoc))

  /** MiniSearch match record → our `field:catalog` matchedOn strings, sorted. */
  const matchedFields = (match: Record<string, string[]>): string[] => {
    const fields = new Set<string>()
    for (const terms of Object.values(match)) for (const f of terms) fields.add(`${f}:catalog`)
    return [...fields].sort()
  }

  const rankedSearch = (query: string, opts: EngineSearchOptions): SearchHit[] => {
    const k = opts.k ?? DEFAULT_K
    const filter = (r: { id: string }): boolean => {
      const item = catalog.byName.get(r.id)
      return item !== undefined && core.passesFilters(item, opts)
    }

    const andResults = mini.search(query, { combineWith: 'AND', filter })
    const results = [...andResults]
    if (results.length < k) {
      const seen = new Set(results.map((r) => r.id as string))
      for (const r of mini.search(query, { combineWith: 'OR', filter })) {
        if (!seen.has(r.id as string)) results.push(r)
      }
    }

    // Order first, scores second. The final rank encodes three deliberate
    // layers (exact resolve, AND pass, OR fill), so the reported score is
    // derived FROM that rank — never a raw BM25 value that would contradict
    // it, and never a fabricated stand-in for the pinned exact hit.
    const ordered: { item: CatalogItem; matchedOn: readonly string[] }[] = []
    const exact = resolveComponentName(catalog, query)
    if (exact && core.passesFilters(exact.item, opts)) {
      ordered.push({
        item: exact.item,
        matchedOn: [exact.viaAlias === null ? 'name:catalog' : 'alias:catalog'],
      })
    }
    for (const r of results) {
      if (ordered.length >= k) break
      if (exact && r.id === exact.item.name) continue
      const item = catalog.byName.get(r.id as string)
      if (!item) continue
      ordered.push({ item, matchedOn: matchedFields(r.match) })
    }
    return ordered
      .slice(0, k)
      .map(({ item, matchedOn }, rank) => toHit(item, 1 / (61 + rank), matchedOn))
  }

  return {
    kind: 'catalog',
    identity: core.identity,
    meta: core.meta,

    search: (query, opts = {}) =>
      Promise.resolve({ hits: rankedSearch(query, opts), degraded: false }),

    findSimilar(name, k = DEFAULT_K): SearchHit[] {
      const seed = catalog.byName.get(name)
      if (!seed) return []
      // Seeded relevance arm: the item's own words, OR-combined, no fuzz — a
      // description-space neighbourhood to complement the structural signals.
      const seeded = new Map<string, number>()
      const seedQuery = [seed.title, seed.keywords.join(' '), seed.description].join(' ')
      for (const r of mini.search(seedQuery, { combineWith: 'OR', prefix: false, fuzzy: false })) {
        seeded.set(r.id as string, r.score)
      }
      return structuralSimilar(catalog, core.depSets, seed, k, seeded, 'similar:catalog')
    },

    canFindSimilar: core.canFindSimilar,
    detail: core.detail,
    resolveName: core.resolveName,
    knownNames: core.knownNames,
    groupSlugs: core.groupSlugs,
    suggestNames: core.suggestNames,
    dependencyInfo: core.dependencyInfo,
    listGroups: core.listGroups,
    listComponents: core.listComponents,

    sourceOf(name, part: ComponentSourcePart): SourceResult | Promise<SourceResult> {
      const item = catalog.byName.get(name)
      if (!item) return null
      // The artifact's byte fields are the existence oracle — a null there
      // means the item HAS no such part (themes, chart-series's demo), which
      // is a different answer than "this engine cannot serve bodies".
      const bytes = part === 'source' ? item.sourceBytes : item.demoBytes
      if (bytes === null) return null
      // An explicitly-named origin outranks a checkout; without one, a checkout
      // is preferred (faster, and works offline).
      if (remote !== null && (preferRemote || registryRoot === null)) return remote(name, part)
      // 'unavailable' means exactly ONE thing: no checkout at all (detached
      // tarball) and no origin to fall back to. A checkout that exists but
      // lacks the expected file is 'drifted' — the artifact promised this part,
      // the tree moved on — and the remedies differ (regenerate vs
      // install/fetch), so conflating them sent operators chasing a "missing
      // checkout" that was sitting right there.
      if (registryRoot === null) return 'unavailable'

      if (part === 'demo') {
        const demoPath = item.group
          ? path.join(registryRoot, 'src', 'demos', item.group.slug, `${item.name}.tsx`)
          : null
        if (demoPath === null || !existsSync(demoPath)) return 'drifted'
        return [{ path: null, code: readFileSync(demoPath, 'utf8') }]
      }

      const payloadPath = path.join(registryRoot, 'public', 'r', `${item.name}.json`)
      if (!existsSync(payloadPath)) return 'drifted'
      // A payload that exists but does not parse (mid-rewrite, truncated) must
      // surface with its FILENAME on stderr — guarded() logs the raw error for
      // the operator and hands the model the catalog remedy.
      let payload: { files?: { path?: string; content?: string }[] }
      try {
        payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as {
          files?: { path?: string; content?: string }[]
        }
      } catch (err) {
        throw new Error(
          `payload ${payloadPath} is unreadable (mid-write or corrupt): ${(err as Error).message}`,
        )
      }
      return payloadFiles(payload)
    },

    close(): void {
      // Nothing to release — the catalog is plain memory.
    },
  }
}
