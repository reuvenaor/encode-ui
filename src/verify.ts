// Integrity check for a built index: `npm run verify`.
//
// Exists because the failure mode this package is most exposed to is a STALE index
// that still answers queries — plausibly, and wrongly. Every check below either
// passes or exits non-zero; none of them warn and continue.
import { CONTEXT_TOKENS, DIMS } from './config.ts'
import { fitsContext } from './text.ts'
import { VEC0_MAX_K, defaultIndexPath, openIndex, readMeta } from './db.ts'
import { contentHash, loadRegistry, toChunks } from './ingest.ts'
import type { DB } from './db.ts'

const indexPath = defaultIndexPath()
const fail: string[] = []
const ok: string[] = []

// 1. Opens at all, and the embedding contract matches the running code.
//    openIndex() throws on drift — that IS the check.
let db: DB
try {
  db = openIndex(indexPath)
  ok.push('embedding contract matches config.ts')
} catch (err) {
  console.error(`❌ ${(err as Error).message}`)
  process.exit(1)
}

const meta = readMeta(db)

// 2. The index was built from the registry as it exists right now.
const { identity, items: freshItems } = loadRegistry()
const fresh = toChunks(freshItems, identity)
const freshHash = contentHash(fresh)
if (freshHash === meta.registry_hash) {
  ok.push(`content hash matches registry (${freshHash})`)
} else {
  fail.push(
    `content drift: index=${meta.registry_hash} registry=${freshHash} — run \`npm run build:index\``,
  )
}

// 3. Row counts agree with the metadata AND with a fresh ingest.
const chunkRows = (db.prepare('SELECT count(*) AS n FROM chunks').get() as { n: number }).n
const vecRows = (db.prepare('SELECT count(*) AS n FROM chunks_vec').get() as { n: number }).n
const ftsRows = (db.prepare('SELECT count(*) AS n FROM chunks_fts').get() as { n: number }).n
const itemRows = (db.prepare('SELECT count(*) AS n FROM items').get() as { n: number }).n

if (chunkRows === vecRows && chunkRows === ftsRows)
  ok.push(`chunks/vectors/fts aligned (${chunkRows})`)
else fail.push(`row mismatch: chunks=${chunkRows} vectors=${vecRows} fts=${ftsRows}`)

if (chunkRows === fresh.length) ok.push(`chunk count matches fresh ingest (${chunkRows})`)
else fail.push(`chunk count: index=${chunkRows} fresh=${fresh.length}`)

if (String(itemRows) === meta.item_count) ok.push(`items (${itemRows})`)
else fail.push(`item count: rows=${itemRows} meta=${meta.item_count}`)

// 3b. install_cmd / doc_url are MATERIALISED derivations of the registry identity.
//     They stay stored columns (dropping them would be a schema change, hence a
//     forced re-embed, for no query-time gain) — so assert the cache equals the
//     derivation instead, which is what keeps "one source of truth" honest.
const derivedMismatch = freshItems
  .map((it) => {
    const row = db
      .prepare('SELECT install_cmd AS installCmd, doc_url AS docUrl FROM items WHERE name = ?')
      .get(it.name) as { installCmd: string; docUrl: string } | undefined
    if (!row) return `${it.name}: missing from index`
    if (row.installCmd !== it.installCmd)
      return `${it.name}: install_cmd ${row.installCmd} != ${it.installCmd}`
    if (row.docUrl !== it.docUrl) return `${it.name}: doc_url ${row.docUrl} != ${it.docUrl}`
    return null
  })
  .filter((m): m is string => m !== null)

if (derivedMismatch.length === 0) {
  ok.push(`install_cmd/doc_url match the derivation for all ${freshItems.length} items`)
} else {
  fail.push(
    `derived column drift (${derivedMismatch.length}): ${derivedMismatch.slice(0, 3).join('; ')}`,
  )
}

// 3c. The identity the server will read at runtime is present and matches the registry.
const storedScope = meta.registry_scope
const storedHomepage = meta.registry_homepage
if (storedScope === identity.scope && storedHomepage === identity.homepage) {
  ok.push(`registry identity @${storedScope} · ${storedHomepage}`)
} else {
  fail.push(
    `registry identity: index=@${storedScope ?? '(missing)'} ${storedHomepage ?? '(missing)'} ` +
      `registry=@${identity.scope} ${identity.homepage} — run \`npm run build:index\``,
  )
}

// 4. Nothing was silently truncated by the model's context window. Same
//    boundary predicate as the build gate — they used to disagree at exactly
//    the limit.
const maxTok = (db.prepare('SELECT max(n_tokens) AS m FROM chunks').get() as { m: number }).m
if (fitsContext(maxTok, CONTEXT_TOKENS))
  ok.push(`max chunk ${maxTok} tokens <= ${CONTEXT_TOKENS} context`)
else fail.push(`chunk exceeds context window: ${maxTok} tokens`)

// 4b. Retrieval ranks the whole corpus by asking vec0 for k = chunk_count, which
//     it refuses above 4096. Past that the dense arm would silently truncate
//     instead of filtering — the exact class of quiet wrongness this file exists
//     to catch. Sharding or an ANN index is the answer if the corpus ever grows
//     that far; until then, assert the assumption.
if (chunkRows <= VEC0_MAX_K) ok.push(`chunks ${chunkRows} <= vec0 k ceiling ${VEC0_MAX_K}`)
else {
  fail.push(
    `chunks ${chunkRows} exceeds the vec0 k ceiling ${VEC0_MAX_K} — the dense arm can no ` +
      'longer rank the full corpus; see knnCeiling() in db.ts',
  )
}

// 5. Every facet is represented — a silent ingest regression (e.g. a renamed demo
//    directory) would otherwise just quietly drop a whole retrieval signal.
const facets = db.prepare('SELECT facet, count(*) AS n FROM chunks GROUP BY facet').all() as {
  facet: string
  n: number
}[]
const seen = new Set(facets.map((f) => f.facet))
for (const f of ['doc', 'code', 'demo']) {
  if (!seen.has(f)) fail.push(`facet '${f}' has zero chunks`)
}
if (seen.size === 3) ok.push(`facets: ${facets.map((f) => `${f.facet}=${f.n}`).join(' ')}`)

// 6. A vector actually round-trips at the declared width.
const probe = db.prepare('SELECT embedding FROM chunks_vec LIMIT 1').get() as
  | { embedding: Buffer }
  | undefined
const width = probe ? probe.embedding.byteLength / 4 : 0
if (width === DIMS) ok.push(`vectors are ${DIMS}-dim float32`)
else fail.push(`vector width ${width} != ${DIMS}`)

db.close()

for (const line of ok) console.log(`  ✅ ${line}`)
for (const line of fail) console.log(`  ❌ ${line}`)
console.log(fail.length === 0 ? `\n✅ index OK — ${indexPath}` : `\n❌ ${fail.length} problem(s)`)
process.exit(fail.length === 0 ? 0 : 1)
