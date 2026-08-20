// The catalog resource, round-tripped through a real client against the REAL
// committed artifact — the deliberate full-catalog load must stay within its
// advertised budget and carry every item.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadCatalog } from '../src/catalog.ts'
import { createDbEngineFromDb } from '../src/engine-db.ts'
import { loadIconCatalog } from '../src/icons.ts'
import { loadAnchors } from '../src/theme-anchors.ts'
import { buildRegistryServer } from '../src/mcp/server.ts'
import { CATALOG_RESOURCE_URI, renderCatalogMarkdown } from '../src/mcp/resources.ts'
import { buildFixtureIndex, FIXTURE_ID } from './fixtures/index-fixture.ts'

before(() => {
  process.env.ENCODE_UI_RAG_LEXICAL_ONLY = '1'
})

// A db-engine server on purpose: the resource must be served on BOTH engines,
// and the db engine is the one that does NOT already hold the catalog.
const db = buildFixtureIndex([{ name: 'alpha-button', group: 'buttons' }])
const server = buildRegistryServer({
  engine: createDbEngineFromDb(db),
  identity: FIXTURE_ID,
  icons: loadIconCatalog(),
  anchors: loadAnchors(),
  catalog: loadCatalog(),
  catalogSync: 'in-sync',
})
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'resources-test', version: '0' })
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

after(async () => {
  await client.close()
  await server.close()
  db.close()
})

test('the catalog resource is advertised and reads back the whole registry', async () => {
  const { resources } = await client.listResources()
  const entry = resources.find((r) => r.uri === CATALOG_RESOURCE_URI)
  assert.ok(entry, 'encode-ui://catalog missing from resources/list')
  assert.equal(entry.mimeType, 'text/markdown')
  assert.match(entry.description ?? '', /search_components/)

  const real = loadCatalog()
  const { contents } = await client.readResource({ uri: CATALOG_RESOURCE_URI })
  const first = contents[0]
  assert.ok(first !== undefined && 'text' in first, 'expected a text resource')
  const body = first.text

  const itemLines = body.split('\n').filter((l) => l.startsWith('- ')).length
  assert.equal(itemLines, real.items.length, 'one line per item')
  assert.ok(body.includes('- sonner (aka toast, toaster, notification):'), 'aliases surface inline')
  assert.ok(
    Buffer.byteLength(body, 'utf8') < 100_000,
    `catalog view grew to ${Buffer.byteLength(body, 'utf8')} bytes`,
  )
})

test('the projection is deterministic and group-complete', () => {
  const real = loadCatalog()
  const a = renderCatalogMarkdown(real)
  assert.equal(a, renderCatalogMarkdown(real))
  for (const group of real.groups) {
    assert.ok(a.includes(`## ${group.label} (${group.count}) — `), `group ${group.slug} missing`)
  }
})

test('a drifted or unverifiable db index is disclosed in the resource header', () => {
  const real = loadCatalog()
  const inSync = renderCatalogMarkdown(real, 'in-sync')
  assert.ok(!inSync.includes('may not'), 'no drift note when in sync')
  for (const sync of ['drift', 'unverifiable'] as const) {
    const noted = renderCatalogMarkdown(real, sync)
    assert.match(noted, /may not\n> match the live db index/)
    assert.match(noted, /npm run build:index/)
  }
})

test('a web corpus served off disk says so, and a live one stays silent', () => {
  // This listing is the web engine's designated discovery path, and its bodies
  // are fetched LIVE — so a snapshot that came off disk has to disclose it.
  const real = loadCatalog()
  const cached = renderCatalogMarkdown(real, 'in-sync', 'cache')
  assert.match(cached, /local disk cache/)
  assert.ok(!cached.includes('BUNDLED'))

  const seeded = renderCatalogMarkdown(real, 'in-sync', 'seed')
  assert.match(seeded, /BUNDLED with this package/)
  assert.match(seeded, /source bodies cannot be fetched/)

  for (const quiet of [renderCatalogMarkdown(real, 'in-sync', 'remote'), renderCatalogMarkdown(real)]) {
    assert.ok(!quiet.includes('local disk cache'))
    assert.ok(!quiet.includes('BUNDLED'))
  }

  // The two notes are independent: the db drift note is untouched.
  assert.match(renderCatalogMarkdown(real, 'drift'), /may not\n> match the live db index/)
})
