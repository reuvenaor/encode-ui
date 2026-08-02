// The retrieval waist: one contract, three engines.
//
// Every MCP tool consumes retrieval through RegistryEngine, so the tool layer
// cannot tell — and must not care — whether answers come from the deployed
// registry's fetched index (engine-web.ts, the default), the committed
// agent-index.json ranked by MiniSearch (engine-catalog.ts), or the semantic
// SQLite index (engine-db.ts). The catalog and db engines are explicit opt-ins
// via --registry-engine; the web engine is the zero-setup default that
// works straight after install — online or not (web-index.ts falls back to
// the cached copy, then the bundled seed).
//
// This module must import NO native code, directly or transitively — it is on
// the zero-setup path, which must survive a machine where better-sqlite3
// failed to build. items.ts and registry-id.ts are imported type-only (both
// erased under verbatimModuleSyntax), text.ts is pure string helpers, and
// everything below is data shapes plus pure functions.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { compareStrings, editDistance } from './text.ts'
import type { DependencyInfo, SearchHit } from './items.ts'
import type { RegistryIdentity } from './registry-id.ts'
import type { SourceDigests } from './source-digests.ts'

export type EngineKind = 'db' | 'catalog' | 'web'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** rag/index.db — package root, identical from src/ (strip-types) and dist/.
 *  Value resolution stays at the boundary (mcp.ts / db.ts), not here. */
export const packageIndexPath = (): string => path.resolve(HERE, '..', 'index.db')

/**
 * Pure half of path-value resolution (the boundary in mcp.ts applies exit/stderr).
 * `undefined`/`''` → null (unset); control characters → error (the ONLY rejected
 * shape — parens, spaces, and non-ASCII are legal path characters, which the old
 * allowlist regex wrongly refused); `~`/`~/…` expands against `home`; a relative
 * value resolves against `cwd` so the caller sees an absolute path either way.
 */
export function resolvePathValue(
  raw: string | undefined,
  home: string,
  cwd: string,
): { path: string } | { error: string } | null {
  if (raw === undefined || raw === '') return null
  // eslint-disable-next-line no-control-regex -- rejecting control chars is the point
  if (/[\u0000-\u001f\u007f]/u.test(raw)) return { error: 'contains control characters' }
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? path.join(home, raw.slice(2)) : raw
  return { path: path.resolve(cwd, expanded) }
}

/**
 * Text-shaped env values (token, URL): trimmed, and '' → undefined.
 *
 * `''` is how a shell exports a variable it could not fill, and a host config
 * writes a placeholder — treating it as SET defeated the no-round-trip gated
 * answer in engine-web.ts and sent a literal `Bearer `. Trimming matters too:
 * `ENCODE_UI_TOKEN=$(cat token.txt)` carries a newline, and a header value with
 * a newline makes fetch throw.
 *
 * PATHS deliberately do NOT come through here — a trailing space is a legal
 * path character, which is why resolvePathValue does not trim.
 */
/**
 * Which rung of the web engine's remote → cache → seed chain served its corpus
 * (web-index.ts owns the chain; the type lives here so EngineMeta and the MCP
 * layer can name it without importing the loader).
 */
export type WebIndexSource = 'remote' | 'cache' | 'seed'

export const envText = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Pure half of URL-value resolution (mcp.ts applies exit/stderr). The returned
 * value is a NORMALIZED origin + path, not the raw string, because it is
 * template-joined downstream (`${base}/agent-index.json` in web-index.ts,
 * `${base}/r/<name>.json` in engine-web.ts): a query string, fragment or stray
 * whitespace would otherwise survive into the MIDDLE of the joined URL and
 * fetch a path that cannot exist — `https://x.com/?ref=1` + `/agent-index.json`
 * asks the origin for `?ref=1/agent-index.json` and gets the home page back.
 */
export function resolveUrlValue(raw: string | undefined): { url: string } | { error: string } | null {
  const value = envText(raw)
  if (value === undefined) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { error: `${JSON.stringify(value)} is not a valid URL` }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: `must be http(s), got ${parsed.protocol}` }
  }
  return { url: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') }
}

/**
 * How many items a caller gets by default, and the most it may ask for.
 * Declared ONCE — these used to live in five places (two `?? 8` defaults and
 * three prose `describe` strings on the MCP schemas), which is three chances
 * to disagree. Moved here from search.ts so mcp/schemas.ts can read them
 * without pulling search.ts's native import chain (db.ts + embed.ts) into
 * every module that only wants the numbers; search.ts re-exports both for
 * existing importers.
 */
export const DEFAULT_K = 8
export const MAX_K = 25

/** The tool-facing subset of search filters (eval-only knobs stay on search.ts). */
export interface EngineSearchOptions {
  k?: number
  group?: string
  type?: string
  motion?: boolean
  /** true = only transitively dependency-free items; false = only dep-carrying. */
  dependencyFree?: boolean
}

export interface EngineSearchResult {
  hits: SearchHit[]
  /**
   * db engine only: the embedding model was unavailable and lexical FTS ran
   * alone — a FAULT in the semantic path. Always false on the catalog and web
   * engines, where lexical ranking / plain filtering is the designed mode,
   * not a degradation.
   */
  degraded: boolean
}

/**
 * The parsed detail behind get_component — replaces ItemDetailRow at the tool
 * boundary. The row shape leaked SQLite artifacts (JSON-in-TEXT columns,
 * `motion: 0|1`) that the catalog engine would have to fake; each engine now
 * parses its own storage into this neutral shape instead.
 *
 * Source BODIES are deliberately absent: the catalog engine resolves them
 * lazily (sourceOf), and the byte counts here let a caller — and the
 * missing-part error message — decide without fetching.
 */
export interface EngineDetail {
  name: string
  title: string
  description: string
  type: string
  group: { slug: string; label: string } | null
  categories: string[]
  dependencies: string[]
  registryDependencies: string[]
  provenance: string | null
  license: string | null
  sourceUrl: string | null
  motion: boolean
  filePath: string | null
  partsFilePath: string | null
  installCmd: string
  docUrl: string
  /**
   * Post-install setup the payload cannot perform itself — shadcn's `docs` field,
   * which its CLI prints after an install. Named `setup` here because `docUrl` already
   * holds "the docs" in this shape; the two are different things, and an agent that
   * installs without this one ships a component that silently does not work (the flows
   * items need React Flow's stylesheet, and a shipped source file may not import CSS).
   */
  setup: string | null
  /** Total for part:"source" — files[0] plus every sibling file it ships. */
  sourceBytes: number | null
  demoBytes: number | null
}

export interface GroupRow {
  slug: string
  label: string
  count: number
}

/** One list_components row; `pure` is computed by the engine, not the tool. */
export interface ComponentRow {
  name: string
  title: string
  description: string
  label: string | null
  pure: boolean
}

export type ComponentSourcePart = 'source' | 'demo'

export interface SourceFile {
  path: string | null
  code: string
}

/**
 * null           — the item exists but has no such part (themes, chart-series's demo)
 * 'drifted'      — the engine's corpus promises the part but its store cannot
 *                  serve it (catalog engine: the checkout drifted from the
 *                  artifact since generation — regenerate, don't reinstall;
 *                  web engine: the origin answered 404 — index and deployment
 *                  out of step)
 * 'unavailable'  — this engine cannot serve bodies at all (catalog engine
 *                  running without a payloads directory, e.g. from a tarball)
 * 'gated'        — web engine: the item requires a registry account and no
 *                  usable ENCODE_UI_TOKEN was available (or the origin said 401)
 */
export type SourceResult = SourceFile[] | null | 'drifted' | 'unavailable' | 'gated'

/** What the startup banner prints, resolved per engine. */
export interface EngineMeta {
  itemCount: number
  registryHash: string
  /** Free-form tail — db: model id/dtype + chunk count; catalog: generated-at. */
  detail: string
  /**
   * The registry-source freshness digests this engine's corpus was built from.
   * catalog: always present (the artifact's own `sources`). db: present when
   * the index was built by a build:index that persisted them; undefined on an
   * older index — which startup reports as 'unverifiable' rather than assuming
   * either answer.
   */
  sourceDigests?: SourceDigests
  /**
   * web engine only: which rung of remote → cache → seed served this corpus.
   * The catalog resource is this engine's designated discovery path, so a
   * snapshot that came off disk instead of the origin has to SAY so — the
   * bodies are still fetched live, which is the one divergence a reader of a
   * stale index would otherwise never see coming.
   */
  indexSource?: WebIndexSource
}

/**
 * Whether the committed agent-index.json and a live engine describe the same
 * registry sources. Drives the startup drift warning + the catalog-resource
 * disclosure: the resource is ALWAYS rendered from the committed artifact, so
 * under the db engine the two can diverge (index built, registry:build rerun,
 * index never rebuilt) — silently, unless this says so.
 */
export type CatalogSyncStatus = 'in-sync' | 'unverifiable' | 'drift'

export function catalogSyncStatus(
  artifact: SourceDigests,
  engine: SourceDigests | undefined,
): CatalogSyncStatus {
  if (engine === undefined) return 'unverifiable'
  return engine.registryJsonSha256 === artifact.registryJsonSha256 &&
    engine.groupsSha256 === artifact.groupsSha256 &&
    engine.demosDigest === artifact.demosDigest
    ? 'in-sync'
    : 'drift'
}

export interface RegistryEngine {
  readonly kind: EngineKind
  readonly identity: RegistryIdentity
  readonly meta: EngineMeta
  search(query: string, opts?: EngineSearchOptions): Promise<EngineSearchResult>
  findSimilar(name: string, k?: number): SearchHit[]
  /**
   * db: whether the stored doc vector findSimilar seeds from exists (a partial
   * rebuild can drop one). catalog: true for every known name.
   */
  canFindSimilar(name: string): boolean
  detail(name: string): EngineDetail | undefined
  /**
   * Canonical name behind an accepted spelling. catalog: exact names, dashless
   * forms, and curated aliases ("modal" → dialog — search's exact-resolve
   * doctrine, extended to the detail tools so the two surfaces agree). db:
   * case/spacing normalization over exact names only (no alias data lives in
   * the index). Null when nothing answers to the input.
   */
  resolveName(input: string): string | null
  knownNames(): Set<string>
  groupSlugs(): Set<string>
  suggestNames(near: string, limit?: number): string[]
  /** Total: unknown names get { pure: false, transitiveDependencies: [] }. */
  dependencyInfo(name: string): DependencyInfo
  /** Themes last, then largest first — see orderGroups. */
  listGroups(): GroupRow[]
  /** FULL membership of one group, alphabetical by name. */
  listComponents(group: string): ComponentRow[]
  /** Sync on the local engines; the web engine fetches, so the one call site awaits. */
  sourceOf(name: string, part: ComponentSourcePart): SourceResult | Promise<SourceResult>
  close(): void
}

/**
 * The list_groups ordering, as data: themes sort last regardless of size (they
 * are palette data, not components, and a component search wants components
 * first), then count DESC, then slug for a stable tie-break. Mirrors the db
 * engine's `ORDER BY isTheme, count DESC, slug` so both engines present the
 * taxonomy identically — including on count ties.
 */
export function orderGroups<T extends GroupRow & { isTheme: boolean }>(
  rows: readonly T[],
): GroupRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        Number(a.isTheme) - Number(b.isTheme) || b.count - a.count || compareStrings(a.slug, b.slug),
    )
    .map(({ slug, label, count }) => ({ slug, label, count }))
}

/**
 * "Did you mean" over a name set — THE suggestion behavior, shared so both
 * engines answer a missed name identically (the deny message is part of the
 * tool contract). Substring matches rank first, then closest edit distance;
 * anything too far away is dropped rather than padded out to `limit`.
 */
export function suggestFromNames(names: Iterable<string>, near: string, limit = 3): string[] {
  const target = near.toLowerCase()
  const budget = Math.max(3, Math.ceil(target.length / 2))
  return [...names]
    .map((name) => {
      const lower = name.toLowerCase()
      const contains = lower.includes(target) || target.includes(lower)
      return { name, contains, distance: editDistance(target, lower) }
    })
    .filter((c) => c.contains || c.distance <= budget)
    .sort((a, b) => Number(b.contains) - Number(a.contains) || a.distance - b.distance)
    .slice(0, limit)
    .map((c) => c.name)
}

// ── server CLI flags ─────────────────────────────────────────────────────────

/**
 * Every install-time property, parsed and resolved. The server is configured
 * by these flags alone — the only environment variable it reads is
 * ENCODE_UI_TOKEN (a secret belongs in an env block, not on a command line
 * that `ps` can read).
 */
export interface ServerFlags {
  /** Explicit --registry-engine, else db when --registry-index is set, else web. */
  engine: EngineKind
  /** --registry-index, absolutized (~ expanded, cwd-resolved). */
  indexPath: string | undefined
  /** --registry-url, normalized to origin + path. */
  registryUrl: string | undefined
  /** --registry-root, absolutized. */
  registryRoot: string | undefined
  /** --model-dir, absolutized. */
  modelDir: string | undefined
  lexicalOnly: boolean
}

/**
 * What the argv surface can answer. `help`/`version` are their OWN variants
 * rather than booleans on ServerFlags: they short-circuit before scope
 * validation, so a combined object would have to claim a fully-resolved
 * config it never validated (`--help --lexical-only` would report
 * lexical-only on the web engine, a combination the scope rules reject).
 * Splitting them makes that state unrepresentable.
 */
export type ServerFlagsResult =
  | { kind: 'flags'; flags: ServerFlags }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; error: string }

/**
 * The full usage text — one source of truth, printed by mcp.ts on --help and
 * under every usage error. Always to stderr: stdout is the JSON-RPC wire.
 */
export const SERVER_USAGE = `usage: node dist/mcp.js [flags]

Engine selection (default: web — zero setup, index fetched from the registry):
  --registry-engine <web|catalog|db>  which engine serves the tools
  --registry-index <path>             db: the semantic index.db to open
                                      (implies --registry-engine db;
                                      default: the bundled rag/index.db)

Per-engine properties:
  --registry-url <url>                web, catalog: registry origin source
                                      bodies (and the web index) are fetched
                                      from; outranks a local checkout
                                      (default: the artifact's homepage)
  --registry-root <path>              catalog: registry checkout source
                                      bodies are read from (default: the
                                      checkout this package sits inside, if
                                      any — otherwise they are fetched)
  --model-dir <path>                  db: embedding-model cache directory
                                      (default: ~/.cache/encode-ui-rag/models)
  --lexical-only                      db: skip the embedding model — FTS5
                                      only, results are flagged degraded

  --help                              print this usage and exit
  --version                           print the server name/version and exit

Environment: ENCODE_UI_TOKEN is the only CONFIGURATION variable — the bearer
secret for gated items on the web engine (a secret belongs in an env block,
not a command line \`ps\` can read). Cache location still follows the
platform: XDG_CACHE_HOME, else HOME, for the fetched index and the model
weights. Every other property is a flag; legacy ENCODE_UI_* config vars are
ignored with a warning.`

const PARSE_OPTIONS = {
  'registry-engine': { type: 'string' },
  'registry-url': { type: 'string' },
  'registry-index': { type: 'string' },
  'registry-root': { type: 'string' },
  'model-dir': { type: 'string' },
  'lexical-only': { type: 'boolean' },
  help: { type: 'boolean' },
  version: { type: 'boolean' },
} as const

/**
 * Every flag the parser accepts, DERIVED from PARSE_OPTIONS — so a flag added
 * to the parser without a line in SERVER_USAGE fails a test instead of
 * shipping undocumented. (The previous check compared the usage text to a
 * hand-written array, which could only drift in lockstep with itself.)
 */
export const SERVER_FLAG_NAMES: readonly string[] = Object.keys(PARSE_OPTIONS).map((n) => `--${n}`)

const runParse = (args: string[]) =>
  parseArgs({ args, options: PARSE_OPTIONS, strict: true, allowPositionals: false })

/**
 * Pure parsing + validation of the server's argv (caller passes
 * process.argv.slice(2), os.homedir(), process.cwd(); mcp.ts applies the
 * stderr/exit boundary). Fail-loud, extended to flags: where an unusable env
 * value used to exit 1, a typed flag that is malformed, empty, or one the
 * selected engine would silently ignore is a usage error — the operator wrote
 * it deliberately, so dropping it would be the warn-and-ignore this server
 * refuses everywhere else. Selection has no cross-engine fallback (the web
 * engine's resilience lives inside its loader: remote → cache → bundled
 * seed, never a different engine); a built rag/index.db alone selects
 * nothing — the caller prints a hint when one exists unselected.
 */
export function parseServerFlags(
  argv: readonly string[],
  home: string,
  cwd: string,
): ServerFlagsResult {
  // A host that forwards its OWN separator hands us a leading `--`
  // (`gemini mcp add … node dist/mcp.js -- --registry-engine db`). With
  // allowPositionals:false parseArgs reads everything after it as a positional
  // and throws, so the server would exit 2 on a command the host considers
  // well-formed. The separator is a wrapper convention, not a config value —
  // drop ONE leading occurrence. A trailing `--` was always harmless.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  let values: ReturnType<typeof runParse>['values']
  try {
    ;({ values } = runParse(args))
  } catch (err) {
    // Keep parseArgs's WHOLE message. Its later lines carry the actionable
    // remedy — a dash-leading value reads as "ambiguous" and the fix
    // (`--registry-url=-XYZ`) is on the third line, which SERVER_USAGE does
    // not document — and the positional tail names the REASON rather than
    // repeating the offense. Newlines collapse so it stays one stderr row
    // above the usage text.
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'error', error: message.replace(/\s*\n\s*/gu, ' ').trim() }
  }

  // --help / --version answer before validation, so a half-typed command still
  // reaches its usage text. A parse THROW above still wins — an unknown flag
  // never silently succeeds into help.
  if (values.help === true) return { kind: 'help' }
  if (values.version === true) return { kind: 'version' }

  const fail = (error: string): ServerFlagsResult => ({ kind: 'error', error })
  const lexicalOnly = values['lexical-only'] ?? false

  const pathFlag = (
    name: string,
    raw: string | undefined,
  ): { ok: string | undefined } | { error: string } => {
    if (raw === undefined) return { ok: undefined }
    const resolved = resolvePathValue(raw, home, cwd)
    if (resolved === null) return { error: `${name} requires a non-empty value` }
    if ('error' in resolved) return { error: `${name} ${resolved.error}` }
    return { ok: resolved.path }
  }

  const index = pathFlag('--registry-index', values['registry-index'])
  if ('error' in index) return fail(index.error)
  const root = pathFlag('--registry-root', values['registry-root'])
  if ('error' in root) return fail(root.error)
  const model = pathFlag('--model-dir', values['model-dir'])
  if ('error' in model) return fail(model.error)

  let registryUrl: string | undefined
  const rawUrl = values['registry-url']
  if (rawUrl !== undefined) {
    const resolved = resolveUrlValue(rawUrl)
    if (resolved === null) return fail('--registry-url requires a non-empty value')
    if ('error' in resolved) return fail(`--registry-url ${resolved.error}`)
    registryUrl = resolved.url
  }

  let explicit: EngineKind | undefined
  const rawEngine = values['registry-engine']
  if (rawEngine !== undefined) {
    const normalized = rawEngine.trim().toLowerCase()
    if (normalized !== 'web' && normalized !== 'catalog' && normalized !== 'db') {
      return fail(
        `--registry-engine must be 'web', 'catalog' or 'db' (got ${JSON.stringify(rawEngine)})`,
      )
    }
    explicit = normalized
  }

  if (index.ok !== undefined && (explicit === 'web' || explicit === 'catalog')) {
    return fail(
      `--registry-index selects the db engine — drop it, or drop --registry-engine ${explicit}`,
    )
  }
  const engine: EngineKind = explicit ?? (index.ok !== undefined ? 'db' : 'web')

  // --registry-url names the origin BODIES are fetched from, which the web
  // engine always does and the catalog engine does when it has no checkout (or
  // when the operator names one explicitly). The db engine is the one that
  // never reaches an origin — its index carries the bodies.
  if (registryUrl !== undefined && engine === 'db') {
    return fail(
      '--registry-url names the origin source bodies are fetched from; the db engine serves ' +
        'them from its own index and never fetches — drop --registry-url, or pass ' +
        '--registry-engine web',
    )
  }
  /**
   * A scope error must name a remedy that resolves THIS argv. The remedies are
   * not interchangeable: when the engine was INFERRED from --registry-index,
   * "pass --registry-engine <needs>" only trades this error for the
   * --registry-index conflict, and following each message in turn walks a
   * closed loop in which the one fix that works — dropping the flag — is never
   * named.
   */
  const scopeError = (flag: string, needs: EngineKind): string => {
    const head = `${flag} only applies to the ${needs} engine`
    if (explicit !== undefined) {
      return `${head} — drop ${flag}, or change --registry-engine ${explicit} to ${needs}`
    }
    if (index.ok !== undefined) {
      return (
        `${head}, but --registry-index selected the db engine — drop ${flag}, ` +
        `or drop --registry-index and pass --registry-engine ${needs}`
      )
    }
    return `${head} — drop ${flag}, or pass --registry-engine ${needs}`
  }

  if (root.ok !== undefined && engine !== 'catalog') return fail(scopeError('--registry-root', 'catalog'))
  if (model.ok !== undefined && engine !== 'db') return fail(scopeError('--model-dir', 'db'))
  if (lexicalOnly && engine !== 'db') return fail(scopeError('--lexical-only', 'db'))

  // Built ONCE, here — there is no placeholder object upstream whose fields a
  // spread silently overwrites, so a new flag cannot be added in one place and
  // dropped in the other.
  return {
    kind: 'flags',
    flags: {
      engine,
      indexPath: index.ok,
      registryUrl,
      registryRoot: root.ok,
      modelDir: model.ok,
      lexicalOnly,
    },
  }
}
