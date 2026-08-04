// Registry → items + chunks. Reads only BUILT artifacts, never the source tree:
// `public/r/*.json` already carries each item's full source inlined by `shadcn build`,
// so there is no second file-walking implementation to keep in sync.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { docUrl, installCommand, stripScope } from './registry-id.ts'
import { assertLabelsCover, readGroupLabels } from './taxonomy.ts'
import type { Item } from './items.ts'
import type { RegistryIdentity } from './registry-id.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** registry/ — the parent of this package. */
export const registryRoot = (): string =>
  process.env.ENCODE_UI_REGISTRY_ROOT ?? path.resolve(HERE, '..', '..')

export type Facet = 'doc' | 'code' | 'demo'

export interface Chunk {
  itemName: string
  facet: Facet
  text: string
}

/** Shape of a built `public/r/<name>.json` payload. */
interface RegistryItemFile {
  path?: string
  content?: string
  type?: string
  target?: string
}
interface RegistryItemJson {
  name?: string
  type?: string
  title?: string
  description?: string
  categories?: string[]
  dependencies?: string[]
  registryDependencies?: string[]
  files?: RegistryItemFile[]
  /** Post-install setup the payload cannot perform itself — shadcn's own field. */
  docs?: string
  meta?: { provenance?: string; motion?: boolean; sourceUrl?: string; license?: string }
}

/**
 * The registry's own manifest header. `shadcn build` copies `name` and `homepage`
 * through from registry.json, so the scope prefix and docs origin are already a
 * build artifact — no need to import the untyped `scripts/registry-meta.mjs`
 * (outside rootDir, would ship a dangling import in dist/) or keep a second copy
 * behind a drift guard.
 *
 * Zod, not a cast: a silent miss here would stamp `@undefined/x` onto 173 rows.
 */
const RegistryManifest = z.object({
  name: z.string().min(1),
  homepage: z.url(),
})

/** Scope + docs origin, read from the built registry manifest. */
export function readIdentity(root: string = registryRoot()): RegistryIdentity {
  const file = path.join(root, 'public', 'r', 'registry.json')
  const parsed = RegistryManifest.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) {
    throw new Error(
      `${file} is missing its identity header:\n` +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    )
  }
  return { scope: parsed.data.name, homepage: parsed.data.homepage.replace(/\/+$/, '') }
}

const primaryGroup = (categories: readonly string[] | undefined): string | null =>
  categories?.find((c) => c !== 'base') ?? null

/** The curated card. Built for every item, including themes. */
export function docFacet(item: Item, id: RegistryIdentity): string {
  return [
    `${item.title} (${item.name})`,
    item.groupLabel ? `Group: ${item.groupLabel}` : null,
    item.description,
    item.categories.length ? `Categories: ${item.categories.join(', ')}` : null,
    item.dependencies.length ? `Uses: ${item.dependencies.join(', ')}` : null,
    item.registryDeps.length
      ? `Composes: ${item.registryDeps.map((d) => stripScope(id, d)).join(', ')}`
      : null,
    item.motion ? 'Animated: honours prefers-reduced-motion.' : null,
    // Embedded so a query like "react flow stylesheet" can actually retrieve the item
    // that needs one. Whitespace-collapsed: the raw string is multi-line for the CLI's
    // benefit, and a facet is one flat block of prose.
    item.docs ? `Setup: ${item.docs.replace(/\s+/g, ' ').trim()}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** Identity + items in one pass, so registry.json is read exactly once. */
export function loadRegistry(root: string = registryRoot()): {
  identity: RegistryIdentity
  items: Item[]
} {
  const identity = readIdentity(root)
  return { identity, items: loadItems(root, identity) }
}

export function loadItems(
  root: string = registryRoot(),
  identity: RegistryIdentity = readIdentity(root),
): Item[] {
  const rDir = path.join(root, 'public', 'r')
  const labels = readGroupLabels(root)
  const items: Item[] = []

  for (const file of readdirSync(rDir).sort()) {
    if (!file.endsWith('.json') || file === 'registry.json') continue
    // Demo payloads (`<name>.demo.json`, served for the MCP's web engine) are
    // NOT item payloads. Skipped by name, not by the `!j.type` accident below —
    // that guard is an is-this-an-item heuristic, not a contract.
    if (file.endsWith('.demo.json')) continue

    const raw: unknown = JSON.parse(readFileSync(path.join(rDir, file), 'utf8'))
    const j = raw as RegistryItemJson
    if (!j.name || !j.type) continue

    const categories = j.categories ?? []
    const groupSlug = primaryGroup(categories)
    const first = j.files?.[0]
    // files[0] is the public surface; EVERY other file the payload ships rides
    // with it — the `*.parts.tsx` sibling convention AND any additional module
    // a multi-file block carries (blog-01's article-item.tsx). files[0] imports
    // them, so embedding or serving it alone hands back dangling imports. The
    // parts_* column names predate the broader rule and stay for schema
    // stability: read them as "sibling files".
    const partsFiles = (j.files ?? [])
      .slice(1)
      .filter((f): f is RegistryItemFile & { content: string } => typeof f.content === 'string')

    const demoPath = groupSlug ? path.join(root, 'src', 'demos', groupSlug, `${j.name}.tsx`) : null

    items.push({
      name: j.name,
      type: j.type,
      title: j.title ?? j.name,
      description: j.description ?? '',
      groupSlug,
      // No `?? groupSlug` fallback: assertLabelsCover below makes it unreachable,
      // and it was what silently shipped 40 items labelled "themes".
      groupLabel: groupSlug ? (labels.get(groupSlug) ?? null) : null,
      categories,
      dependencies: j.dependencies ?? [],
      registryDeps: j.registryDependencies ?? [],
      docs: j.docs ?? null,
      provenance: j.meta?.provenance ?? null,
      sourceUrl: j.meta?.sourceUrl ?? null,
      license: j.meta?.license ?? null,
      motion: j.meta?.motion === true,
      filePath: first?.path ?? null,
      source: first?.content ?? null,
      partsFilePath: partsFiles.length ? (partsFiles.map((f) => f.path).join(', ') ?? null) : null,
      partsSource: partsFiles.length ? partsFiles.map((f) => f.content).join('\n\n') : null,
      demoSource: demoPath && existsSync(demoPath) ? readFileSync(demoPath, 'utf8') : null,
      installCmd: installCommand(identity, [j.name]),
      docUrl: docUrl(identity, groupSlug, j.name, j.type),
    })
  }

  if (items.length === 0) {
    throw new Error(`no items found under ${rDir} — run \`npm run registry:build\` first`)
  }
  assertLabelsCover(
    items.map((i) => i.groupSlug),
    labels,
  )
  return items
}

/**
 * Three facets per item. Structure-aware rather than fixed-size: one file IS one
 * component, and at 32K context the largest component (sidebar, ~6.7K tokens)
 * fits whole, so code is never split mid-component.
 */
export function toChunks(items: readonly Item[], id: RegistryIdentity): Chunk[] {
  const chunks: Chunk[] = []
  for (const item of items) {
    chunks.push({ itemName: item.name, facet: 'doc', text: docFacet(item, id) })
    if (item.source) {
      // The decorated sibling rides along in the embedded text only — display
      // surfaces (source column, get_component_source) keep serving files[0].
      const code = item.partsSource ? `${item.source}\n\n${item.partsSource}` : item.source
      chunks.push({ itemName: item.name, facet: 'code', text: code })
    }
    if (item.demoSource) chunks.push({ itemName: item.name, facet: 'demo', text: item.demoSource })
  }
  return chunks
}

/**
 * FTS5 name column. Both the slug and its de-hyphenated form are indexed so
 * "magnetic button" (two tokens) matches `magnetic-button`, alongside the title.
 */
export const ftsName = (item: Pick<Item, 'name' | 'title'>): string =>
  `${item.name} ${item.name.replace(/-/g, ' ')} ${item.title}`

/**
 * Content hash of exactly what gets embedded — the value stored as `meta.registry_hash`.
 *
 * This lives here, called by BOTH the builder and `verify`, because it previously did
 * not: build.ts held the expression inline and a checker re-typed it with different
 * delimiters, so the two disagreed and reported a corrupt index that was in fact fine.
 * A hash whose definition exists twice is a hash that eventually lies.
 *
 * Fields are delimited by \u0000 and records by \u0001. Control characters cannot occur
 * in TSX source, so no combination of name / facet / text can collide by concatenating
 * differently. They must be written as ESCAPES — literal control bytes in the source
 * make git classify the file as binary and silently stop diffing it.
 */
export function contentHash(chunks: readonly Chunk[]): string {
  return createHash('sha256')
    .update(chunks.map((c) => `${c.itemName}\u0000${c.facet}\u0000${c.text}`).join('\u0001'))
    .digest('hex')
    .slice(0, 16)
}
