// The prepack guard, spawned as prepack runs it, against fixture index.db files.
// Every fixture's three source digests equal the committed catalog's, so each
// verdict comes from the body-aware content hash: the 0.12.2 shape, where an
// index with stale component bodies carried digests equal to the catalog's.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { loadCatalog } from '../src/catalog.ts'
import { createIndex, writeMeta } from '../src/db.ts'
import { contentHash, loadRegistry, toChunks } from '../src/ingest.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GUARD = path.resolve(HERE, '..', 'scripts', 'check-pack-index.mjs')
const TMP = mkdtempSync(path.join(os.tmpdir(), 'pack-index-'))
after(() => {
  rmSync(TMP, { recursive: true, force: true })
})

const { sources } = loadCatalog()
const { identity, items } = loadRegistry()
const freshHash = contentHash(toChunks(items, identity))

/** An index.db whose digests match the committed catalog, built with `registryHash`. */
function fixtureIndex(name: string, registryHash: string): string {
  const file = path.join(TMP, name)
  const db = createIndex(file)
  writeMeta(db, {
    registry_hash: registryHash,
    registry_json_sha256: sources.registryJsonSha256,
    groups_sha256: sources.groupsSha256,
    demos_digest: sources.demosDigest,
  })
  db.close()
  return file
}

const runGuard = (indexPath: string, env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, ['--experimental-strip-types', GUARD, indexPath], {
    env,
    encoding: 'utf8',
  })

test('refuses an index.db with stale bodies although its digests match', () => {
  const r = runGuard(fixtureIndex('stale.db', '67f8cc396477a262'))
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /67f8cc396477a262/)
  assert.match(r.stderr, new RegExp(freshHash))
})

test('accepts an index.db built from the current registry', () => {
  const r = runGuard(fixtureIndex('fresh.db', freshHash))
  assert.equal(r.status, 0, r.stderr)
})

test('refuses an index.db when the registry tree cannot be read', () => {
  const empty = mkdtempSync(path.join(TMP, 'no-registry-'))
  const r = runGuard(fixtureIndex('orphan.db', freshHash), {
    ...process.env,
    ENCODE_UI_REGISTRY_ROOT: empty,
  })
  assert.equal(r.status, 1, r.stderr)
})

test('packs a catalog-only tarball when there is no index.db', () => {
  const r = runGuard(path.join(TMP, 'absent.db'))
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /catalog-only/)
})
