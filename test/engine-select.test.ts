// The pure config surface of the MCP server: parseServerFlags' whole matrix
// (strict flags; --registry-index is explicit db intent; everything else is
// the zero-setup web default — a built index.db alone selects nothing; a flag
// the selected engine would ignore is a usage error), plus the pure halves of
// path/URL-value resolution and the catalog/db drift comparison (mcp.ts
// applies the exit/stderr boundary for all of them).
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { lexicalOnly, modelCacheDir, setServerOverrides } from '../src/config.ts'
import {
  SERVER_FLAG_NAMES,
  SERVER_USAGE,
  catalogSyncStatus,
  envText,
  parseServerFlags,
  resolvePathValue,
  resolveUrlValue,
} from '../src/engine.ts'

// ── resolvePathValue — the pure path-value rules ───────────────────────────────

const HOME = '/Users/someone'
const CWD = '/work/here'

test('unset and empty env paths are null, never errors', () => {
  assert.equal(resolvePathValue(undefined, HOME, CWD), null)
  assert.equal(resolvePathValue('', HOME, CWD), null)
})

test('legal path characters pass through: spaces, parens, non-ASCII', () => {
  assert.deepEqual(resolvePathValue('/data/repos (mirrors)/encode-ui', HOME, CWD), {
    path: '/data/repos (mirrors)/encode-ui',
  })
  assert.deepEqual(resolvePathValue('/données/répertoire', HOME, CWD), {
    path: '/données/répertoire',
  })
})

test('control characters are the one rejected shape', () => {
  const rejected = resolvePathValue('/tmp/x\n/y', HOME, CWD)
  assert.ok(rejected !== null && 'error' in rejected)
  assert.match(rejected.error, /control characters/)
  const nul = resolvePathValue('/tmp/\u0000', HOME, CWD)
  assert.ok(nul !== null && 'error' in nul)
})

// ── catalogSyncStatus — the drift comparison ─────────────────────────────────

test('catalogSyncStatus: in-sync, drift, and unverifiable', () => {
  const artifact = { registryJsonSha256: 'aaa', groupsSha256: 'bbb', demosDigest: 'ccc' }
  assert.equal(catalogSyncStatus(artifact, { ...artifact }), 'in-sync')
  // An older index without the persisted digests cannot be verified — that is
  // its own answer, never assumed in-sync.
  assert.equal(catalogSyncStatus(artifact, undefined), 'unverifiable')
  for (const key of ['registryJsonSha256', 'groupsSha256', 'demosDigest'] as const) {
    assert.equal(
      catalogSyncStatus(artifact, { ...artifact, [key]: 'zzz' }),
      'drift',
      `a changed ${key} must read as drift`,
    )
  }
})

test('~ expands against home; relative values resolve against cwd', () => {
  assert.deepEqual(resolvePathValue('~', HOME, CWD), { path: HOME })
  assert.deepEqual(resolvePathValue('~/Projects/registry', HOME, CWD), {
    path: path.join(HOME, 'Projects', 'registry'),
  })
  assert.deepEqual(resolvePathValue('sub/dir', HOME, CWD), {
    path: path.join(CWD, 'sub', 'dir'),
  })
  // ~user (not ours to expand) stays literal and resolves like any relative path.
  assert.deepEqual(resolvePathValue('~other/x', HOME, CWD), {
    path: path.join(CWD, '~other', 'x'),
  })
})

// ── envText / resolveUrlValue — the pure text/URL-value rules ──────────────────

test('an empty or whitespace-only text env value is unset', () => {
  // A host config writes "" as a placeholder and a shell exports "" for a
  // variable it could not fill. Read as SET, ENCODE_UI_TOKEN sends a literal
  // `Bearer ` and skips the no-round-trip gated answer.
  assert.equal(envText(undefined), undefined)
  assert.equal(envText(''), undefined)
  assert.equal(envText('   '), undefined)
})

test('a text env value is trimmed', () => {
  // ENCODE_UI_TOKEN=$(cat token.txt) carries a newline, and a header value
  // with a newline makes fetch throw.
  assert.equal(envText('tok\n'), 'tok')
  assert.equal(envText(' tok '), 'tok')
  assert.equal(envText('tok'), 'tok')
})

test('a registry URL normalizes to origin + path', () => {
  // The value is template-joined downstream, so anything that survives here
  // lands in the MIDDLE of the joined URL.
  assert.deepEqual(resolveUrlValue('https://x.com/?ref=1#frag'), { url: 'https://x.com' })
  assert.deepEqual(resolveUrlValue(' https://x.com/sub/ '), { url: 'https://x.com/sub' })
  assert.deepEqual(resolveUrlValue('https://x.com'), { url: 'https://x.com' })
  assert.deepEqual(resolveUrlValue('http://localhost:5173/'), { url: 'http://localhost:5173' })
  assert.equal(resolveUrlValue(undefined), null)
  assert.equal(resolveUrlValue(''), null)
})

test('a registry URL that is unusable is an error, never ignored', () => {
  const notUrl = resolveUrlValue('nonsense')
  assert.ok(notUrl !== null && 'error' in notUrl && notUrl.error.includes('not a valid URL'))
  const wrongScheme = resolveUrlValue('ftp://x.com')
  assert.ok(wrongScheme !== null && 'error' in wrongScheme && wrongScheme.error.includes('http(s)'))
})

// ── parseServerFlags — the CLI-flag surface ──────────────────────────────────

const parse = (...argv: string[]): ReturnType<typeof parseServerFlags> =>
  parseServerFlags(argv, HOME, CWD)

const parsed = (...argv: string[]) => {
  const result = parse(...argv)
  assert.equal(result.kind, 'flags', `expected flags, got ${result.kind}`)
  assert.ok(result.kind === 'flags')
  return result.flags
}

const usageError = (...argv: string[]): string => {
  const result = parse(...argv)
  assert.ok(result.kind === 'error', 'expected a usage error')
  return result.error
}

test('no flags means the zero-setup web engine', () => {
  assert.deepEqual(parsed(), {
    engine: 'web',
    indexPath: undefined,
    registryUrl: undefined,
    registryRoot: undefined,
    modelDir: undefined,
    lexicalOnly: false,
  })
})

test('flags parse in equals form, last repeat wins, trailing -- is harmless', () => {
  assert.equal(parsed('--registry-engine=db').engine, 'db')
  assert.equal(parsed('--registry-engine', 'web', '--registry-engine=db').engine, 'db')
  // `claude mcp add … -- node dist/mcp.js` habits can leave a stray trailing --.
  assert.deepEqual(parsed('--'), parsed())
})

test('a LEADING -- is a host separator, not a positional', () => {
  // `gemini mcp add … node dist/mcp.js -- --registry-engine db` forwards its
  // own separator. allowPositionals:false would read the rest as positionals
  // and throw, exiting 2 on a command the host considers well-formed.
  assert.equal(parsed('--', '--registry-engine', 'db').engine, 'db')
  assert.equal(parsed('--', '--registry-index', '/tmp/x.db').indexPath, '/tmp/x.db')
  assert.deepEqual(parsed('--'), parsed())
  // Only ONE leading separator is a wrapper convention; a second is argv the
  // operator did not mean, and must not be silently eaten.
  assert.match(usageError('--', '--', '--registry-engine', 'db'), /Unexpected argument/)
})

test('malformed argv is a usage error, never a silent skip', () => {
  assert.match(usageError('--bogus'), /Unknown option '--bogus'/)
  assert.match(usageError('--registry-url'), /argument missing/)
  // A flag-shaped next token is NOT swallowed as the value.
  assert.match(usageError('--registry-url', '--lexical-only'), /ambiguous/)
  assert.match(usageError('stray'), /Unexpected argument/)
  assert.match(usageError('--lexical-only=1'), /does not take an argument/)
})

test('an empty flag value is an error — a typed flag is never unset', () => {
  assert.match(usageError('--registry-url', ''), /--registry-url requires a non-empty value/)
  assert.match(usageError('--registry-index', ''), /--registry-index requires a non-empty value/)
})

test('--registry-engine is a strict enum with case/whitespace forgiveness', () => {
  assert.equal(parsed('--registry-engine', ' DB ').engine, 'db')
  assert.equal(parsed('--registry-engine', 'Catalog').engine, 'catalog')
  assert.equal(parsed('--registry-engine', ' Web ').engine, 'web')
  const message = usageError('--registry-engine', 'vector')
  assert.match(message, /'web', 'catalog' or 'db'/)
  assert.match(message, /"vector"/)
})

test('--registry-index is db intent; contradicting it is an error', () => {
  const flags = parsed('--registry-index', '/tmp/x.db')
  assert.equal(flags.engine, 'db')
  assert.equal(flags.indexPath, '/tmp/x.db')
  assert.equal(parsed('--registry-engine', 'db', '--registry-index', '/tmp/x.db').engine, 'db')
  assert.match(usageError('--registry-engine', 'web', '--registry-index', '/tmp/x.db'), /db engine/)
  assert.match(
    usageError('--registry-engine', 'catalog', '--registry-index', '/tmp/x.db'),
    /db engine/,
  )
})

test('path flags resolve like every path value: ~, relative, control chars', () => {
  assert.equal(parsed('--registry-index', '~/x.db').indexPath, path.join(HOME, 'x.db'))
  assert.equal(parsed('--registry-index', 'sub/i.db').indexPath, path.join(CWD, 'sub', 'i.db'))
  assert.match(
    usageError('--registry-index', '/tmp/x\n/y'),
    /--registry-index contains control characters/,
  )
})

test('--registry-url normalizes like every URL value', () => {
  assert.equal(parsed('--registry-url', 'https://x.com/?ref=1#frag').registryUrl, 'https://x.com')
  assert.equal(
    parsed('--registry-url', 'http://localhost:5173/').registryUrl,
    'http://localhost:5173',
  )
  assert.match(usageError('--registry-url', 'nonsense'), /not a valid URL/)
  assert.match(usageError('--registry-url', 'ftp://x.com'), /http\(s\)/)
})

test('every scope-error remedy actually resolves the argv it came from', () => {
  // The regression: `--registry-index x --registry-root y` advised "pass
  // --registry-engine catalog", which then errored "--registry-index selects
  // the db engine — drop it, or drop --registry-engine catalog". Following the
  // advice walked a closed loop, and "drop --registry-root" — the one fix that
  // works — was never named by either message.
  const inferred = usageError('--registry-index', '/tmp/x.db', '--registry-root', '/co')
  assert.match(inferred, /--registry-index selected the db engine/)
  assert.match(inferred, /drop --registry-root/)
  // Following it verbatim reaches a starting server, rather than the next error.
  assert.equal(parsed('--registry-index', '/tmp/x.db').engine, 'db')
  assert.equal(parsed('--registry-engine', 'catalog', '--registry-root', '/co').engine, 'catalog')

  // With an EXPLICIT engine both sides are droppable, so the message says so.
  const chosen = usageError('--registry-engine', 'web', '--model-dir', '/m')
  assert.match(chosen, /drop --model-dir/)
  assert.match(chosen, /change --registry-engine web to db/)

  // Defaulted engine: nothing to change, so the remedy is the plain pass-or-drop.
  assert.match(usageError('--lexical-only'), /pass --registry-engine db/)
})

test('--registry-url applies to every engine that fetches bodies', () => {
  // web always fetches; catalog fetches when it has no checkout, or when an
  // origin is named explicitly — so the flag is meaningful on both.
  assert.equal(
    parsed('--registry-engine', 'catalog', '--registry-url', 'http://localhost:5173').registryUrl,
    'http://localhost:5173',
  )
  assert.equal(
    parsed('--registry-url', 'http://localhost:5173').registryUrl,
    'http://localhost:5173',
  )
  // db is the one engine that never reaches an origin: its index holds the
  // bodies. Accepting the flag there would be the silent no-op this release
  // exists to remove.
  const rejected = usageError('--registry-engine', 'db', '--registry-url', 'https://x.com')
  assert.match(rejected, /serves them from its own index/)
  assert.match(rejected, /drop --registry-url/)
})

test('a flag the selected engine would silently ignore is a usage error', () => {
  assert.match(usageError('--registry-root', '/tmp'), /catalog engine/)
  assert.match(usageError('--model-dir', '/m'), /db engine/)
  assert.match(usageError('--lexical-only'), /db engine/)
  // …and in scope they land, resolved.
  assert.equal(
    parsed('--registry-engine', 'catalog', '--registry-root', 'checkout').registryRoot,
    path.join(CWD, 'checkout'),
  )
  assert.equal(parsed('--registry-engine', 'db', '--model-dir', '~/m').modelDir, path.join(HOME, 'm'))
  assert.equal(parsed('--registry-index', '/i.db', '--lexical-only').lexicalOnly, true)
})

test('--help and --version answer before validation, never past a parse throw', () => {
  assert.equal(parse('--help').kind, 'help')
  assert.equal(parse('--version').kind, 'version')
  // A half-typed command still reaches its usage text…
  assert.equal(parse('--help', '--registry-engine', 'vector').kind, 'help')
  // …but an unknown flag is still a parse error (strict wins over help).
  assert.match(usageError('--help', '--bogus'), /Unknown option/)
})

test('help/version are their own variants — they carry no unvalidated config', () => {
  // They short-circuit BEFORE scope validation, so a combined object would
  // have to claim a resolved config it never checked: --lexical-only on the
  // web engine is a usage error, yet `--help --lexical-only` used to report
  // lexicalOnly:true alongside engine:'web'. The split makes it unrepresentable.
  const help = parse('--help', '--lexical-only', '--registry-root', 'x')
  assert.equal(help.kind, 'help')
  assert.ok(!('flags' in help))
})

test('a parse error keeps the remedy parseArgs supplied', () => {
  // Node puts the offense on line 1 and the FIX on a later line; truncating to
  // the first line dropped the `=` form, which SERVER_USAGE does not document.
  const ambiguous = usageError('--registry-url', '--lexical-only')
  assert.match(ambiguous, /ambiguous/)
  assert.match(ambiguous, /--registry-url=/)
  // A positional's tail names the REASON rather than repeating the offense.
  assert.match(usageError('/path/to/index.db'), /does not take positional arguments/)
  // Collapsed to a single stderr row above the usage text.
  assert.ok(!ambiguous.includes('\n'), 'the message must print as one line')
})

test('--model-dir and --lexical-only reach config as VALUES, untrimmed', () => {
  // A trailing space is a legal path character, so resolvePathValue leaves it.
  // Handing the value to config through process.env re-applied envText's trim,
  // and the ~1.2 GB download silently landed in a different directory.
  const flags = parsed('--registry-engine', 'db', '--model-dir', '/vol/models ', '--lexical-only')
  assert.equal(flags.modelDir, '/vol/models ')
  try {
    setServerOverrides({ modelDir: flags.modelDir, lexicalOnly: flags.lexicalOnly })
    assert.equal(modelCacheDir(), '/vol/models ')
    assert.equal(lexicalOnly(), true)

    // Flags alone: an override beats a leftover env var rather than merging
    // with it, and does so without the sweep in mcp.ts having to run first.
    process.env.ENCODE_UI_RAG_MODEL_DIR = '/stale/from/0.3.x'
    process.env.ENCODE_UI_RAG_LEXICAL_ONLY = '1'
    setServerOverrides({ modelDir: undefined, lexicalOnly: false })
    assert.equal(lexicalOnly(), false, 'a false flag must beat a stale env var')
    assert.equal(modelCacheDir(), '/stale/from/0.3.x')
  } finally {
    delete process.env.ENCODE_UI_RAG_MODEL_DIR
    delete process.env.ENCODE_UI_RAG_LEXICAL_ONLY
    setServerOverrides({})
  }
})

test('SERVER_USAGE documents every flag the parser accepts', () => {
  // Derived from PARSE_OPTIONS, not a second hand-written list: the old check
  // compared the usage text against an array that could only drift in lockstep
  // with itself, so a new flag documented nowhere still passed.
  assert.ok(SERVER_FLAG_NAMES.length > 0)
  for (const flag of SERVER_FLAG_NAMES) {
    assert.ok(SERVER_USAGE.includes(flag), `${flag} missing from SERVER_USAGE`)
  }
})

test('SERVER_USAGE names every variable the server actually reads', () => {
  // It used to claim ENCODE_UI_TOKEN was "the only variable the server reads",
  // which is the sentence the whole flags-only migration rests on — while
  // userCacheDir reads XDG_CACHE_HOME/HOME for the fetched index and the
  // ~1.2 GB model cache, with no flag to override either.
  assert.match(SERVER_USAGE, /ENCODE_UI_TOKEN/)
  assert.match(SERVER_USAGE, /XDG_CACHE_HOME/)
  assert.match(SERVER_USAGE, /\bHOME\b/)
  assert.doesNotMatch(SERVER_USAGE, /only variable the server reads/)
})
