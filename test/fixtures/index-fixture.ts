// An in-memory index with a handful of items, for tests that need real SQL.
//
// Not a mock: schema.sql is applied verbatim, vec0 and FTS5 both work in :memory:,
// and search() under ENCODE_UI_RAG_LEXICAL_ONLY=1 plus findSimilar() (which reads a
// STORED vector) need no model at all. A full retrieval round-trip costs ~50ms and
// downloads nothing.
import { createIndex, toVecKey, toVectorBlob, writeMeta } from '../../src/db.ts'
import { DIMS } from '../../src/config.ts'
import { ftsName } from '../../src/ingest.ts'
import { approxTokens } from '../../src/text.ts'
import { docUrl, installCommand } from '../../src/registry-id.ts'
import type { DB } from '../../src/db.ts'
import type { Item } from '../../src/items.ts'
import type { RegistryIdentity } from '../../src/registry-id.ts'

export const FIXTURE_ID: RegistryIdentity = {
  scope: 'encode-ui',
  homepage: 'https://encode-ui.com',
}

export interface FixtureSpec {
  name: string
  group?: string | null
  type?: string
  motion?: boolean
  title?: string
  description?: string
  /** Extra words folded into the doc text so FTS has something to match. */
  keywords?: string
  /** npm deps; defaults to ['motion'] (the historical fixture assumption). */
  dependencies?: string[]
  /** Composition edges; defaults to ['@<scope>/utils']. */
  registryDeps?: string[]
  /** Ship a .parts.tsx sibling alongside files[0] (the split-item shape). */
  partsLayer?: boolean
  /** Post-install setup the payload cannot perform itself (shadcn's `docs`). */
  docs?: string
}

/**
 * A deterministic unit vector. `seed` rotates it in the first two dimensions, so
 * distances are stable and ordered without invoking the model.
 */
function pseudoVector(seed: number): number[] {
  const v = new Array<number>(DIMS).fill(0)
  const theta = (seed * Math.PI) / 64
  v[0] = Math.cos(theta)
  v[1] = Math.sin(theta)
  return v
}

export function toItem(spec: FixtureSpec, id: RegistryIdentity = FIXTURE_ID): Item {
  const group = spec.group === undefined ? 'buttons' : spec.group
  return {
    name: spec.name,
    type: spec.type ?? 'registry:ui',
    title: spec.title ?? spec.name,
    description: spec.description ?? `A ${spec.name} component`,
    groupSlug: group,
    groupLabel: group ? group[0]!.toUpperCase() + group.slice(1) : null,
    categories: group ? ['base', group] : ['base'],
    dependencies: spec.dependencies ?? ['motion'],
    registryDeps: spec.registryDeps ?? [`@${id.scope}/utils`],
    docs: spec.docs ?? null,
    provenance: 'original',
    sourceUrl: null,
    license: null,
    motion: spec.motion ?? false,
    filePath: `src/registry/components/${group ?? 'lib'}/${spec.name}.tsx`,
    source: `export function ${spec.name}() { return null }`,
    partsFilePath: spec.partsLayer
      ? `src/registry/components/${group ?? 'lib'}/${spec.name}.parts.tsx`
      : null,
    partsSource: spec.partsLayer ? `export const ${spec.name}Surface = () => null` : null,
    demoSource: null,
    installCmd: installCommand(id, [spec.name]),
    docUrl: docUrl(id, group, spec.name, spec.type ?? 'registry:ui'),
  }
}

/** Build an in-memory index over the given specs. One `doc` chunk per item. */
export function buildFixtureIndex(specs: readonly FixtureSpec[]): DB {
  const db = createIndex(':memory:')
  const items = specs.map((s) => toItem(s))

  const insItem = db.prepare(`
    INSERT INTO items (name, type, title, description, group_slug, group_label, categories,
                       dependencies, registry_deps, provenance, source_url, license, motion,
                       file_path, source, parts_file_path, parts_source, demo_source, install_cmd,
                       doc_url)
    VALUES (@name, @type, @title, @description, @group_slug, @group_label, @categories,
            @dependencies, @registry_deps, @provenance, @source_url, @license, @motion,
            @file_path, @source, @parts_file_path, @parts_source, @demo_source, @install_cmd,
            @doc_url)`)
  const insChunk = db.prepare(
    'INSERT INTO chunks (id, item_name, facet, text, n_tokens) VALUES (?, ?, ?, ?, ?)',
  )
  const insFts = db.prepare('INSERT INTO chunks_fts (name, text, chunk_id) VALUES (?, ?, ?)')
  const insVec = db.prepare('INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)')

  db.transaction(() => {
    items.forEach((it, i) => {
      insItem.run({
        name: it.name,
        type: it.type,
        title: it.title,
        description: it.description,
        group_slug: it.groupSlug,
        group_label: it.groupLabel,
        categories: JSON.stringify(it.categories),
        dependencies: JSON.stringify(it.dependencies),
        registry_deps: JSON.stringify(it.registryDeps),
        provenance: it.provenance,
        source_url: it.sourceUrl,
        license: it.license,
        motion: it.motion ? 1 : 0,
        file_path: it.filePath,
        source: it.source,
        parts_file_path: it.partsFilePath,
        parts_source: it.partsSource,
        demo_source: it.demoSource,
        install_cmd: it.installCmd,
        doc_url: it.docUrl,
      })
      const id = i + 1
      const spec = specs[i]!
      const docText = `${it.title} (${it.name})\n${it.description}\n${spec.keywords ?? ''}`
      insChunk.run(id, it.name, 'doc', docText, approxTokens(docText))
      insFts.run(ftsName(it), docText, id)
      insVec.run(toVecKey(id), toVectorBlob(pseudoVector(i)))
    })
    writeMeta(db, {
      registry_hash: 'fixture',
      chunk_count: String(items.length),
      item_count: String(items.length),
      registry_scope: FIXTURE_ID.scope,
      registry_homepage: FIXTURE_ID.homepage,
      built_at: '1970-01-01T00:00:00.000Z',
    })
  })()

  return db
}
