import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { DIMS, assertModelContract, modelContract } from '../src/config.ts'
import {
  VEC0_MAX_K,
  createIndex,
  knnCeiling,
  openIndex,
  readIdentity,
  readIndexMeta,
  readMeta,
  toVecKey,
  toVectorBlob,
  writeMeta,
} from '../src/db.ts'
import { buildFixtureIndex } from './fixtures/index-fixture.ts'

const db = buildFixtureIndex([{ name: 'a' }, { name: 'b' }])
after(() => {
  db.close()
})

test('toVecKey produces the BigInt vec0 demands for its primary key', () => {
  assert.equal(typeof toVecKey(1), 'bigint')
  assert.equal(toVecKey(438), 438n)
})

test('toVectorBlob round-trips float32 at the declared width', () => {
  const v = [0.5, -0.25, 1]
  const blob = toVectorBlob(v)
  assert.ok(Buffer.isBuffer(blob), 'better-sqlite3 rejects a Float32Array as a BLOB')
  assert.equal(blob.byteLength, v.length * 4)
  assert.deepEqual([...new Float32Array(blob.buffer, blob.byteOffset, v.length)], v)
})

test('knnCeiling is min(corpus, the vec0 limit) and is memoised', () => {
  assert.equal(knnCeiling(db), 2)
  assert.equal(knnCeiling(db), 2, 'second call hits the cache')
  assert.equal(VEC0_MAX_K, 4096)
})

test('writeMeta then readMeta round-trips the embedding contract', () => {
  const fresh = createIndex(':memory:')
  writeMeta(fresh, { registry_hash: 'abc' })
  const meta = readMeta(fresh)
  for (const [k, v] of Object.entries(modelContract())) assert.equal(meta[k], v)
  assert.doesNotThrow(() => {
    assertModelContract(meta)
  })
  fresh.close()
})

test('assertModelContract names the drifted key', () => {
  assert.throws(
    () => {
      assertModelContract({ ...modelContract(), model_dtype: 'q8' })
    },
    (err: Error) => {
      assert.match(err.message, /model_dtype: index=q8 code=fp16/)
      assert.match(err.message, /build:index/, 'says what to do about it')
      return true
    },
  )
})

test('assertModelContract reports a missing key rather than passing it', () => {
  const partial = { ...modelContract() } as Record<string, string>
  delete partial.query_task
  assert.throws(() => {
    assertModelContract(partial)
  }, /query_task: index=\(missing\)/)
})

test('readIndexMeta resolves the provenance keys instead of yielding undefined', () => {
  const meta = readIndexMeta(db)
  assert.equal(meta.item_count, '2')
  assert.equal(meta.chunk_count, '2')
  assert.equal(meta.registry_hash, 'fixture')
  assert.equal(meta.model_dtype, 'fp16')
  assert.equal(typeof meta.built_at, 'string')
})

test('readIndexMeta throws rather than letting the banner print undefined', () => {
  const bare = createIndex(':memory:')
  bare.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('model_id', 'x')
  assert.throws(
    () => readIndexMeta(bare),
    /missing metadata: registry_hash, item_count, chunk_count/,
  )
  bare.close()
})

test('readIdentity requires both halves and refuses to guess', () => {
  assert.deepEqual(readIdentity(db), {
    scope: 'encode-ui',
    homepage: 'https://encode-ui.com',
  })

  const bare = createIndex(':memory:')
  writeMeta(bare, { registry_scope: 'encode-ui' })
  assert.throws(() => readIdentity(bare), /predates the stored registry identity/)
  bare.close()
})

test('the db engine surfaces persisted freshness digests, absent on old indexes', async () => {
  const { createDbEngineFromDb } = await import('../src/engine-db.ts')
  // The shared fixture predates the keys — the engine reports them undefined
  // (startup then says 'unverifiable' rather than assuming either answer).
  assert.equal(createDbEngineFromDb(db).meta.sourceDigests, undefined)

  // An index whose build persisted them (build.ts writeMeta) surfaces the triple.
  const fresh = buildFixtureIndex([{ name: 'c' }])
  writeMeta(fresh, { registry_json_sha256: 'r', groups_sha256: 'g', demos_digest: 'd' })
  assert.deepEqual(createDbEngineFromDb(fresh).meta.sourceDigests, {
    registryJsonSha256: 'r',
    groupsSha256: 'g',
    demosDigest: 'd',
  })
  fresh.close()
})

test('openIndex rethrows the ORIGINAL failure and releases the handle', (t) => {
  // Since the db→catalog fallback, an open failure no longer exits the
  // process — a handle leaked here would live for the server lifetime.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rag-openindex-'))
  t.after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // A real index whose embedding contract drifted: the assertModelContract
  // message must surface verbatim (not wrapped, not replaced).
  const stale = path.join(dir, 'stale.db')
  const build = createIndex(stale)
  writeMeta(build, { registry_hash: 'x', model_dtype: 'q8' })
  build.close()
  assert.throws(() => openIndex(stale), /model_dtype: index=q8/)

  // Not a database at all: the extension probe throws inside openIndex.
  const foreign = path.join(dir, 'foreign.db')
  writeFileSync(foreign, 'not a sqlite file, just bytes\n')
  assert.throws(() => openIndex(foreign))

  // Both failure paths closed their handle: a fresh open of the same paths
  // must behave identically (a still-held readonly handle would not block on
  // macOS, but a leaked one WOULD have kept `stale` pinned on Windows — this
  // asserts the deterministic part: same error, no state carried over).
  assert.throws(() => openIndex(stale), /model_dtype: index=q8/)
})

test('the fixture index is a real one — schema.sql applies verbatim', () => {
  const vectors = db.prepare('SELECT count(*) AS n FROM chunks_vec').get() as { n: number }
  assert.equal(vectors.n, 2)
  const probe = db.prepare('SELECT embedding FROM chunks_vec LIMIT 1').get() as {
    embedding: Buffer
  }
  assert.equal(probe.embedding.byteLength / 4, DIMS)
})
