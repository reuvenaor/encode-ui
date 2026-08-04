// SQLite + sqlite-vec plumbing. Owns schema application, the meta table, and the
// two vector-binding rules that sqlite-vec (pre-v1) enforces at runtime.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sqliteVec from 'sqlite-vec'
import Database from 'better-sqlite3'
import { assertModelContract, modelContract } from './config.ts'
import { packageIndexPath } from './engine.ts'
import type { ModelContract } from './config.ts'
import type { RegistryIdentity } from './registry-id.ts'

export type DB = Database.Database

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Default for the build/verify CLIs (env wins there). The SERVER never hits
 *  this — it passes an explicit --registry-index path and scrubs the var. */
export const defaultIndexPath = (): string => process.env.ENCODE_UI_RAG_INDEX ?? packageIndexPath()

/**
 * A Float32Array is NOT accepted by better-sqlite3 as a BLOB — it must be a
 * Buffer over the same memory. Centralised so the conversion can never be
 * forgotten at one call site.
 */
export const toVectorBlob = (v: ArrayLike<number>): Buffer =>
  Buffer.from(new Float32Array(v).buffer)

/**
 * vec0 rejects a SQLITE_FLOAT primary key, and better-sqlite3 v13 binds plain JS
 * numbers as floats. Every chunk_id crossing into a vec0 statement goes through here.
 */
export const toVecKey = (id: number): bigint => BigInt(id)

/**
 * vec0's default metric is L2 (schema.sql declares no `distance_metric`), and the
 * stored vectors are unit-normalized (config.ts NORMALIZE) — so the true cosine
 * similarity is 1 − d²/2, NOT 1 − d. The linear form under-reported every
 * similarity (button → button-group read 0.394 instead of ≈0.816) and pushed
 * far-tail neighbours negative, which cosine between related doc-cards cannot be.
 */
export const l2ToCosine = (d: number): number => 1 - (d * d) / 2

/**
 * vec0 rejects `k` above 4096 ("k value in knn query too large"), so the largest
 * legal "rank everything" request is min(corpus, 4096).
 *
 * Ranking the whole corpus is the point: vec0 is EXACT brute force — it computes
 * every distance regardless of `k`, which only bounds the result heap — so a KNN
 * constraint evaluated BEFORE the joins cannot be combined with a SQL filter
 * without silently truncating. Raising `k` to the ceiling and letting SQL filter
 * costs ~0.3ms and removes the over-fetch guesswork entirely.
 *
 * Memoised per database handle: it is a fixed property of a built index.
 */
const knnCeilings = new WeakMap<object, number>()

export const VEC0_MAX_K = 4096

export function knnCeiling(db: DB): number {
  const cached = knnCeilings.get(db)
  if (cached !== undefined) return cached
  const { n } = db.prepare('SELECT count(*) AS n FROM chunks_vec').get() as { n: number }
  const ceiling = Math.min(n, VEC0_MAX_K)
  knnCeilings.set(db, ceiling)
  return ceiling
}

function loadExtension(db: DB): void {
  sqliteVec.load(db)
  // Fail now, with a clear message, rather than at the first MATCH.
  db.prepare('SELECT vec_version() AS v').get()
}

/** Create a fresh index, applying schema.sql verbatim. Throws if the DDL fails. */
export function createIndex(indexPath: string): DB {
  const db = new Database(indexPath)
  loadExtension(db)
  const ddl = readFileSync(path.resolve(HERE, 'schema.sql'), 'utf8')
  try {
    db.exec(ddl)
  } catch (err) {
    throw new Error(`schema.sql failed to apply: ${(err as Error).message}`)
  }
  return db
}

/** Open an existing index read-only and verify it matches the running contract. */
export function openIndex(indexPath: string = defaultIndexPath()): DB {
  const db = new Database(indexPath, { readonly: true, fileMustExist: true })
  // The verification steps can throw (foreign file, stale contract) AFTER the
  // handle exists. Close before rethrowing: since the db→catalog fallback, an
  // open failure no longer exits the process, and a leaked read-only handle
  // (+WAL/-shm mapping) would otherwise live for the whole server lifetime —
  // on Windows it also file-locks index.db against a concurrent rebuild.
  try {
    loadExtension(db)
    assertModelContract(readMeta(db))
  } catch (err) {
    db.close()
    throw err
  }
  return db
}

/**
 * Scope + docs origin, as persisted at build time from the registry's own manifest.
 *
 * Throws rather than defaulting: a hardcoded fallback would be exactly the second
 * copy this indirection exists to remove, and would silently stamp the wrong scope
 * onto every install command if the registry were ever renamed.
 */
export function readIdentity(db: DB): RegistryIdentity {
  const meta = readMeta(db)
  const scope = meta.registry_scope
  const homepage = meta.registry_homepage
  if (!scope || !homepage) {
    throw new Error(
      'RAG index predates the stored registry identity (meta.registry_scope / registry_homepage).\n' +
        'Rebuild it with `npm run build:index` inside registry/rag.',
    )
  }
  return { scope, homepage }
}

export function readMeta(db: DB): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/** The build-provenance keys, as opposed to the embedding contract config.ts owns. */
export interface IndexMeta {
  registry_hash: string
  item_count: string
  chunk_count: string
  model_id: string
  model_dtype: string
  built_at: string
}

const INDEX_META_KEYS = [
  'registry_hash',
  'item_count',
  'chunk_count',
  'model_id',
  'model_dtype',
  'built_at',
] as const satisfies readonly (keyof IndexMeta)[]

/**
 * readMeta returns Record<string, string>, and under noUncheckedIndexedAccess
 * every lookup is `string | undefined` — so the startup banner interpolated
 * `undefined items / undefined chunks` for an index missing them, reporting a
 * broken index as a working one. Resolve the keys once, loudly.
 */
export function readIndexMeta(db: DB): IndexMeta {
  const meta = readMeta(db)
  const missing = INDEX_META_KEYS.filter((k) => meta[k] === undefined)
  if (missing.length > 0) {
    throw new Error(
      `RAG index is missing metadata: ${missing.join(', ')}.\n` +
        'Rebuild it with `npm run build:index` inside registry/rag.',
    )
  }
  return Object.fromEntries(INDEX_META_KEYS.map((k) => [k, meta[k]])) as unknown as IndexMeta
}

export function writeMeta(db: DB, extra: Readonly<Record<string, string>>): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
  const all: Record<string, string> = {
    ...(modelContract() as unknown as Record<string, string>),
    ...extra,
  }
  for (const [k, v] of Object.entries(all)) stmt.run(k, v)
}

export type { ModelContract }
