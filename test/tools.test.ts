import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DEFAULT_K, MAX_K } from '../src/search.ts'
import { loadIconCatalog } from '../src/icons.ts'
import { loadCatalog } from '../src/catalog.ts'
import { createDbEngineFromDb } from '../src/engine-db.ts'
import { buildRegistryServer } from '../src/mcp/server.ts'
import {
  FindIconsOutput,
  FindSimilarOutput,
  GetComponentOutput,
  GetInstallCommandOutput,
  ListComponentsOutput,
  ListGroupsOutput,
  SearchComponentsOutput,
} from '../src/mcp/schemas.ts'
import { buildFixtureIndex, FIXTURE_ID } from './fixtures/index-fixture.ts'

before(() => {
  process.env.ENCODE_UI_RAG_LEXICAL_ONLY = '1'
})

const db = buildFixtureIndex([
  { name: 'alpha-button', group: 'buttons', motion: true, keywords: 'widget gadget' },
  { name: 'beta-input', group: 'forms', keywords: 'widget', partsLayer: true },
  { name: 'gamma-card', group: 'cards', type: 'registry:lib', keywords: 'widget' },
])

// The REAL committed artifact, not a fixture: it is deterministic, ~2 ms to
// parse, and using it means these round-trips also prove the artifact's shape.
const server = buildRegistryServer({
  engine: createDbEngineFromDb(db),
  identity: FIXTURE_ID,
  icons: loadIconCatalog(),
  catalog: loadCatalog(),
  catalogSync: 'in-sync',
})
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'tools-test', version: '0' })
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

after(async () => {
  await client.close()
  await server.close()
  db.close()
})

const EXPECTED_TOOLS = [
  'search_components',
  'find_similar',
  'get_component',
  'get_component_source',
  'list_groups',
  'list_components',
  'get_install_command',
  'find_icons',
] as const

/** The tool that must NOT gain an output schema — see its handler for why. */
const TEXT_ONLY_TOOL = 'get_component_source'

// ── catalog shape ────────────────────────────────────────────────────────────

test('the server advertises exactly the expected tools', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED_TOOLS].sort())
})

test('every tool declares an output schema except the source one', async () => {
  const { tools } = await client.listTools()
  for (const t of tools) {
    const shouldHave = t.name !== TEXT_ONLY_TOOL
    assert.equal(
      Boolean(t.outputSchema),
      shouldHave,
      t.name === TEXT_ONLY_TOOL
        ? 'get_component_source must stay text-only: a schema would JSON-escape the code'
        : `${t.name} should declare an output schema`,
    )
  }
})

test('on a local engine every tool is read-only and closed-world', async () => {
  // This server runs the db engine: every answer comes from the local index,
  // so nothing here declares an open world. The web engine's one exception is
  // pinned in tools-web-engine.test.ts.
  const { tools } = await client.listTools()
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} readOnlyHint`)
    assert.equal(t.annotations?.openWorldHint, false, `${t.name} openWorldHint`)
  }
})

test('k reaches the JSON Schema with its default and bounds', async () => {
  const { tools } = await client.listTools()
  for (const name of ['search_components', 'find_similar']) {
    const schema = tools.find((t) => t.name === name)?.inputSchema
    const k = (schema?.properties as Record<string, Record<string, unknown>> | undefined)?.k
    assert.equal(k?.default, DEFAULT_K, `${name}: default`)
    assert.equal(k?.maximum, MAX_K, `${name}: maximum`)
    assert.ok(!schema?.required?.includes('k'), `${name}: k is optional`)
  }
})

test('inputs are closed — a typo is rejected, not silently dropped', async () => {
  const { tools } = await client.listTools()
  for (const t of tools) {
    if (Object.keys(t.inputSchema.properties ?? {}).length === 0) continue
    assert.equal(
      (t.inputSchema as Record<string, unknown>).additionalProperties,
      false,
      `${t.name} should pass the whole strict object, not its raw shape`,
    )
  }
})

test('every tool carries a title and a description a model can act on', async () => {
  const { tools } = await client.listTools()
  for (const t of tools) {
    assert.ok(t.title && t.title.length > 0, `${t.name} title`)
    assert.ok((t.description ?? '').length > 60, `${t.name} description is too thin`)
  }
})

// ── payloads validate against their declared schemas, through the SDK ────────

test('search_components returns a payload matching its schema', async () => {
  const r = await client.callTool({ name: 'search_components', arguments: { query: 'widget' } })
  const out = SearchComponentsOutput.parse(r.structuredContent)
  assert.equal(out.query, 'widget')
  assert.equal(out.count, out.hits.length)
  assert.ok(out.count > 0)
  assert.equal(out.degraded, true, 'lexical-only in tests')
  assert.ok(out.hits.every((h) => h.scoreKind === 'rrf'))
})

test('find_similar returns a payload matching its schema', async () => {
  const r = await client.callTool({
    name: 'find_similar',
    arguments: { name: 'alpha-button', k: 2 },
  })
  const out = FindSimilarOutput.parse(r.structuredContent)
  assert.equal(out.seed, 'alpha-button')
  assert.ok(!out.neighbours.some((n) => n.name === 'alpha-button'))
  assert.ok(out.neighbours.every((n) => n.scoreKind === 'cosine'))
})

test('get_component returns metadata and byte counts, never the blob', async () => {
  const r = await client.callTool({ name: 'get_component', arguments: { name: 'alpha-button' } })
  const out = GetComponentOutput.parse(r.structuredContent)
  assert.deepEqual(out.group, { slug: 'buttons', label: 'Buttons' })
  assert.equal(out.qualifiedName, '@encode-ui/alpha-button')
  assert.ok(out.sourceBytes !== null && out.sourceBytes > 0)
  assert.ok(!JSON.stringify(out).includes('export function'), 'the source must not ride along')
})

test('get_component_source returns unescaped code and no structured content', async () => {
  const r = await client.callTool({
    name: 'get_component_source',
    arguments: { name: 'alpha-button' },
  })
  assert.equal('structuredContent' in r, false)
  const text = (r.content as { text: string }[])[0]!.text
  assert.match(text, /```tsx/)
  assert.match(text, /export function alpha-button|export function/)
  assert.ok(!text.includes('\\n'), 'newlines stay real, not JSON-escaped')
})

test('get_component_source ships the parts sibling with the public module', async () => {
  // files[0] IMPORTS ./<name>.parts, so handing back only the public module gives
  // a file whose surfaces are undefined — with nothing in the response saying so.
  const r = await client.callTool({
    name: 'get_component_source',
    arguments: { name: 'beta-input' },
  })
  const text = (r.content as { text: string }[])[0]!.text
  assert.match(text, /beta-input\.tsx/)
  assert.match(text, /beta-input\.parts\.tsx/)
  assert.match(text, /export const beta-inputSurface|Surface = \(\) => null/)
  assert.equal(text.match(/```tsx/g)?.length, 2, 'one fenced block per shipped file')

  // …and the cost signal covers BOTH, or a caller sizing the payload undercounts.
  const meta = await client.callTool({ name: 'get_component', arguments: { name: 'beta-input' } })
  const out = GetComponentOutput.parse(meta.structuredContent)
  assert.match(out.partsFilePath ?? '', /beta-input\.parts\.tsx/)
  const single = await client.callTool({
    name: 'get_component',
    arguments: { name: 'alpha-button' },
  })
  const plain = GetComponentOutput.parse(single.structuredContent)
  assert.equal(plain.partsFilePath, null)
  assert.ok(out.sourceBytes! > plain.sourceBytes!)
})

test('list_groups and get_install_command match their schemas', async () => {
  const g = await client.callTool({ name: 'list_groups', arguments: {} })
  const groups = ListGroupsOutput.parse(g.structuredContent)
  assert.equal(groups.totalItems, 3)
  // Every group comes from the same query now — no synthesised themes row, so a
  // fixture with no theme items reports no themes group.
  assert.deepEqual(groups.groups.map((x) => x.slug).sort(), ['buttons', 'cards', 'forms'])

  const i = await client.callTool({
    name: 'get_install_command',
    arguments: { names: ['alpha-button', 'beta-input'] },
  })
  const install = GetInstallCommandOutput.parse(i.structuredContent)
  assert.equal(install.components.length, 2)
  assert.deepEqual(install.unknown, [])
  assert.match(install.command, /@encode-ui\/alpha-button @encode-ui\/beta-input/)
})

test('list_components enumerates a group in full, not a ranked sample', async () => {
  const r = await client.callTool({ name: 'list_components', arguments: { group: 'buttons' } })
  const out = ListComponentsOutput.parse(r.structuredContent)
  assert.deepEqual(out.group, { slug: 'buttons', label: 'Buttons' })
  assert.equal(out.count, out.components.length)
  assert.deepEqual(
    out.components.map((c) => c.name),
    ['alpha-button'],
  )
  const text = (r.content as { text: string }[])[0]!.text
  assert.match(text, /full membership/)
  assert.match(text, /alpha-button/)
})

// ── both channels describe the same thing ────────────────────────────────────

test('the text channel never contradicts the structured one', async () => {
  const r = await client.callTool({
    name: 'search_components',
    arguments: { query: 'widget', k: 3 },
  })
  const out = SearchComponentsOutput.parse(r.structuredContent)
  const text = (r.content as { text: string }[])[0]!.text
  for (const hit of out.hits) {
    assert.ok(text.includes(hit.name), `${hit.name} is in the payload but not the prose`)
    assert.ok(text.includes(hit.installCmd), `install command for ${hit.name} missing from prose`)
  }
})

test('a scope-prefixed name resolves the same as a bare one', async () => {
  const bare = await client.callTool({ name: 'get_component', arguments: { name: 'alpha-button' } })
  const scoped = await client.callTool({
    name: 'get_component',
    arguments: { name: '@encode-ui/alpha-button' },
  })
  assert.deepEqual(scoped.structuredContent, bare.structuredContent)
})

// ── find_icons ───────────────────────────────────────────────────────────────

test('find_icons searches by concept and verifies spellings', async () => {
  const q = await client.callTool({ name: 'find_icons', arguments: { query: 'shopping cart' } })
  const out = FindIconsOutput.parse(q.structuredContent)
  assert.ok(out.icons.some((i) => i.name === 'shopping-cart'))
  assert.match(out.usage ?? '', /from 'lucide-react'/)
  assert.match(out.lucideVersion, /^\d+\.\d+\.\d+$/)

  const v = await client.callTool({
    name: 'find_icons',
    arguments: { names: ['Home', 'AreaChart'] },
  })
  const ver = FindIconsOutput.parse(v.structuredContent)
  const house = ver.icons.find((i) => i.name === 'house')
  assert.ok(house, 'Home did not verify to house')
  assert.equal(house.resolvedFrom, 'home')
  assert.equal(ver.unknown.length, 0)
  const text = (v.content as { text: string }[])[0]!.text
  assert.match(text, /"home" is an alias — import House/)
  assert.match(text, /"area-chart" is a deprecated alias — import ChartArea/)
})
