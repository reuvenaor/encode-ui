// Dependency awareness: the transitive closure, the pure flag on every surface,
// and the dependencyFree filter. Own fixture so the counts asserted in
// tools.test.ts stay untouched.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadIconCatalog } from '../src/icons.ts'
import { loadAnchors } from '../src/theme-anchors.ts'
import { dependencyClosure } from '../src/items.ts'
import { loadCatalog } from '../src/catalog.ts'
import { createDbEngineFromDb } from '../src/engine-db.ts'
import { buildRegistryServer } from '../src/mcp/server.ts'
import {
  GetComponentOutput,
  ListComponentsOutput,
  SearchComponentsOutput,
} from '../src/mcp/schemas.ts'
import { buildFixtureIndex, FIXTURE_ID } from './fixtures/index-fixture.ts'

before(() => {
  process.env.ENCODE_UI_RAG_LEXICAL_ONLY = '1'
})

const db = buildFixtureIndex([
  // Pure: no npm deps; the utils edge resolves to nothing in this fixture.
  { name: 'pure-card', group: 'cards', keywords: 'widget', dependencies: [] },
  // Pure BY DOCTRINE: the shadcn baseline never counts — the cn() pair from
  // `shadcn init`, plus cva + radix-ui, which any shadcn/ui primitive brings.
  {
    name: 'substrate-card',
    group: 'cards',
    keywords: 'widget',
    dependencies: ['clsx', 'tailwind-merge', 'class-variance-authority', 'radix-ui'],
  },
  // Directly heavy.
  { name: 'heavy-chart', group: 'charts', keywords: 'widget', dependencies: ['recharts'] },
  // THE case direct-only would lie about: no own deps, composes the heavy one.
  {
    name: 'composed-block',
    group: 'cards',
    keywords: 'widget',
    dependencies: [],
    registryDeps: ['@encode-ui/heavy-chart'],
  },
])

const server = buildRegistryServer({
  engine: createDbEngineFromDb(db),
  identity: FIXTURE_ID,
  icons: loadIconCatalog(),
  anchors: loadAnchors(),
  catalog: loadCatalog(),
  catalogSync: 'in-sync',
})
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'deps-test', version: '0' })
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

after(async () => {
  await client.close()
  await server.close()
  db.close()
})

// ── the closure itself ───────────────────────────────────────────────────────

test('the closure is transitive and baseline-exempt', () => {
  const deps = dependencyClosure(db)
  assert.equal(deps.get('pure-card')?.pure, true)
  assert.equal(deps.get('substrate-card')?.pure, true, 'clsx/tailwind-merge are substrate')
  assert.deepEqual(deps.get('heavy-chart')?.transitiveDependencies, ['recharts'])
  assert.equal(deps.get('composed-block')?.pure, false, 'composition must carry deps through')
  assert.deepEqual(deps.get('composed-block')?.transitiveDependencies, ['recharts'])
})

// ── the filter, through the SDK ──────────────────────────────────────────────

test('dependencyFree: true returns only transitively pure hits', async () => {
  const r = await client.callTool({
    name: 'search_components',
    arguments: { query: 'widget', dependencyFree: true },
  })
  const out = SearchComponentsOutput.parse(r.structuredContent)
  assert.deepEqual(
    out.hits.map((h) => h.name).sort(),
    ['pure-card', 'substrate-card'],
    'composed-block must NOT pass — its composition pulls recharts',
  )
  assert.ok(out.hits.every((h) => h.pure))
})

test('dependencyFree: false returns only dep-carrying hits', async () => {
  const r = await client.callTool({
    name: 'search_components',
    arguments: { query: 'widget', dependencyFree: false },
  })
  const out = SearchComponentsOutput.parse(r.structuredContent)
  assert.deepEqual(out.hits.map((h) => h.name).sort(), ['composed-block', 'heavy-chart'])
  assert.ok(out.hits.every((h) => !h.pure))
})

test('list_components carries pure per row and honours the filter', async () => {
  const all = await client.callTool({ name: 'list_components', arguments: { group: 'cards' } })
  const out = ListComponentsOutput.parse(all.structuredContent)
  assert.deepEqual(
    out.components.map((c) => `${c.name}:${c.pure}`),
    ['composed-block:false', 'pure-card:true', 'substrate-card:true'],
  )
  const text = (all.content as { text: string }[])[0]!.text
  assert.match(text, /pure-card \(dependency-free\)/)

  const filtered = await client.callTool({
    name: 'list_components',
    arguments: { group: 'cards', dependencyFree: true },
  })
  const pure = ListComponentsOutput.parse(filtered.structuredContent)
  assert.deepEqual(
    pure.components.map((c) => c.name),
    ['pure-card', 'substrate-card'],
  )
})

test('get_component reports the transitive tree, not just the declared line', async () => {
  const r = await client.callTool({
    name: 'get_component',
    arguments: { name: 'composed-block' },
  })
  const out = GetComponentOutput.parse(r.structuredContent)
  assert.equal(out.pureReact, false)
  assert.deepEqual(out.dependencies, [], 'declared deps stay as declared')
  assert.deepEqual(out.transitiveDependencies, ['recharts'])
  const text = (r.content as { text: string }[])[0]!.text
  assert.match(text, /install weight: adds recharts/)

  const p = await client.callTool({ name: 'get_component', arguments: { name: 'pure-card' } })
  const pureOut = GetComponentOutput.parse(p.structuredContent)
  assert.equal(pureOut.pureReact, true)
  const pureText = (p.content as { text: string }[])[0]!.text
  assert.match(pureText, /dependency-free — nothing beyond the shadcn baseline/)

  // The substrate case is the one a reader could mistake for a contradiction:
  // the declared line keeps radix-ui (it IS installed), while the weight line
  // reports nothing, because that pair is the baseline every consumer runs.
  const s = await client.callTool({ name: 'get_component', arguments: { name: 'substrate-card' } })
  const substrate = GetComponentOutput.parse(s.structuredContent)
  assert.equal(substrate.pureReact, true)
  assert.deepEqual(substrate.dependencies, [
    'clsx',
    'tailwind-merge',
    'class-variance-authority',
    'radix-ui',
  ])
  assert.deepEqual(substrate.transitiveDependencies, [])
})
