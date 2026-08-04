// Build the index: ingest → embed → write. Run via `npm run build:index`.
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CONTEXT_TOKENS, DIMS } from './config.ts'
import { fitsContext } from './text.ts'
import { createIndex, defaultIndexPath, toVecKey, toVectorBlob, writeMeta } from './db.ts'
import { countTokens, embedDocuments } from './embed.ts'
import { contentHash, ftsName, loadRegistry, registryRoot, toChunks } from './ingest.ts'
import { sourceDigestsOf } from './source-digests.ts'
import type { Item } from './items.ts'

const indexPath = defaultIndexPath()

console.log(`registry root : ${registryRoot()}`)
console.log(`index path    : ${indexPath}`)

const { identity, items } = loadRegistry()
const chunks = toChunks(items, identity)
const byName = new Map<string, Item>(items.map((i) => [i.name, i]))

console.log(`registry      : @${identity.scope} · ${identity.homepage}`)
console.log(`items         : ${items.length}`)
console.log(
  `chunks        : ${chunks.length} ` +
    `(doc ${chunks.filter((c) => c.facet === 'doc').length}, ` +
    `code ${chunks.filter((c) => c.facet === 'code').length}, ` +
    `demo ${chunks.filter((c) => c.facet === 'demo').length})`,
)

const registryHash = contentHash(chunks)

// Truncation guard, on REAL tokenizer counts (the model's own tokenizer, over
// the exact document form that gets embedded — an estimate could pass a chunk
// the model then silently truncates). Runs BEFORE the embed and BEFORE the old
// index is deleted: a violating corpus used to burn the ~15-minute embed and
// destroy the last good index.db before the old post-write check ever fired.
const nTokens = await countTokens(chunks.map((c) => c.text))
const maxTokens = Math.max(...nTokens)
const widest = chunks[nTokens.indexOf(maxTokens)]
console.log(
  `max chunk     : ${maxTokens} tokens (${widest?.itemName}/${widest?.facet}) — limit ${CONTEXT_TOKENS}`,
)
if (!fitsContext(maxTokens, CONTEXT_TOKENS)) {
  throw new Error(`chunk exceeds the model context window: ${widest?.itemName}/${widest?.facet}`)
}

const t0 = Date.now()
const vectors = await embedDocuments(
  chunks.map((c) => c.text),
  (done, total) => process.stderr.write(`\rembedding ${done}/${total}`),
)
process.stderr.write('\n')
console.log(`embedded      : ${((Date.now() - t0) / 1000).toFixed(1)}s`)

// Rebuild from scratch — an incremental path would be a second source of truth.
rmSync(indexPath, { force: true })
rmSync(`${indexPath}-wal`, { force: true })
rmSync(`${indexPath}-shm`, { force: true })

const db = createIndex(indexPath)

const insItem = db.prepare(`
  INSERT INTO items (name, type, title, description, group_slug, group_label, categories,
                     dependencies, registry_deps, docs, provenance, source_url, license, motion,
                     file_path, source, parts_file_path, parts_source, demo_source, install_cmd,
                     doc_url)
  VALUES (@name, @type, @title, @description, @group_slug, @group_label, @categories,
          @dependencies, @registry_deps, @docs, @provenance, @source_url, @license, @motion,
          @file_path, @source, @parts_file_path, @parts_source, @demo_source, @install_cmd,
          @doc_url)`)

const insChunk = db.prepare(
  'INSERT INTO chunks (id, item_name, facet, text, n_tokens) VALUES (?, ?, ?, ?, ?)',
)
const insFts = db.prepare('INSERT INTO chunks_fts (name, text, chunk_id) VALUES (?, ?, ?)')
const insVec = db.prepare('INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)')

db.transaction(() => {
  for (const it of items) {
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
      docs: it.docs,
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
  }

  chunks.forEach((c, i) => {
    const id = i + 1
    const item = byName.get(c.itemName)
    if (!item) throw new Error(`chunk references unknown item ${c.itemName}`)
    insChunk.run(id, c.itemName, c.facet, c.text, nTokens[i]!)
    insFts.run(ftsName(item), c.text, id)
    // BigInt key + Buffer vector — both required by vec0 (see db.ts).
    insVec.run(toVecKey(id), toVectorBlob(vectors[i]!))
  })

  const digests = sourceDigestsOf(registryRoot())
  writeMeta(db, {
    registry_hash: registryHash,
    chunk_count: String(chunks.length),
    item_count: String(items.length),
    // Not part of the EMBEDDING contract (assertModelContract ignores them), so
    // changing the docs origin does not invalidate the vectors — but they must be
    // stored, because the server has no access to the registry tree at runtime.
    registry_scope: identity.scope,
    registry_homepage: identity.homepage,
    // Freshness digests of the sources this index was built from — startup
    // compares them against the committed agent-index.json's `sources` and
    // warns on drift (the two artifacts' registry hashes are DIFFERENT
    // definitions and can never be compared directly).
    registry_json_sha256: digests.registryJsonSha256,
    groups_sha256: digests.groupsSha256,
    demos_digest: digests.demosDigest,
    built_at: new Date().toISOString(),
  })
})()

const { n } = db.prepare('SELECT count(*) AS n FROM chunks_vec').get() as { n: number }
console.log(`vectors       : ${n} × ${DIMS}`)
console.log(`registry_hash : ${registryHash}`)

db.close()

writeFileSync(
  path.join(path.dirname(indexPath), 'index.meta.json'),
  JSON.stringify({ registryHash, items: items.length, chunks: chunks.length, dims: DIMS }, null, 2),
)
console.log(`\n✅ ${indexPath}`)
