// The component catalog — the committed agent-index.json artifact, loaded once
// at startup and ranked lexically by the catalog engine (engine-catalog.ts).
// No database, no embeddings: this is the zero-setup path that must work
// straight after clone + install.
//
// The artifact lives at the PACKAGE ROOT (rag/agent-index.json, like index.db)
// so src/ (strip-types) and dist/ resolve the same file with no cp step — it
// regenerates on every `registry:build` (scripts/build-agent-index.mjs), and a
// dist-resident copy would go stale in the window before the next compile.
// Never hand-edited; a drift test pins it against the registry sources.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { RegistryIdentity } from './registry-id.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Fail-loud shapes: the artifact ships inside the package, so a miss or a
 *  malformed record is a PACKAGING bug — the icons-catalog doctrine, not the
 *  tolerant-output posture the tool schemas take. */
const CatalogGroupSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  count: z.number().int().min(1),
})

const CatalogItemSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  title: z.string(),
  description: z.string(),
  group: z.object({ slug: z.string(), label: z.string() }).nullable(),
  categories: z.array(z.string()),
  keywords: z.array(z.string()),
  aliases: z.array(z.string()),
  dependencies: z.array(z.string()),
  registryDependencies: z.array(z.string()),
  transitiveDependencies: z.array(z.string()),
  pure: z.boolean(),
  provenance: z.string().nullable(),
  license: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  motion: z.boolean(),
  gated: z.boolean(),
  filePath: z.string().nullable(),
  partsFilePath: z.string().nullable(),
  sourceBytes: z.number().int().nullable(),
  demoBytes: z.number().int().nullable(),
  installCmd: z.string().min(1),
  docUrl: z.string().min(1),
  /** shadcn's `docs` — post-install setup the payload cannot perform itself. */
  docs: z.string().nullable(),
})

const AgentIndexSchema = z.object({
  schemaVersion: z.literal('1'),
  registryHash: z.string().length(16),
  registry: z.object({ scope: z.string().min(1), homepage: z.string().min(1) }),
  counts: z.object({ items: z.number().int(), groups: z.number().int() }),
  sources: z.object({
    registryJsonSha256: z.string(),
    groupsSha256: z.string(),
    demosDigest: z.string(),
  }),
  groups: z.array(CatalogGroupSchema),
  items: z.array(CatalogItemSchema),
})

export type CatalogGroup = z.infer<typeof CatalogGroupSchema>
export type CatalogItem = z.infer<typeof CatalogItemSchema>
export type CatalogSources = z.infer<typeof AgentIndexSchema>['sources']

/** One accepted spelling → the item it names. `alias` is the alias string the
 *  key came through, null for a canonical spelling. */
export interface ComponentKey {
  readonly item: CatalogItem
  readonly alias: string | null
}

export interface Catalog {
  readonly identity: RegistryIdentity
  readonly registryHash: string
  readonly sources: CatalogSources
  readonly groups: readonly CatalogGroup[]
  readonly items: readonly CatalogItem[]
  readonly byName: ReadonlyMap<string, CatalogItem>
  /** Every accepted lowercase spelling (name, dashless, aliases) → item. */
  readonly byKey: ReadonlyMap<string, ComponentKey>
}

/** Resolved next to the package root — identical from src/ and dist/. */
export const defaultCatalogPath = (): string => path.resolve(HERE, '..', 'agent-index.json')

export function loadCatalog(file: string = defaultCatalogPath()): Catalog {
  return parseCatalog(JSON.parse(readFileSync(file, 'utf8')), file)
}

/** What the operator does about a bad index. The default assumes the bundled artifact. */
const REGENERATE = 'The catalog ships with the package — update it to get a fresh one.'

/**
 * The parse+index half of loadCatalog, split out so the web engine can run the
 * SAME Zod gate and key-map construction over a fetched body (web-index.ts).
 * `sourceLabel` names the origin in error messages — a file path for the local
 * loaders, a URL for a fetched body. `remedy` replaces the default checkout
 * advice, which is wrong for a body that came off the wire: nobody debugging a
 * fetched index can fix it by running a build here.
 */
export function parseCatalog(raw: unknown, sourceLabel: string, remedy: string = REGENERATE): Catalog {
  const parsed = AgentIndexSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `${sourceLabel} is not a valid agent index:\n` +
        parsed.error.issues
          .slice(0, 5)
          .map((i) => `  ${i.path.join('.')}: ${i.message}`)
          .join('\n') +
        `\n${remedy}`,
    )
  }
  const { registry, registryHash, sources, groups, items, counts } = parsed.data
  if (counts.items !== items.length || counts.groups !== groups.length) {
    throw new Error(
      `${sourceLabel} counts disagree with its records (${counts.items}/${items.length} items, ` +
        `${counts.groups}/${groups.length} groups) — ${remedy}`,
    )
  }

  const byName = new Map<string, CatalogItem>()
  for (const item of items) {
    if (byName.has(item.name)) throw new Error(`${sourceLabel} lists "${item.name}" twice`)
    byName.set(item.name, item)
  }

  // Three ordered passes, weakest-claim-last, each guarded by `has` so an
  // earlier (stronger) claim always keeps its key:
  //   1. exact names — unique by construction, never contested;
  //   2. dashless forms — a later item's dashless spelling used to be written
  //      UNGUARDED and could steal an earlier item's exact name (a `datatable`
  //      item vs `data-table`'s dashless form — order-dependent misresolution);
  //   3. curated aliases (sheet aliases 'drawer'; the drawer ITEM keeps it).
  // Within a pass, artifact order wins ties — deterministic across loads.
  const byKey = new Map<string, ComponentKey>()
  for (const item of items) {
    byKey.set(item.name, { item, alias: null })
  }
  for (const item of items) {
    const dashless = item.name.replace(/-/g, '')
    if (!byKey.has(dashless)) byKey.set(dashless, { item, alias: null })
  }
  for (const item of items) {
    for (const alias of item.aliases) {
      const lower = alias.toLowerCase()
      for (const key of [lower.replace(/[\s_]+/g, '-'), lower.replace(/[\s_-]+/g, '')]) {
        if (!byKey.has(key)) byKey.set(key, { item, alias })
      }
    }
  }

  return {
    identity: { scope: registry.scope, homepage: registry.homepage },
    registryHash,
    sources,
    groups,
    items,
    byName,
    byKey,
  }
}

export interface ResolvedComponent {
  readonly item: CatalogItem
  /** The alias the caller came through, null for a canonical spelling. */
  readonly viaAlias: string | null
}

/**
 * Accepts the spellings an agent plausibly emits: kebab ("dropdown-menu"),
 * spaced ("dropdown menu"), PascalCase ("DropdownMenu"), and curated aliases
 * in any of those forms ("modal" → dialog). Scope prefixes are the tool
 * layer's job (stripScope) — this sees bare names.
 */
export function resolveComponentName(catalog: Catalog, input: string): ResolvedComponent | null {
  const lower = input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  for (const key of [lower, lower.replace(/-/g, '')]) {
    const hit = catalog.byKey.get(key)
    if (hit) return { item: hit.item, viaAlias: hit.alias }
  }
  return null
}
