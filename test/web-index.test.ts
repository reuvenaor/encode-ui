// loadWebCatalog — the remote → cache → seed resolution chain, driven entirely
// through an injected fetch (no network in tests, per the vendor-icons rule).
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os, { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { defaultWebCacheDir, loadWebCatalog, indexUrl } from '../src/web-index.ts'
import { buildCatalogFixture } from './fixtures/catalog-fixture.ts'

const fixture = buildCatalogFixture()
const REMOTE_BODY = readFileSync(path.join(fixture.root, 'agent-index.json'), 'utf8')
const BASE = 'https://fixture.test'

const tempCache = (): string => mkdtempSync(path.join(tmpdir(), 'web-index-cache-'))

/** A fetch stub that records its calls and replays a scripted response. */
const scripted = (
  respond: (url: string, init?: RequestInit) => Response,
): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    calls.push({ url: u, init })
    return Promise.resolve(respond(u, init))
  }) as typeof fetch
  return { fetchImpl, calls }
}

const silent = (): void => undefined

test('the default cache dir is absolute whatever the environment says', () => {
  // node:test isolates per FILE, not per test — restore in finally.
  const saved = { xdg: process.env.XDG_CACHE_HOME, home: process.env.HOME }
  try {
    // Exported-but-empty is routine in systemd units, minimal containers and
    // CI runners. Read as SET, this used to resolve to "/encode-ui-rag" — the
    // filesystem root — and the 320 KB index was re-downloaded every start.
    process.env.XDG_CACHE_HOME = ''
    process.env.HOME = ''
    const fallback = defaultWebCacheDir()
    assert.ok(path.isAbsolute(fallback))
    assert.notEqual(fallback, path.join('/', 'encode-ui-rag'))
    assert.ok(fallback.startsWith(os.homedir()) || fallback.startsWith(os.tmpdir()))

    delete process.env.XDG_CACHE_HOME
    process.env.HOME = '/Users/someone'
    assert.equal(defaultWebCacheDir(), path.join('/Users/someone', '.cache', 'encode-ui-rag'))

    process.env.XDG_CACHE_HOME = '/tmp/xdg'
    assert.equal(defaultWebCacheDir(), path.join('/tmp/xdg', 'encode-ui-rag'))
  } finally {
    if (saved.xdg === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = saved.xdg
    if (saved.home === undefined) delete process.env.HOME
    else process.env.HOME = saved.home
  }
})

test('a 200 serves the remote index and warms the cache with its etag', async () => {
  const cacheDir = tempCache()
  const { fetchImpl, calls } = scripted(
    () => new Response(REMOTE_BODY, { status: 200, headers: { etag: '"v1"' } }),
  )
  const { catalog, source } = await loadWebCatalog({ baseUrl: BASE, fetchImpl, cacheDir })
  assert.equal(source, 'remote')
  assert.equal(catalog.identity.homepage, BASE)
  assert.equal(calls[0]?.url, indexUrl(BASE))

  // ONE file: the body and the etag that describes it cannot be separated.
  assert.deepEqual(readdirSync(cacheDir), ['index-cache.json'])
  const entry = JSON.parse(readFileSync(path.join(cacheDir, 'index-cache.json'), 'utf8')) as {
    url: string
    etag: string
    fetchedAt: string
    body: string
  }
  assert.equal(entry.url, indexUrl(BASE))
  assert.equal(entry.etag, '"v1"')
  assert.equal(entry.body, REMOTE_BODY)
  assert.ok(Date.parse(entry.fetchedAt) > 0, 'the fetch time is kept, not discarded')
})

test('a legacy two-file cache is ignored, then swept', async () => {
  const cacheDir = tempCache()
  // The layout this replaced. It has no `url` field, so it reads as no cache.
  writeFileSync(path.join(cacheDir, 'agent-index.json'), REMOTE_BODY)
  writeFileSync(
    path.join(cacheDir, 'agent-index.meta.json'),
    JSON.stringify({ url: indexUrl(BASE), etag: '"v1"' }),
  )

  const dead = scripted(() => {
    throw new Error('offline')
  })
  const stale = await loadWebCatalog({
    baseUrl: BASE,
    fetchImpl: dead.fetchImpl,
    cacheDir,
    seedPath: path.join(fixture.root, 'agent-index.json'),
    log: silent,
  })
  assert.equal(stale.source, 'seed', 'a legacy cache is not trusted')

  const live = scripted(() => new Response(REMOTE_BODY, { status: 200 }))
  await loadWebCatalog({ baseUrl: BASE, fetchImpl: live.fetchImpl, cacheDir })
  assert.deepEqual(readdirSync(cacheDir), ['index-cache.json'], 'the old pair is swept')
})

test('a 304 revalidation serves the cached body and sends If-None-Match', async () => {
  const cacheDir = tempCache()
  const warm = scripted(() => new Response(REMOTE_BODY, { status: 200, headers: { etag: '"v1"' } }))
  await loadWebCatalog({ baseUrl: BASE, fetchImpl: warm.fetchImpl, cacheDir })

  const revalidate = scripted(() => new Response(null, { status: 304 }))
  const { catalog, source } = await loadWebCatalog({
    baseUrl: BASE,
    fetchImpl: revalidate.fetchImpl,
    cacheDir,
  })
  assert.equal(source, 'remote')
  assert.equal(catalog.items.length, fixture.catalog.items.length)
  const sent = new Headers(revalidate.calls[0]?.init?.headers)
  assert.equal(sent.get('if-none-match'), '"v1"')
})

test('a network failure with a warm cache serves the cache and says so', async () => {
  const cacheDir = tempCache()
  const warm = scripted(() => new Response(REMOTE_BODY, { status: 200 }))
  await loadWebCatalog({ baseUrl: BASE, fetchImpl: warm.fetchImpl, cacheDir })

  const lines: string[] = []
  const dead = scripted(() => {
    throw new Error('getaddrinfo ENOTFOUND')
  })
  const { source } = await loadWebCatalog({
    baseUrl: BASE,
    fetchImpl: dead.fetchImpl,
    cacheDir,
    log: (l) => void lines.push(l),
  })
  assert.equal(source, 'cache')
  // TRANSPORT is the one class where "check the network" is the right advice.
  assert.match(lines.join(''), /could not reach/)
  assert.match(lines.join(''), /cached copy \(fetched \d{4}-/, 'the age is disclosed')
  assert.ok(!lines.join('').includes('not JSON'))
  assert.ok(!lines.join('').includes('not a valid agent index'))
})

test('a 200 that is not JSON reads as a malformed body, not a network fault', async () => {
  const lines: string[] = []
  const html = scripted(
    () =>
      new Response('<!doctype html><html><body>app shell</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  )
  const { source } = await loadWebCatalog({
    baseUrl: BASE,
    fetchImpl: html.fetchImpl,
    cacheDir: tempCache(),
    seedPath: path.join(fixture.root, 'agent-index.json'),
    log: (l) => void lines.push(l),
  })
  assert.equal(source, 'seed')
  assert.match(lines.join(''), /not JSON/)
  assert.match(lines.join(''), /HTML page/)
  assert.ok(!lines.join('').includes('could not reach'), 'the origin answered — it is reachable')
})

test('a network failure with no cache serves the bundled seed', async () => {
  const lines: string[] = []
  const dead = scripted(() => {
    throw new Error('offline')
  })
  const { catalog, source } = await loadWebCatalog({
    baseUrl: BASE,
    fetchImpl: dead.fetchImpl,
    cacheDir: tempCache(),
    seedPath: path.join(fixture.root, 'agent-index.json'),
    log: (l) => void lines.push(l),
  })
  assert.equal(source, 'seed')
  assert.equal(catalog.identity.homepage, BASE)
  assert.match(lines.join(''), /bundled seed/)
})

test('an invalid remote body falls through without poisoning the cache', async () => {
  const cacheDir = tempCache()
  const lines: string[] = []
  const bad = scripted(() => new Response('{"schemaVersion":"1"}', { status: 200 }))
  const { source } = await loadWebCatalog({
    baseUrl: BASE,
    fetchImpl: bad.fetchImpl,
    cacheDir,
    seedPath: path.join(fixture.root, 'agent-index.json'),
    log: (l) => void lines.push(l),
  })
  assert.equal(source, 'seed')
  // Validation runs BEFORE caching — a body that failed the Zod gate must
  // never become the next start's "cached copy".
  assert.equal(existsSync(path.join(cacheDir, 'index-cache.json')), false)
  // SCHEMA-INVALID names itself, and its remedy is not "run a build here":
  // nobody debugging a FETCHED index can fix it from this checkout.
  assert.match(lines.join(''), /not a valid agent index/)
  assert.match(lines.join(''), /different index schema/)
  assert.ok(!lines.join('').includes('could not reach'))
  assert.ok(!lines.join('').includes('registry:build'))
})

test('a base-URL switch ignores the other origin’s cache', async () => {
  const cacheDir = tempCache()
  const warm = scripted(() => new Response(REMOTE_BODY, { status: 200 }))
  await loadWebCatalog({ baseUrl: BASE, fetchImpl: warm.fetchImpl, cacheDir })

  const dead = scripted(() => {
    throw new Error('offline')
  })
  const { source } = await loadWebCatalog({
    baseUrl: 'https://other.test',
    fetchImpl: dead.fetchImpl,
    cacheDir,
    seedPath: path.join(fixture.root, 'agent-index.json'),
    log: silent,
  })
  assert.equal(source, 'seed', 'the cache is keyed to the URL it came from')
})

test('a corrupt cached body is cleared and the seed serves', async () => {
  const cacheDir = tempCache()
  const warm = scripted(() => new Response(REMOTE_BODY, { status: 200 }))
  await loadWebCatalog({ baseUrl: BASE, fetchImpl: warm.fetchImpl, cacheDir })
  // A well-formed envelope whose BODY no longer parses.
  writeFileSync(
    path.join(cacheDir, 'index-cache.json'),
    JSON.stringify({ url: indexUrl(BASE), etag: null, fetchedAt: '', body: '{ truncated' }),
  )

  const dead = scripted(() => {
    throw new Error('offline')
  })
  const { source } = await loadWebCatalog({
    baseUrl: BASE,
    fetchImpl: dead.fetchImpl,
    cacheDir,
    seedPath: path.join(fixture.root, 'agent-index.json'),
    log: silent,
  })
  assert.equal(source, 'seed')
})
