// The MCP tools over the WEB engine — a real client against the synthetic
// fixture with a stubbed fetch. tools-catalog-engine.test.ts is the template;
// this file pins the web-only behaviours: the engine disclosure in search
// prose, the gated-item answer, the 404-drift answer (no checkout language),
// and a fetched source round-trip.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { parseCatalog } from '../src/catalog.ts'
import { createWebEngine } from '../src/engine-web.ts'
import { loadIconCatalog } from '../src/icons.ts'
import { loadAnchors } from '../src/theme-anchors.ts'
import { buildRegistryServer } from '../src/mcp/server.ts'
import { SearchComponentsOutput } from '../src/mcp/schemas.ts'
import { buildCatalogFixture, SPLIT_PARTS, SPLIT_SOURCE } from './fixtures/catalog-fixture.ts'

const fixture = buildCatalogFixture()
const BASE = 'https://fixture.test'

// fixture-drawer is flipped gated so one server exercises both answers.
const raw = JSON.parse(readFileSync(path.join(fixture.root, 'agent-index.json'), 'utf8')) as {
  items: { name: string; gated: boolean; sourceBytes: number | null }[]
}
raw.items.find((i) => i.name === 'fixture-drawer')!.gated = true
const catalog = parseCatalog(raw, 'gated-fixture')

const fetchImpl = ((url: string | URL | Request): Promise<Response> => {
  const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
  const name = /\/r\/(.+)\.json$/.exec(u)?.[1]
  const onDisk = name === null ? null : path.join(fixture.root, 'public', 'r', `${name}.json`)
  try {
    if (onDisk === null) throw new Error('not a payload URL')
    return Promise.resolve(new Response(readFileSync(onDisk, 'utf8'), { status: 200 }))
  } catch {
    return Promise.resolve(new Response('{"error":"not_found"}', { status: 404 }))
  }
}) as typeof fetch

const engine = createWebEngine(catalog, { baseUrl: BASE, indexSource: 'remote', fetchImpl })
const server = buildRegistryServer({
  // The SAME catalog the engine runs over — mcp.ts assigns the fetched catalog
  // to both on this engine. Handing the server the committed artifact instead
  // (as this did) makes ctx.catalog describe a different registry than the
  // tools answer from, which is exactly what the gated flag reads.
  engine,
  identity: engine.identity,
  icons: loadIconCatalog(),
  anchors: loadAnchors(),
  catalog,
  catalogSync: 'in-sync',
})
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'tools-web-engine-test', version: '0' })
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

after(async () => {
  await client.close()
  await server.close()
})

const call = async (
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> => {
  const r = await client.callTool({ name, arguments: args })
  const first = (r.content as { text?: string }[])[0]
  return { isError: Boolean(r.isError), text: first?.text ?? '' }
}

test('only the tool that egresses declares an open world', async () => {
  // openWorldHint is a policy signal: a host may auto-approve a closed-world
  // tool. On this engine get_component_source fetches from the deployed origin
  // and carries ENCODE_UI_TOKEN when set — the other eight read memory, and
  // validate_theme is pure math over vendored artifacts.
  const { tools } = await client.listTools()
  assert.equal(tools.length, 9)
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} readOnlyHint`)
    assert.equal(
      t.annotations?.openWorldHint,
      t.name === 'get_component_source',
      `${t.name} openWorldHint`,
    )
  }
})

test('search stamps engine "web" and its prose steers to the catalog resource', async () => {
  const r = await client.callTool({
    name: 'search_components',
    arguments: { query: 'popup window' },
  })
  assert.equal(Boolean(r.isError), false)
  const out = SearchComponentsOutput.parse(r.structuredContent)
  assert.equal(out.engine, 'web')
  assert.equal(out.degraded, false)
  const text = (r.content as { text?: string }[])[0]?.text ?? ''
  assert.match(text, /web engine/)
  assert.match(text, /encode-ui:\/\/catalog/)
  assert.ok(!text.includes('catalog engine'), 'web results must not wear the catalog note')
})

test('find_similar prose declares structural overlap on the web engine', async () => {
  const r = await call('find_similar', { name: 'fixture-magnetic' })
  assert.equal(r.isError, false)
  assert.match(r.text, /structural overlap/)
  assert.match(r.text, /not embedding similarity/)
})

test('a gated item is flagged before the caller spends a source call', async () => {
  // The whole point: without this, an agent learns an item is gated only when
  // get_component_source hard-errors — after it already paid for the lookup.
  const search = await client.callTool({
    name: 'search_components',
    arguments: { query: 'fixture-drawer' },
  })
  const out = SearchComponentsOutput.parse(search.structuredContent)
  assert.equal(out.hits[0]?.name, 'fixture-drawer')
  assert.equal(out.hits[0]?.gated, true)
  assert.match((search.content as { text?: string }[])[0]?.text ?? '', /gated/)

  const detail = await client.callTool({
    name: 'get_component',
    arguments: { name: 'fixture-drawer' },
  })
  assert.equal((detail.structuredContent as { gated?: boolean }).gated, true)
  assert.match((detail.content as { text?: string }[])[0]?.text ?? '', /registry account/)

  const free = await client.callTool({ name: 'get_component', arguments: { name: 'fixture-button' } })
  assert.equal((free.structuredContent as { gated?: boolean }).gated, false)
  assert.ok(!((free.content as { text?: string }[])[0]?.text ?? '').includes('gated'))
})

test('a gated item without a token answers with the sign-in remedy, not a fault', async () => {
  const r = await call('get_component_source', { name: 'fixture-drawer', part: 'source' })
  assert.equal(r.isError, true)
  assert.match(r.text, /gated item/)
  assert.match(r.text, /ENCODE_UI_TOKEN/)
  assert.match(r.text, /fixture\.test/)
  assert.ok(!r.text.includes('checkout'), 'web answers never talk about a checkout')
})

test('a 404 from the origin answers as drift in origin language', async () => {
  // fixture-dialog promises sourceBytes; the stub has no payload for it.
  const r = await call('get_component_source', { name: 'fixture-dialog', part: 'source' })
  assert.equal(r.isError, true)
  assert.match(r.text, /origin has no source payload/)
  assert.match(r.text, /install directly/)
  assert.ok(!r.text.includes('checkout'), 'web answers never talk about a checkout')
  assert.ok(!r.text.includes('registry:build'), 'regeneration is checkout advice')
})

test('an HTML body from the origin answers as drift, never as a network fault', async () => {
  // The whole point of the guard: guarded() would otherwise rewrite the parse
  // SyntaxError into "check network access to the registry origin".
  const shellEngine = createWebEngine(catalog, {
    baseUrl: BASE,
    indexSource: 'remote',
    fetchImpl: () =>
      Promise.resolve(new Response('<!doctype html><html></html>', { status: 200 })),
  })
  const shellServer = buildRegistryServer({
    engine: shellEngine,
    identity: shellEngine.identity,
    icons: loadIconCatalog(),
    anchors: loadAnchors(),
    catalog,
    catalogSync: 'in-sync',
  })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const shellClient = new Client({ name: 'tools-web-shell-test', version: '0' })
  await Promise.all([shellClient.connect(ct), shellServer.connect(st)])
  try {
    const r = await shellClient.callTool({
      name: 'get_component_source',
      arguments: { name: 'fixture-button', part: 'source' },
    })
    const text = (r.content as { text?: string }[])[0]?.text ?? ''
    assert.equal(Boolean(r.isError), true)
    assert.match(text, /origin has no source payload/)
    assert.ok(!text.includes('network access'), 'a served body is not a network fault')
  } finally {
    await shellClient.close()
    await shellServer.close()
  }
})

test('a fetched multi-file source round-trips with every sibling', async () => {
  const r = await call('get_component_source', { name: 'fixture-split', part: 'source' })
  assert.equal(r.isError, false)
  assert.ok(r.text.includes(SPLIT_SOURCE.trim()))
  assert.ok(r.text.includes(SPLIT_PARTS.trim()), 'the parts sibling ships with the public module')
})
