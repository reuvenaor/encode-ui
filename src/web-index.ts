// The web engine's index loader — the deployed registry's /agent-index.json,
// with a disk cache and the bundled artifact as the last resort, so startup
// never fails on network absence.
//
// Resolution chain (first success wins; each fall-through is disclosed via
// `log`, stderr by default — stdout is the JSON-RPC wire):
//   1. remote — GET ${baseUrl}/agent-index.json with If-None-Match from the
//               cache sidecar; a 304 serves the cached body, still 'remote'.
//   2. cache  — the last successfully fetched body. URL-keyed: a different
//               baseUrl ignores it rather than serving another origin's index.
//   3. seed   — the artifact bundled with the package. Its failure IS a
//               packaging bug and throws exactly like loadCatalog at startup.
//
// A fetched body is Zod-validated BEFORE it is cached, so the cache can only
// ever hold an index that parsed; the cache is ONE file (body + etag together,
// so the two can never describe different origins) written temp+rename (two
// concurrent MCP servers are normal) and best-effort — a full disk must not
// fail startup.
//
// A failure is reported by CLASS — unreachable / not JSON / not a valid index —
// because the operator's next move differs for each, and one shared "fetch
// failed" message sent them to debug a network that was answering fine.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadCatalog, parseCatalog } from './catalog.ts'
import { userCacheDir } from './config.ts'
import type { Catalog } from './catalog.ts'
import type { WebIndexSource } from './engine.ts'

/** Re-exported so importers of the loader keep naming the rung from here. */
export type { WebIndexSource }

export interface WebCatalogResult {
  catalog: Catalog
  source: WebIndexSource
}

export interface LoadWebCatalogOptions {
  /** Registry origin, no path — e.g. https://encode-ui.com */
  baseUrl: string
  /** Injectable for tests; global fetch otherwise. */
  fetchImpl?: typeof fetch
  /** Where the body + etag sidecar live. Default: defaultWebCacheDir(). */
  cacheDir?: string
  /** The bundled artifact. Default: the package's own agent-index.json. */
  seedPath?: string
  timeoutMs?: number
  /** Diagnostics sink — stderr by default, injectable so tests stay silent. */
  log?: (line: string) => void
}

/** The shared user-level cache root — same helper the model weights use. */
export const defaultWebCacheDir = (): string => userCacheDir()

export const indexUrl = (baseUrl: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/agent-index.json`

const CACHE_FILE = 'index-cache.json'

/** The two-file layout this replaced — swept on the first successful write. */
const LEGACY_FILES = ['agent-index.json', 'agent-index.meta.json']

/** What the operator can actually do about a bad FETCHED index. */
const FETCH_REMEDY =
  'The deployed registry may be running a different index schema than this server expects; ' +
  'upgrade encode-ui, or launch with --registry-url pointing at a matching origin.'

/**
 * One envelope, one write. The body and its etag used to be two independent
 * atomic renames: each rename was atomic, the PAIR was not, so a failure or an
 * interleave between them could leave one origin's body beside another origin's
 * etag — and a later 304 would then serve bytes the ETag never described. A
 * single file makes that pairing unrepresentable.
 */
interface CacheEntry {
  url: string
  etag: string | null
  fetchedAt: string
  /** The origin's bytes VERBATIM, so the etag genuinely describes them. */
  body: string
}

const readCache = (file: string, url: string): CacheEntry | null => {
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<CacheEntry>
    // A legacy body has no `url` field and fails here — treated as no cache,
    // which costs exactly one cold fetch before the new file is written.
    if (raw.url !== url || typeof raw.body !== 'string') return null
    return {
      url,
      body: raw.body,
      etag: typeof raw.etag === 'string' ? raw.etag : null,
      fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : '',
    }
  } catch {
    // An unreadable cache just means "no usable cache" — never fatal.
    return null
  }
}

/** Temp+rename so a concurrent server never reads a half-written body. */
const writeAtomic = (file: string, text: string): void => {
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export async function loadWebCatalog(opts: LoadWebCatalogOptions): Promise<WebCatalogResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const log = opts.log ?? ((line: string): void => void process.stderr.write(line))
  const cacheDir = opts.cacheDir ?? defaultWebCacheDir()
  const cachePath = path.join(cacheDir, CACHE_FILE)
  const url = indexUrl(opts.baseUrl)

  const cached = readCache(cachePath, url)

  /**
   * ...and disclose the AGE. Nothing here EXPIRES — an expiry would break the
   * offline promise — but silence about age is how a months-old cache gets
   * served indefinitely (whenever the remote is unreachable OR its body no
   * longer validates) with nobody the wiser.
   */
  const fallbackPhrase = (): string =>
    cached === null
      ? 'serving the bundled seed.'
      : `serving the cached copy${cached.fetchedAt ? ` (fetched ${cached.fetchedAt})` : ''}.`

  const seed = (): WebCatalogResult => ({ catalog: loadCatalog(opts.seedPath), source: 'seed' })

  const serveCache = (source: WebIndexSource): WebCatalogResult | null => {
    if (cached === null) return null
    try {
      return { catalog: parseCatalog(JSON.parse(cached.body), `${cachePath} (cache)`), source }
    } catch (err) {
      log(
        `[encode-ui-rag] the cached index is unusable (${(err as Error).message}); ` +
          'serving the bundled seed.\n',
      )
      // A cache that no longer parses is dead weight — clear it so the next
      // start goes straight to remote/seed instead of re-reporting this.
      try {
        rmSync(cachePath, { force: true })
      } catch {
        // Best-effort cleanup only.
      }
      return null
    }
  }

  // Three failure classes, three sentences. They used to share one try and one
  // message — "index fetch ... failed" — so a body that ARRIVED fine and then
  // failed the Zod gate sent the operator to debug connectivity while the
  // server quietly served a stale cache forever.
  let text: string
  let etag: string | null = null
  try {
    const res = await fetchImpl(url, {
      headers: cached?.etag != null ? { 'If-None-Match': cached.etag } : {},
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    })
    if (res.status === 304 && cached !== null) {
      const revalidated = serveCache('remote')
      if (revalidated !== null) return revalidated
      return seed()
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    etag = res.headers.get('etag')
    text = await res.text()
  } catch (err) {
    // TRANSPORT — nothing arrived. The only class where "check the network" is
    // the right advice, which is why the other two must not wear it.
    log(
      `[encode-ui-rag] could not reach the registry index at ${url} ` +
        `(${(err as Error).message}); ${fallbackPhrase()}\n`,
    )
    return serveCache('cache') ?? seed()
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    // MALFORMED — the origin answered 200 with something that is not JSON: an
    // SPA fallback page, a CDN interstitial, a captive portal.
    log(
      `[encode-ui-rag] ${url} answered with a body that is not JSON ` +
        `(${(err as Error).message}) — the origin may be serving an HTML page instead of ` +
        `the index; ${fallbackPhrase()}\n`,
    )
    return serveCache('cache') ?? seed()
  }

  let catalog: Catalog
  try {
    // Validate BEFORE caching — the cache may only ever hold a parsed index.
    catalog = parseCatalog(raw, url, FETCH_REMEDY)
  } catch (err) {
    // SCHEMA-INVALID — real JSON, wrong shape. A network check finds nothing.
    log(`[encode-ui-rag] ${(err as Error).message} ${fallbackPhrase()}\n`)
    return serveCache('cache') ?? seed()
  }

  try {
    mkdirSync(cacheDir, { recursive: true })
    writeAtomic(
      cachePath,
      JSON.stringify({
        url,
        etag,
        fetchedAt: new Date().toISOString(),
        body: text,
      } satisfies CacheEntry),
    )
    for (const legacy of LEGACY_FILES) rmSync(path.join(cacheDir, legacy), { force: true })
  } catch (err) {
    log(`[encode-ui-rag] could not cache the fetched index (${(err as Error).message})\n`)
  }
  return { catalog, source: 'remote' }
}
