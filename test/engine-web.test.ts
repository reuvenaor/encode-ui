// The web engine over the synthetic fixture — filter semantics, structural
// findSimilar, and HTTP sourceOf, all through an injected fetch (no network).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { parseCatalog } from '../src/catalog.ts'
import { createCatalogEngine } from '../src/engine-catalog.ts'
import { createWebEngine } from '../src/engine-web.ts'
import { renderSource } from '../src/mcp/render.ts'
import { BUTTON_DEMO, BUTTON_SOURCE, buildCatalogFixture } from './fixtures/catalog-fixture.ts'

const fixture = buildCatalogFixture()
const BASE = 'https://fixture.test'

/** Serve the fixture checkout's payloads over the stubbed wire. */
const fixtureFetch = (): {
  fetchImpl: typeof fetch
  calls: { url: string; auth: string | null }[]
} => {
  const calls: { url: string; auth: string | null }[] = []
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    calls.push({ url: u, auth: new Headers(init?.headers).get('authorization') })
    const name = /\/r\/(.+)\.json$/.exec(u)?.[1]
    if (name === 'fixture-button.demo') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: 'fixture-button',
            files: [{ path: 'src/demos/buttons/fixture-button.tsx', content: BUTTON_DEMO }],
          }),
          { status: 200 },
        ),
      )
    }
    const onDisk = name === null ? null : path.join(fixture.root, 'public', 'r', `${name}.json`)
    try {
      if (onDisk === null) throw new Error('not a payload URL')
      return Promise.resolve(new Response(readFileSync(onDisk, 'utf8'), { status: 200 }))
    } catch {
      return Promise.resolve(new Response('{"error":"not_found"}', { status: 404 }))
    }
  }) as typeof fetch
  return { fetchImpl, calls }
}

const makeEngine = (): ReturnType<typeof createWebEngine> => {
  const { fetchImpl } = fixtureFetch()
  return createWebEngine(fixture.catalog, { baseUrl: BASE, indexSource: 'remote', fetchImpl })
}

test('an exact name or curated alias short-circuits to rank 1', async () => {
  const engine = makeEngine()
  const byName = await engine.search('fixture-dialog')
  assert.equal(byName.hits[0]?.name, 'fixture-dialog')
  assert.deepEqual(byName.hits[0]?.matchedOn, ['name:web'])

  const byAlias = await engine.search('modal')
  assert.equal(byAlias.hits[0]?.name, 'fixture-dialog')
  assert.deepEqual(byAlias.hits[0]?.matchedOn, ['alias:web'])
  assert.equal(byAlias.degraded, false)
})

test('filtering is AND over substring terms — every term must land', async () => {
  const engine = makeEngine()
  const both = await engine.search('popup window')
  assert.ok(both.hits.some((h) => h.name === 'fixture-dialog'), 'keyword phrase matches')

  const miss = await engine.search('popup zzznothing')
  assert.equal(miss.hits.length, 0, 'one dead term kills the AND match')
})

test('punctuation does not ride along into a term', async () => {
  const engine = makeEngine()
  // Each of these used to return ZERO hits: the trailing/embedded punctuation
  // stayed glued to the term, and no document contains "modal?" as a substring.
  const alias = await engine.search('modal?')
  assert.equal(alias.hits[0]?.name, 'fixture-dialog')
  assert.deepEqual(alias.hits[0]?.matchedOn, ['alias:web'])

  const phrase = await engine.search('popup, window')
  assert.ok(phrase.hits.some((h) => h.name === 'fixture-dialog'))

  const sentence = await engine.search('a fixture.')
  assert.ok(sentence.hits.length > 0, 'the dropped "a" must not kill the AND')
})

test('a degenerate query matches nothing rather than a slice of the catalog', async () => {
  const engine = makeEngine()
  // Every fixture name contains "-", and almost every description contains
  // "." — so these used to return an alphabetical slice, several of them
  // graded tier 0, i.e. presented to the model as NAME matches.
  assert.deepEqual((await engine.search('.')).hits, [])
  assert.deepEqual((await engine.search('-')).hits, [])
  assert.deepEqual((await engine.search('   ')).hits, [])
})

test('a hyphenated name resolves exactly and also filters term-by-term', async () => {
  const engine = makeEngine()
  const exact = await engine.search('fixture-dialog')
  assert.equal(exact.hits[0]?.name, 'fixture-dialog')
  assert.deepEqual(exact.hits[0]?.matchedOn, ['name:web'])

  const split = await engine.search('fixture dialog')
  assert.ok(split.hits.some((h) => h.name === 'fixture-dialog'))
})

test('matches rank by the strongest field that matched, then name', async () => {
  const engine = makeEngine()
  const { hits } = await engine.search('fixture', { k: 25 })
  // Every code item's NAME contains "fixture" (tier 0); theme-one matches only
  // in its description (tier 2) and must sort last.
  assert.ok(hits.length >= 2)
  assert.equal(hits[hits.length - 1]?.name, 'theme-one')
  assert.ok(hits[hits.length - 1]?.matchedOn.includes('description:web'))

  // Scores are rank-derived: strictly non-increasing, cosine always null.
  for (let i = 1; i < hits.length; i += 1) {
    assert.ok(hits[i]!.score <= hits[i - 1]!.score)
  }
  assert.ok(hits.every((h) => h.cosine === null))
})

test('search filters run before ranking, and k caps the result', async () => {
  const engine = makeEngine()
  const overlays = await engine.search('fixture', { group: 'overlays', k: 25 })
  assert.ok(overlays.hits.length > 0)
  assert.ok(overlays.hits.every((h) => h.group === 'overlays'))

  const animated = await engine.search('fixture', { motion: true, k: 25 })
  assert.deepEqual(
    animated.hits.map((h) => h.name),
    ['fixture-magnetic'],
  )

  const capped = await engine.search('fixture', { k: 2 })
  assert.equal(capped.hits.length, 2)
})

test('findSimilar is structural — group, categories, composition — with :web evidence', () => {
  const engine = makeEngine()
  const neighbours = engine.findSimilar('fixture-magnetic')
  assert.ok(neighbours.length > 0)
  assert.equal(neighbours[0]?.name, 'fixture-button', 'same group + composition edge leads')
  assert.ok(neighbours.every((h) => h.matchedOn.length === 1 && h.matchedOn[0] === 'similar:web'))
  assert.deepEqual(engine.findSimilar('no-such-item'), [])
  assert.equal(engine.canFindSimilar('fixture-button'), true)
})

test('sourceOf fetches the payload from the origin and combines its files', async () => {
  const { fetchImpl, calls } = fixtureFetch()
  const engine = createWebEngine(fixture.catalog, {
    baseUrl: BASE,
    indexSource: 'remote',
    fetchImpl,
  })

  const source = await engine.sourceOf('fixture-button', 'source')
  assert.ok(Array.isArray(source))
  assert.equal(source[0]?.code, BUTTON_SOURCE)
  assert.equal(calls[0]?.url, `${BASE}/r/fixture-button.json`)

  const demo = await engine.sourceOf('fixture-button', 'demo')
  assert.ok(Array.isArray(demo))
  assert.equal(demo[0]?.code, BUTTON_DEMO)
  assert.equal(calls[1]?.url, `${BASE}/r/fixture-button.demo.json`)
})

test('a promised part the origin 404s is drifted; a missing part is null without a fetch', async () => {
  const { fetchImpl, calls } = fixtureFetch()
  const engine = createWebEngine(fixture.catalog, {
    baseUrl: BASE,
    indexSource: 'remote',
    fetchImpl,
  })

  // fixture-dialog promises sourceBytes but the fixture checkout ships no
  // payload for it — the stub 404s, which the web engine reads as drift.
  assert.equal(await engine.sourceOf('fixture-dialog', 'source'), 'drifted')

  // fixture-lib has demoBytes null — answered from the index, no round-trip.
  const before = calls.length
  assert.equal(await engine.sourceOf('fixture-lib', 'demo'), null)
  assert.equal(calls.length, before, 'a missing part must not cost a fetch')
})

test('a 200 that is not JSON reads as drift, not as a fault', async () => {
  // A host whose SPA fallback swallows the 404 (any static host over
  // build/client), a CDN interstitial, a captive portal: all answer 200 with
  // HTML. The parse used to throw, and the model was told to check its network.
  const spaShell = createWebEngine(fixture.catalog, {
    baseUrl: BASE,
    indexSource: 'remote',
    fetchImpl: () =>
      Promise.resolve(
        new Response('<!doctype html><html><body>the app shell</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
  })
  assert.equal(await spaShell.sourceOf('fixture-button', 'source'), 'drifted')
})

test('gated items short-circuit without a token and send the bearer with one', async () => {
  const raw = JSON.parse(
    readFileSync(path.join(fixture.root, 'agent-index.json'), 'utf8'),
  ) as { items: { name: string; gated: boolean }[] }
  raw.items.find((i) => i.name === 'fixture-button')!.gated = true
  const gatedCatalog = parseCatalog(raw, 'gated-fixture')

  const anonymous = fixtureFetch()
  const noToken = createWebEngine(gatedCatalog, {
    baseUrl: BASE,
    indexSource: 'remote',
    fetchImpl: anonymous.fetchImpl,
  })
  assert.equal(await noToken.sourceOf('fixture-button', 'source'), 'gated')
  assert.equal(anonymous.calls.length, 0, 'known-gated with no token must not fetch')

  const authed = fixtureFetch()
  const withToken = createWebEngine(gatedCatalog, {
    baseUrl: BASE,
    indexSource: 'remote',
    fetchImpl: authed.fetchImpl,
    token: 'session-jwt',
  })
  const files = await withToken.sourceOf('fixture-button', 'source')
  assert.ok(Array.isArray(files))
  assert.equal(authed.calls[0]?.auth, 'Bearer session-jwt')

  // The origin still refusing (expired token) reads as gated, not as a fault.
  const refused = createWebEngine(gatedCatalog, {
    baseUrl: BASE,
    indexSource: 'remote',
    fetchImpl: () =>
      Promise.resolve(new Response('{"error":"sign_in_required"}', { status: 401 })),
    token: 'expired',
  })
  assert.equal(await refused.sourceOf('fixture-button', 'source'), 'gated')
})

test('renderSource output is byte-identical to the catalog engine for the same payload', async () => {
  const webEngine = makeEngine()
  const catalogEngine = createCatalogEngine(fixture.catalog, { registryRoot: fixture.root })

  const fromWeb = await webEngine.sourceOf('fixture-split', 'source')
  const fromCatalog = await catalogEngine.sourceOf('fixture-split', 'source')
  assert.ok(Array.isArray(fromWeb) && Array.isArray(fromCatalog))
  assert.equal(
    renderSource('@fixture/fixture-split', 'source', fromWeb),
    renderSource('@fixture/fixture-split', 'source', fromCatalog),
  )
})

test('the banner meta names the engine kind and how the index arrived', () => {
  const engine = makeEngine()
  assert.equal(engine.kind, 'web')
  assert.match(engine.meta.detail, /index: remote/)
  assert.equal(engine.meta.itemCount, fixture.catalog.items.length)
  // Structured too, not just in the banner prose — the catalog resource reads
  // this to decide whether to disclose a stale corpus.
  assert.equal(engine.meta.indexSource, 'remote')
  const offline = createWebEngine(fixture.catalog, {
    baseUrl: BASE,
    indexSource: 'seed',
    fetchImpl: fixtureFetch().fetchImpl,
  })
  assert.equal(offline.meta.indexSource, 'seed')
})
