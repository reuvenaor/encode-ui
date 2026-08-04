// The semantic engine: RegistryEngine over rag/index.db — a verbatim wrap of
// the existing retrieval functions (search.ts hybrid RRF, items.ts SQL), so
// behavior through the tools is byte-identical to the pre-engine layering.
//
// This is the ONLY module besides db.ts / search.ts / embed.ts that touches
// native code, and mcp.ts imports it DYNAMICALLY — a machine where
// better-sqlite3 failed to build still gets the catalog engine.
import { openIndex, readIdentity, readIndexMeta, readMeta } from './db.ts'
import {
  dependencyClosure,
  fetchDetail,
  groupSlugs,
  hasDocVector,
  jsonStringList,
  knownNames,
  listComponentRows,
  listGroupRows,
  suggestNames,
} from './items.ts'
import { findSimilar, search } from './search.ts'
import type { DB } from './db.ts'
import type { EngineDetail, RegistryEngine, SourceResult } from './engine.ts'
import type { ItemDetailRow } from './items.ts'

/**
 * Byte length, not character count — what the caller actually pays to receive.
 * Variadic because `part:"source"` returns the public module AND its parts
 * layer; a figure covering only files[0] would understate every split item.
 * (Moved here from mcp/build.ts — the builders now receive the numbers.)
 */
const bytesOf = (...parts: readonly (string | null)[]): number | null => {
  const present = parts.filter((part): part is string => part !== null)
  if (present.length === 0) return null
  return present.reduce((total, part) => total + Buffer.byteLength(part, 'utf8'), 0)
}

/** The one place SQLite row artifacts (JSON-in-TEXT, motion 0|1) are parsed. */
const toDetail = (row: ItemDetailRow): EngineDetail => ({
  name: row.name,
  title: row.title,
  description: row.description,
  type: row.type,
  group: row.grp === null ? null : { slug: row.grp, label: row.groupLabel ?? row.grp },
  categories: jsonStringList(row.categories),
  dependencies: jsonStringList(row.dependencies),
  registryDependencies: jsonStringList(row.registryDeps),
  provenance: row.provenance,
  license: row.license,
  sourceUrl: row.sourceUrl,
  motion: row.motion === 1,
  filePath: row.filePath,
  partsFilePath: row.partsFilePath,
  installCmd: row.installCmd,
  docUrl: row.docUrl,
  sourceBytes: bytesOf(row.source, row.partsSource),
  demoBytes: bytesOf(row.demoSource),
  setup: row.docs,
})

/** Wrap an ALREADY-OPEN index (the in-memory test fixtures' entry point). */
export function createDbEngineFromDb(db: DB): RegistryEngine {
  const meta = readIndexMeta(db)
  const identity = readIdentity(db)
  // Freshness digests are OPTIONAL meta keys (build:index started persisting
  // them after the drift check landed): absent on an older index, which the
  // startup comparison reports as 'unverifiable' rather than guessing.
  const raw = readMeta(db)
  const sourceDigests =
    raw.registry_json_sha256 !== undefined &&
    raw.groups_sha256 !== undefined &&
    raw.demos_digest !== undefined
      ? {
          registryJsonSha256: raw.registry_json_sha256,
          groupsSha256: raw.groups_sha256,
          demosDigest: raw.demos_digest,
        }
      : undefined
  return {
    kind: 'db',
    identity,
    meta: {
      itemCount: Number(meta.item_count),
      registryHash: meta.registry_hash,
      detail: `${meta.chunk_count} chunks · ${meta.model_id} (${meta.model_dtype})`,
      ...(sourceDigests !== undefined ? { sourceDigests } : {}),
    },

    search: (query, opts = {}) => search(db, query, opts),
    findSimilar: (name, k) => findSimilar(db, name, k),
    canFindSimilar: (name) => hasDocVector(db, name),

    detail(name): EngineDetail | undefined {
      const row = fetchDetail(db, name)
      return row === undefined ? undefined : toDetail(row)
    },

    resolveName(input): string | null {
      // Case/spacing normalization only — the index stores no alias data.
      const canonical = input
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
      return knownNames(db).has(canonical) ? canonical : null
    },

    knownNames: () => knownNames(db),
    groupSlugs: () => groupSlugs(db),
    suggestNames: (near, limit) => suggestNames(db, near, limit),
    dependencyInfo: (name) =>
      dependencyClosure(db).get(name) ?? { pure: false, transitiveDependencies: [] },

    listGroups: () => listGroupRows(db),
    listComponents(group) {
      const deps = dependencyClosure(db)
      return listComponentRows(db, group).map((r) => ({
        ...r,
        pure: deps.get(r.name)?.pure ?? false,
      }))
    },

    sourceOf(name, part): SourceResult {
      const row = fetchDetail(db, name)
      if (!row) return null
      const code = part === 'source' ? row.source : row.demoSource
      if (code === null) return null
      // A split item's files[0] imports `./<name>.parts` — hand back both, or
      // the caller pastes a module whose surfaces are undefined.
      if (part === 'source' && row.partsSource !== null) {
        return [
          { path: row.filePath, code },
          { path: row.partsFilePath, code: row.partsSource },
        ]
      }
      return [{ path: row.filePath, code }]
    },

    close: () => db.close(),
  }
}

/** Open the index at `indexPath` (fail-loud: missing file, contract mismatch). */
export function createDbEngine(indexPath?: string): RegistryEngine {
  const db = openIndex(indexPath)
  // readIndexMeta/readIdentity throw on an index predating their keys — close
  // the handle we own before rethrowing (mirrors openIndex's own guard). The
  // FromDb entry point deliberately does NOT do this: its handle belongs to
  // the caller (the in-memory test fixtures close their own).
  try {
    return createDbEngineFromDb(db)
  } catch (err) {
    db.close()
    throw err
  }
}
