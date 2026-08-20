// The MCP tools over the CATALOG engine — a real client against the synthetic
// fixture. tools.test.ts covers the same surface on the db engine; this file
// pins the catalog-only behaviours: alias resolution in the detail tools and
// the three DISTINCT source-failure answers (no such part / checkout drifted
// / no checkout at all).
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadCatalog } from '../src/catalog.ts'
import { createCatalogEngine } from '../src/engine-catalog.ts'
import { loadIconCatalog } from '../src/icons.ts'
import { loadAnchors } from '../src/theme-anchors.ts'
import { buildRegistryServer } from '../src/mcp/server.ts'
import { GetComponentOutput, GetInstallCommandOutput } from '../src/mcp/schemas.ts'
import { buildCatalogFixture } from './fixtures/catalog-fixture.ts'

const { catalog, root } = buildCatalogFixture()
const engine = createCatalogEngine(catalog, { registryRoot: root })
const server = buildRegistryServer({
  engine,
  identity: engine.identity,
  icons: loadIconCatalog(),
  anchors: loadAnchors(),
  catalog: loadCatalog(),
  catalogSync: 'in-sync',
})
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'tools-catalog-engine-test', version: '0' })
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

test('get_component resolves a curated alias to the canonical item', async () => {
  const r = await client.callTool({ name: 'get_component', arguments: { name: 'modal' } })
  assert.equal(Boolean(r.isError), false)
  const out = GetComponentOutput.parse(r.structuredContent)
  assert.equal(out.qualifiedName, '@fixture/fixture-dialog')
})

test('get_install_command resolves aliases and collapses to canonical names', async () => {
  const r = await client.callTool({
    name: 'get_install_command',
    arguments: { names: ['modal', 'fixture-dialog'] },
  })
  const out = GetInstallCommandOutput.parse(r.structuredContent)
  assert.deepEqual(
    out.components.map((c) => c.name),
    ['fixture-dialog'],
  )
  assert.deepEqual(out.unknown, [])
  assert.equal((out.command.match(/fixture-dialog/g) ?? []).length, 1, 'no duplicate add')
})

test('find_similar accepts an alias as its seed', async () => {
  const r = await call('find_similar', { name: 'modal' })
  assert.equal(r.isError, false)
  assert.match(r.text, /Nearest to @fixture\/fixture-dialog/)
  assert.match(r.text, /structural overlap/)
})

test('a drifted checkout and a missing part answer differently', async () => {
  // fixture-dialog PROMISES source bytes; its payload is absent from the
  // fixture checkout — the checkout drifted, and the answer says so.
  const drifted = await call('get_component_source', { name: 'fixture-dialog', part: 'source' })
  assert.equal(drifted.isError, true)
  assert.match(drifted.text, /checkout is present but the source file/)
  assert.match(drifted.text, /npm run registry:build/)
  assert.ok(!drifted.text.includes('npm run verify'), 'verify is db-only advice')

  // theme-one simply HAS no source — not an availability problem at all.
  const missing = await call('get_component_source', { name: 'theme-one', part: 'source' })
  assert.equal(missing.isError, true)
  assert.match(missing.text, /has no source/)
})

test('a detached install (no checkout) answers with the guided pointer', async () => {
  const detachedEngine = createCatalogEngine(catalog, { registryRoot: null })
  const s2 = buildRegistryServer({
    engine: detachedEngine,
    identity: detachedEngine.identity,
    icons: loadIconCatalog(),
    anchors: loadAnchors(),
    catalog: loadCatalog(),
    catalogSync: 'in-sync',
  })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const c2 = new Client({ name: 'detached', version: '0' })
  await Promise.all([c2.connect(ct), s2.connect(st)])
  const r = await c2.callTool({
    name: 'get_component_source',
    arguments: { name: 'fixture-button', part: 'source' },
  })
  const text = (r.content as { text?: string }[])[0]?.text ?? ''
  assert.equal(Boolean(r.isError), true)
  assert.match(text, /checkout, which is not present/)
  assert.match(text, /fixture-button\.json/)
  await c2.close()
  await s2.close()
})
