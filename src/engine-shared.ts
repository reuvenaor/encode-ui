// Shared core for the two agent-index-backed engines (catalog + web). Both
// serve the SAME artifact shape, and everything except ranking and
// body-serving is identical by construction — one implementation here keeps
// alias resolution, filter semantics, group ordering, and the
// files[0]+siblings combining rule in lockstep across engines (renderSource
// output is pinned byte-identical by a cross-engine test).
//
// Like engine.ts, this module must import NO native code — it is on the
// zero-setup path.
import { resolveComponentName } from './catalog.ts'
import { orderGroups, suggestFromNames } from './engine.ts'
import { compareStrings } from './text.ts'
import type { Catalog, CatalogItem } from './catalog.ts'
import type {
  ComponentRow,
  EngineDetail,
  EngineMeta,
  EngineSearchOptions,
  GroupRow,
  SourceFile,
} from './engine.ts'
import type { DependencyInfo, SearchHit } from './items.ts'
import type { RegistryIdentity } from './registry-id.ts'

export const toHit = (
  item: CatalogItem,
  score: number,
  matchedOn: readonly string[],
): SearchHit => ({
  name: item.name,
  title: item.title,
  description: item.description,
  group: item.group?.slug ?? null,
  type: item.type,
  installCmd: item.installCmd,
  docUrl: item.docUrl,
  score: +score.toFixed(6),
  cosine: null,
  matchedOn: [...matchedOn],
  provenance: item.provenance,
  motion: item.motion,
  pure: item.pure,
})

export const toDetail = (item: CatalogItem): EngineDetail => ({
  name: item.name,
  title: item.title,
  description: item.description,
  type: item.type,
  group: item.group,
  categories: [...item.categories],
  dependencies: [...item.dependencies],
  registryDependencies: [...item.registryDependencies],
  provenance: item.provenance,
  license: item.license,
  sourceUrl: item.sourceUrl,
  motion: item.motion,
  filePath: item.filePath,
  partsFilePath: item.partsFilePath,
  installCmd: item.installCmd,
  docUrl: item.docUrl,
  sourceBytes: item.sourceBytes,
  demoBytes: item.demoBytes,
  setup: item.docs,
})

/** Jaccard over two small string sets. */
export const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 && b.size === 0) return 0
  let shared = 0
  for (const v of a) if (b.has(v)) shared += 1
  return shared / (a.size + b.size - shared)
}

const bare = (dep: string): string => dep.replace(/^@[^/]+\//, '')

/**
 * The engine-independent method set both artifact-backed engines spread.
 * Function-typed PROPERTIES, not method shorthand: the engines detach these
 * (`detail: core.detail`), and a method signature would type `this` as the
 * core object — the unbound-method hazard the lint rule flags. None of these
 * closures reads `this`; the property form says so.
 */
export interface CatalogCore {
  readonly identity: RegistryIdentity
  readonly meta: EngineMeta
  /** Composition neighbourhood: an item's bare registry deps PLUS its own name. */
  readonly depSets: ReadonlyMap<string, ReadonlySet<string>>
  passesFilters: (item: CatalogItem, opts: EngineSearchOptions) => boolean
  detail: (name: string) => EngineDetail | undefined
  resolveName: (input: string) => string | null
  canFindSimilar: (name: string) => boolean
  knownNames: () => Set<string>
  groupSlugs: () => Set<string>
  suggestNames: (near: string, limit?: number) => string[]
  dependencyInfo: (name: string) => DependencyInfo
  listGroups: () => GroupRow[]
  listComponents: (group: string) => ComponentRow[]
}

export function catalogCore(catalog: Catalog): CatalogCore {
  const depSets = new Map<string, Set<string>>(
    catalog.items.map((item) => [
      item.name,
      new Set([item.name, ...item.registryDependencies.map(bare)]),
    ]),
  )

  const groupIsTheme = new Map<string, boolean>()
  for (const item of catalog.items) {
    if (!item.group) continue
    groupIsTheme.set(
      item.group.slug,
      (groupIsTheme.get(item.group.slug) ?? false) || item.type === 'registry:theme',
    )
  }

  return {
    identity: catalog.identity,
    meta: {
      itemCount: catalog.items.length,
      registryHash: catalog.registryHash,
      detail: `${catalog.groups.length} groups`,
      // The artifact's own digests: an artifact-backed engine is by definition
      // in sync with the resource rendered from the same artifact.
      sourceDigests: { ...catalog.sources },
    },
    depSets,

    passesFilters: (item, opts) =>
      (opts.group === undefined || item.group?.slug === opts.group) &&
      (opts.type === undefined || item.type === opts.type) &&
      (opts.motion === undefined || item.motion === opts.motion) &&
      (opts.dependencyFree === undefined || item.pure === opts.dependencyFree),

    detail: (name): EngineDetail | undefined => {
      const item = catalog.byName.get(name)
      return item === undefined ? undefined : toDetail(item)
    },

    resolveName: (input): string | null => {
      const hit = resolveComponentName(catalog, input)
      return hit === null ? null : hit.item.name
    },

    // Every known item is a valid seed — the structural signals need no stored
    // vector (the db guard exists for partial rebuilds, a failure mode a
    // committed/fetched artifact does not have).
    canFindSimilar: (name) => catalog.byName.has(name),

    knownNames: () => new Set(catalog.byName.keys()),
    groupSlugs: () => new Set(catalog.groups.map((g) => g.slug)),
    suggestNames: (near, limit) => suggestFromNames(catalog.byName.keys(), near, limit),

    dependencyInfo: (name): DependencyInfo => {
      const item = catalog.byName.get(name)
      return item === undefined
        ? { pure: false, transitiveDependencies: [] }
        : { pure: item.pure, transitiveDependencies: [...item.transitiveDependencies] }
    },

    listGroups: (): GroupRow[] =>
      orderGroups(
        catalog.groups.map((g) => ({
          slug: g.slug,
          label: g.label,
          count: g.count,
          isTheme: groupIsTheme.get(g.slug) ?? false,
        })),
      ),

    listComponents: (group): ComponentRow[] =>
      catalog.items
        .filter((item) => item.group?.slug === group)
        .sort((a, b) => compareStrings(a.name, b.name))
        .map((item) => ({
          name: item.name,
          title: item.title,
          description: item.description,
          label: item.group?.label ?? null,
          pure: item.pure,
        })),
  }
}

/**
 * The structural findSimilar both engines share: same group, category overlap,
 * composition overlap, plus an optional relevance arm (`seeded` — the catalog
 * engine fills it from MiniSearch; the web engine passes an empty map and the
 * arm contributes zero).
 */
export function structuralSimilar(
  catalog: Catalog,
  depSets: ReadonlyMap<string, ReadonlySet<string>>,
  seed: CatalogItem,
  k: number,
  seeded: ReadonlyMap<string, number>,
  matchTag: string,
): SearchHit[] {
  const seededTop = Math.max(...seeded.values(), 1)
  const seedDeps = depSets.get(seed.name) ?? new Set([seed.name])
  const seedCategories = new Set(seed.categories)

  return catalog.items
    .filter((item) => item.name !== seed.name)
    .map((item) => {
      const score =
        2.0 * (item.group !== null && item.group.slug === seed.group?.slug ? 1 : 0) +
        1.5 * jaccard(new Set(item.categories), seedCategories) +
        1.5 * jaccard(depSets.get(item.name) ?? new Set([item.name]), seedDeps) +
        1.0 * ((seeded.get(item.name) ?? 0) / seededTop)
      return { item, score }
    })
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.name.length - b.item.name.length ||
        compareStrings(a.item.name, b.item.name),
    )
    .slice(0, k)
    .map((s) => toHit(s.item, s.score, [matchTag]))
}

/**
 * files[0] + ONE combined siblings entry covering EVERY other payload file
 * (comma-joined paths, '\n\n'-joined sources — the parts convention plus
 * block modules), so renderSource output is byte-identical whichever engine
 * served the payload and no returned module carries a dangling relative
 * import. 'drifted' when the payload has no readable files[0].
 */
export function payloadFiles(payload: {
  files?: { path?: string; content?: string }[]
}): SourceFile[] | 'drifted' {
  const first = payload.files?.[0]
  if (first?.content === undefined) return 'drifted'
  const siblings = (payload.files ?? [])
    .slice(1)
    .filter((f): f is { path: string; content: string } => typeof f.content === 'string')
  const files: SourceFile[] = [{ path: first.path ?? null, code: first.content }]
  if (siblings.length > 0) {
    files.push({
      path: siblings.map((f) => f.path).join(', '),
      code: siblings.map((f) => f.content).join('\n\n'),
    })
  }
  return files
}
