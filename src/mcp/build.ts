// Payload builders: data in, declared Output out. No database, no SDK, no I/O.
//
// This is the test seam. Every builder is a pure function whose return type is
// annotated with its schema, so a mismatch is a compile error long before the
// SDK's runtime validation would see it.
import { qualifiedName } from '../registry-id.ts'
import type { Catalog } from '../catalog.ts'
import type { EngineDetail, EngineKind } from '../engine.ts'
import type { ResolvedIcon } from '../icons.ts'
import type { DependencyInfo, SearchHit } from '../items.ts'
import type { RegistryIdentity } from '../registry-id.ts'
import type {
  FindIconsOutput,
  FindSimilarOutput,
  GetComponentOutput,
  GetInstallCommandOutput,
  Group,
  Hit,
  IconHit,
  ListComponentsOutput,
  ListGroupsOutput,
  SearchComponentsOutput,
} from './schemas.ts'

/**
 * The gated names, derived ONCE at registration from the catalog snapshot the
 * server already holds — not threaded through the engine layer.
 *
 * `gated` lives on CatalogItem and nowhere in SQL: schema.sql, build.ts's
 * INSERT and the index fixture each restate the column list, so a db column
 * would be a schema bump plus a forced re-embed to carry a boolean the MCP
 * layer has in memory on every engine. The cost of doing it here is that on the
 * db engine the flag is only as fresh as the committed artifact — which is
 * exactly what the existing catalog-drift disclosure already warns about.
 */
export const gatedNames = (catalog: Catalog): ReadonlySet<string> =>
  new Set(catalog.items.filter((i) => i.gated).map((i) => i.name))

/**
 * Fields are copied explicitly rather than spread. A spread would carry a new
 * SearchHit field straight into a `.strict()` payload and turn it into a runtime
 * validation error; the test asserts key coverage instead, so drift shows up as
 * a red test rather than a broken tool.
 *
 * `gated` is passed in rather than defaulted: an omitted set would silently
 * report every item ungated at a forgotten call site, which is the same drift
 * the explicit copying above exists to prevent.
 */
const toHit = (h: SearchHit, scoreKind: Hit['scoreKind'], gated: ReadonlySet<string>): Hit => ({
  gated: gated.has(h.name),
  name: h.name,
  title: h.title,
  description: h.description,
  group: h.group,
  type: h.type,
  installCmd: h.installCmd,
  docUrl: h.docUrl,
  score: h.score,
  scoreKind,
  cosine: h.cosine,
  matchedOn: h.matchedOn,
  provenance: h.provenance,
  motion: h.motion,
  pure: h.pure,
})

export const buildSearchOutput = (
  engine: EngineKind,
  query: string,
  hits: readonly SearchHit[],
  degraded: boolean,
  gated: ReadonlySet<string>,
): SearchComponentsOutput => ({
  query,
  hits: hits.map((h) => toHit(h, engine === 'db' ? 'rrf' : 'lexical', gated)),
  count: hits.length,
  degraded,
  engine,
})

export const buildSimilarOutput = (
  engine: EngineKind,
  seed: string,
  hits: readonly SearchHit[],
  gated: ReadonlySet<string>,
): FindSimilarOutput => ({
  seed,
  neighbours: hits.map((h) => toHit(h, engine === 'db' ? 'cosine' : 'lexical', gated)),
  count: hits.length,
  engine,
})

/** The engine already parsed its storage into EngineDetail — this is a copy. */
export const buildComponentOutput = (
  id: RegistryIdentity,
  detail: EngineDetail,
  deps: DependencyInfo,
  gated: ReadonlySet<string>,
): GetComponentOutput => ({
  gated: gated.has(detail.name),
  name: detail.name,
  qualifiedName: qualifiedName(id, detail.name),
  title: detail.title,
  description: detail.description,
  type: detail.type,
  group: detail.group === null ? null : { ...detail.group },
  categories: [...detail.categories],
  dependencies: [...detail.dependencies],
  registryDependencies: [...detail.registryDependencies],
  transitiveDependencies: [...deps.transitiveDependencies],
  pureReact: deps.pure,
  provenance: detail.provenance,
  license: detail.license,
  sourceUrl: detail.sourceUrl,
  motion: detail.motion,
  filePath: detail.filePath,
  partsFilePath: detail.partsFilePath,
  installCmd: detail.installCmd,
  docUrl: detail.docUrl,
  sourceBytes: detail.sourceBytes,
  demoBytes: detail.demoBytes,
  setup: detail.setup,
})

export const buildGroupsOutput = (
  engine: EngineKind,
  groups: readonly Group[],
): ListGroupsOutput => ({
  groups: [...groups],
  totalItems: groups.reduce((sum, g) => sum + g.count, 0),
  engine,
})

/** Rows arrive pre-sorted (ORDER BY name); the group label rides on every row. */
export const buildComponentsOutput = (
  engine: EngineKind,
  slug: string,
  rows: readonly {
    name: string
    title: string
    description: string
    label: string | null
    pure: boolean
  }[],
): ListComponentsOutput => ({
  group: { slug, label: rows[0]?.label ?? slug },
  components: rows.map(({ name, title, description, pure }) => ({
    name,
    title,
    description,
    pure,
  })),
  count: rows.length,
  engine,
})

/** Tags are short context, not the full record — 8 is plenty to disambiguate. */
const TAG_CAP = 8

export const buildIconsOutput = (
  lucideVersion: string,
  resolved: readonly ResolvedIcon[],
  unknown: readonly { name: string; suggestions: string[] }[],
): FindIconsOutput => {
  const icons: IconHit[] = resolved.map(({ entry, alias }) => ({
    name: entry.name,
    component: entry.pascal,
    tags: entry.tags.slice(0, TAG_CAP),
    categories: [...entry.categories],
    deprecatedAliases: entry.aliases.filter((a) => a.deprecated).map((a) => a.name),
    resolvedFrom: alias?.name ?? null,
  }))
  return {
    lucideVersion,
    icons,
    count: icons.length,
    unknown: unknown.map(({ name, suggestions }) => ({ name, suggestions: [...suggestions] })),
    usage:
      icons.length > 0
        ? `import { ${icons.map((i) => i.component).join(', ')} } from 'lucide-react'`
        : null,
    install:
      `lucide-react@~${lucideVersion} — already a dependency of every icon-using registry ` +
      'item (the shadcn CLI installs it with the item); plain projects: npm install lucide-react.',
  }
}

export const buildInstallOutput = (
  id: RegistryIdentity,
  command: string,
  found: readonly string[],
  unknown: readonly string[],
): GetInstallCommandOutput => ({
  command,
  components: found.map((name) => ({ name, qualifiedName: qualifiedName(id, name) })),
  unknown: [...unknown],
})
