// What every tool handler needs, resolved once at startup and passed down.
//
// A context object rather than module-level state: the handlers stay pure
// functions of (ctx, args), which is what lets a test connect a real Client to
// a server built over an in-memory index with no environment setup.
//
// `engine` is the retrieval waist (db, catalog, or web — the handlers cannot
// tell); `identity` duplicates engine.identity purely for call-site ergonomics.
import type { Catalog } from '../catalog.ts'
import type { CatalogSyncStatus, RegistryEngine } from '../engine.ts'
import type { IconCatalog } from '../icons.ts'
import type { RegistryIdentity } from '../registry-id.ts'

export interface RegistryContext {
  readonly engine: RegistryEngine
  /** Scope + docs origin — always the engine's own identity. */
  readonly identity: RegistryIdentity
  /** The vendored lucide catalog — loaded from dist, independent of the engine. */
  readonly icons: IconCatalog
  /**
   * The committed agent-index.json, loaded ONCE at startup on BOTH engines
   * (fail-loud — a corrupt shipped artifact is a packaging bug). The catalog
   * engine ranks over it; the db engine still serves the catalog resource
   * from it.
   */
  readonly catalog: Catalog
  /** Whether `catalog` and the live engine describe the same sources. */
  readonly catalogSync: CatalogSyncStatus
}
