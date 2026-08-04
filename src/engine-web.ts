// The DEFAULT engine: RegistryEngine over the index fetched from the deployed
// registry (web-index.ts), with source/demo bodies fetched from the same
// origin — /r/<name>.json and /r/<name>.demo.json.
//
// Search here is deliberately a PLAIN FILTER, not a ranking engine: on this
// engine the user-chosen discovery path is the ≈20k-token catalog resource
// (encode-ui://catalog), which an agent reads once and judges itself;
// search_components covers exact names, curated aliases, and keyword lookups.
// Semantics: AND over lowercase terms (split on non-alphanumeric runs, short
// tokens dropped — see termsOf) matched as substrings against each item's
// combined metadata, exact name/alias resolve pinned first (the engines' shared
// doctrine), then matches ordered by the strongest FIELD that matched
// (name/alias > keywords/title > description > categories) with the name as a
// deterministic tie-break. Scores are rank-derived (1/(61+rank), scoreKind
// 'lexical'), `cosine` is always null, `degraded` is always false.
import { resolveComponentName } from './catalog.ts'
import { DEFAULT_K } from './engine.ts'
import { catalogCore, structuralSimilar, toHit } from './engine-shared.ts'
import { createRemoteSource } from './remote-source.ts'
import { compareStrings } from './text.ts'
import type { Catalog, CatalogItem } from './catalog.ts'
import type { EngineSearchOptions, RegistryEngine, SourceResult } from './engine.ts'
import type { SearchHit } from './items.ts'
import type { WebIndexSource } from './web-index.ts'

export interface WebEngineOptions {
  /** Registry origin, no path — e.g. https://encode-ui.com */
  baseUrl: string
  /** How the index arrived (web-index.ts) — surfaced in the startup banner. */
  indexSource: WebIndexSource
  /** ENCODE_UI_TOKEN, when the operator set one (gated payloads). */
  token?: string | undefined
  /** Injectable for tests; global fetch otherwise. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Filter fields in priority order; the tier ranks which match wins. */
const FIELD_TIERS = [
  ['name', 0],
  ['aliases', 0],
  ['keywords', 1],
  ['title', 1],
  ['description', 2],
  ['categories', 3],
] as const

type FilterField = (typeof FIELD_TIERS)[number][0]

interface WebDoc {
  item: CatalogItem
  fields: Record<FilterField, string>
  /** Every field concatenated — the AND haystack. */
  all: string
}

/**
 * Below this a term is not evidence: a one-character substring lands in almost
 * every document, which is how "." and "-" used to return an alphabetical slice
 * of the catalog dressed up as tier-0 name matches.
 */
const MIN_TERM = 2

/**
 * Query → filter terms. Splitting on every non-letter/digit run rather than on
 * whitespace is what makes "toast?", "card, badge" and "a dialog." answer at
 * all: the punctuation used to ride along and turn the term into a substring
 * nothing contains, so the model was told "No components match" — indis-
 * tinguishable from genuine absence. It also matches the catalog engine's
 * tokenizer (MiniSearch splits on \p{P} too), so both engines agree on what a
 * term IS.
 *
 * Hyphens split with everything else and cost nothing: "dropdown-menu" still
 * matches term-by-term against the concatenated fields, and the exact-name
 * resolve below is a separate, stronger path that sees the raw query.
 * \p{L}\p{N} rather than a-z0-9 so a non-ASCII query stays one term instead of
 * shattering into nothing.
 */
const termsOf = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TERM)

const toWebDoc = (item: CatalogItem): WebDoc => {
  const fields: Record<FilterField, string> = {
    name: item.name.toLowerCase(),
    aliases: item.aliases.join(' ').toLowerCase(),
    keywords: item.keywords.join(' ').toLowerCase(),
    title: item.title.toLowerCase(),
    description: item.description.toLowerCase(),
    categories: [...item.categories, item.group?.label ?? ''].join(' ').toLowerCase(),
  }
  return { item, fields, all: Object.values(fields).join('\n') }
}

export function createWebEngine(catalog: Catalog, opts: WebEngineOptions): RegistryEngine {
  const core = catalogCore(catalog)
  const base = opts.baseUrl.replace(/\/+$/, '')
  const docs = catalog.items.map(toWebDoc)

  const filterSearch = (query: string, searchOpts: EngineSearchOptions = {}): SearchHit[] => {
    const k = searchOpts.k ?? DEFAULT_K
    const terms = termsOf(query)

    // The exact/alias resolve runs on the RAW query first (it does its own
    // normalization), then on the cleaned terms — so "modal?" and "a dialog."
    // still pin their item at rank 1 instead of dropping into the filter.
    const exact =
      resolveComponentName(catalog, query) ??
      (terms.length > 0 ? resolveComponentName(catalog, terms.join(' ')) : null)
    const exactOk = exact !== null && core.passesFilters(exact.item, searchOpts) ? exact : null

    const scored: { doc: WebDoc; tier: number; matchedOn: string[] }[] = []
    if (terms.length > 0) {
      for (const doc of docs) {
        if (exactOk !== null && doc.item.name === exactOk.item.name) continue
        if (!core.passesFilters(doc.item, searchOpts)) continue
        if (!terms.every((t) => doc.all.includes(t))) continue
        // Non-empty by construction: `all` is the fields concatenated, so a
        // term found in `all` is found in at least one field.
        const matched = FIELD_TIERS.filter(([field]) =>
          terms.some((t) => doc.fields[field].includes(t)),
        )
        scored.push({
          doc,
          tier: Math.min(...matched.map(([, tier]) => tier)),
          matchedOn: matched.map(([field]) => `${field}:web`),
        })
      }
      scored.sort((a, b) => a.tier - b.tier || compareStrings(a.doc.item.name, b.doc.item.name))
    }

    const hits: SearchHit[] = []
    if (exactOk !== null) {
      hits.push(
        toHit(exactOk.item, 1 / 61, [exactOk.viaAlias === null ? 'name:web' : 'alias:web']),
      )
    }
    for (const s of scored) {
      if (hits.length >= k) break
      hits.push(toHit(s.doc.item, 1 / (61 + hits.length), s.matchedOn))
    }
    return hits
  }

  // The shared fetcher — identical wire behavior and identical
  // gated/drifted/404 answers on every engine that reaches an origin.
  const fetchPart = createRemoteSource({
    baseUrl: base,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  })

  return {
    kind: 'web',
    identity: core.identity,
    meta: {
      ...core.meta,
      indexSource: opts.indexSource,
      detail: `${core.meta.detail} · index: ${opts.indexSource}`,
    },

    search: (query, searchOpts = {}) =>
      Promise.resolve({ hits: filterSearch(query, searchOpts), degraded: false }),

    findSimilar(name, k = DEFAULT_K): SearchHit[] {
      const seed = catalog.byName.get(name)
      if (!seed) return []
      // Structural only — no MiniSearch on this engine, so the seeded
      // relevance arm is an empty map and contributes zero.
      return structuralSimilar(catalog, core.depSets, seed, k, new Map(), 'similar:web')
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

    async sourceOf(name, part): Promise<SourceResult> {
      const item = catalog.byName.get(name)
      if (!item) return null
      // Same existence oracle as the catalog engine: a null byte count means
      // the item HAS no such part — answered without a network round-trip.
      const bytes = part === 'source' ? item.sourceBytes : item.demoBytes
      if (bytes === null) return null
      // Known-gated without a token: the origin would 401 — answer before
      // spending the fetch, so offline-with-no-token still explains itself.
      if (item.gated && opts.token === undefined) return 'gated'
      return fetchPart(item.name, part)
    },

    close(): void {
      // Nothing to release — the catalog is plain memory; fetches are one-shot.
    },
  }
}
