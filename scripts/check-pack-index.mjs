// Pack guard: refuse to ship a stale rag/index.db inside the tarball.
//
// `files` includes index.db, prepack no longer rebuilds it (a rebuild needs
// the native stack + the embedding model — packing must stay zero-native),
// and a shipped index is what --registry-engine db serves (selection is
// explicit now — the web engine is the default — but an operator opting into
// the db deserves a fresh one). Without this check a months-old index would
// silently ship stale in every consumer install.
// Freshness = the source digests build:index persists
// into the meta table vs the committed agent-index.json's `sources` — the two
// artifacts' registry hashes are DIFFERENT definitions and never comparable.
//
// Wired as: "prepack": "node scripts/check-pack-index.mjs && npm run build".
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const INDEX = path.join(ROOT, 'index.db')
const ARTIFACT = path.join(ROOT, 'agent-index.json')

const fail = (lines) => {
  for (const l of lines) process.stderr.write(`[check-pack-index] ${l}\n`)
  process.exit(1)
}

if (!existsSync(INDEX)) {
  process.stderr.write('[check-pack-index] no index.db — packing a catalog-only tarball.\n')
  process.exit(0)
}

const { sources } = JSON.parse(readFileSync(ARTIFACT, 'utf8'))

let meta
try {
  // Only the meta table is read — no sqlite-vec, no schema assumptions beyond
  // it. A machine that BUILT an index.db has a working better-sqlite3; one
  // where the native import fails cannot verify the file and must not ship it.
  const { default: Database } = await import('better-sqlite3')
  const db = new Database(INDEX, { readonly: true, fileMustExist: true })
  try {
    meta = Object.fromEntries(
      db
        .prepare('SELECT key, value FROM meta')
        .all()
        .map((r) => [r.key, r.value]),
    )
  } finally {
    db.close()
  }
} catch (err) {
  fail([
    `index.db exists but cannot be read here: ${err.message}`,
    'Fix the native install (or delete index.db) before packing — an unverifiable db must not ship.',
  ])
}

const stored = {
  registryJsonSha256: meta.registry_json_sha256,
  groupsSha256: meta.groups_sha256,
  demosDigest: meta.demos_digest,
}
if (Object.values(stored).some((v) => v === undefined)) {
  fail([
    'index.db predates the source-freshness digests — its corpus cannot be verified.',
    'Rebuild it (`npm run build:index`) or delete it before `npm pack`.',
  ])
}
const drifted = Object.entries(stored)
  .filter(([k, v]) => v !== sources[k])
  .map(([k]) => k)
if (drifted.length > 0) {
  fail([
    `index.db is STALE against the committed agent-index.json (${drifted.join(', ')} differ).`,
    'Rebuild it (`npm run build:index`) or delete it before `npm pack`.',
  ])
}
process.stderr.write(
  '[check-pack-index] index.db matches the committed catalog — packing both engines.\n',
)
