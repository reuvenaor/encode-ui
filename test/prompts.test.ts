// The two MCP prompts, round-tripped through a real client. The length budgets
// are the point: prompts are the on-demand half of the context-lift split, and
// unbounded growth here would quietly become the always-loaded problem again.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadIconCatalog } from '../src/icons.ts'
import { loadCatalog } from '../src/catalog.ts'
import { createDbEngineFromDb } from '../src/engine-db.ts'
import { buildRegistryServer } from '../src/mcp/server.ts'
import { buildFixtureIndex, FIXTURE_ID } from './fixtures/index-fixture.ts'

before(() => {
  process.env.ENCODE_UI_RAG_LEXICAL_ONLY = '1'
})

const db = buildFixtureIndex([{ name: 'alpha-button', group: 'buttons', keywords: 'widget' }])
const server = buildRegistryServer({
  engine: createDbEngineFromDb(db),
  identity: FIXTURE_ID,
  icons: loadIconCatalog(),
  catalog: loadCatalog(),
  catalogSync: 'in-sync',
})
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'prompts-test', version: '0' })
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

after(async () => {
  await client.close()
  await server.close()
  db.close()
})

/** ~1,000 tokens at 4 chars/token — creep past this fails loud, by design. */
const LENGTH_BUDGET = 4000

/**
 * Hosts always send an `arguments` object (empty when the user filled nothing);
 * the SDK rejects a fully-absent one once an argsSchema is declared, so the
 * helper mirrors host behaviour rather than the spec's laxest reading.
 */
const promptText = async (name: string, args: Record<string, string> = {}): Promise<string> => {
  const r = await client.getPrompt({ name, arguments: args })
  const first = r.messages[0]
  assert.ok(first?.role === 'user')
  assert.equal(first.content.type, 'text')
  return (first.content as { text: string }).text
}

test('the server advertises exactly the two prompts, with optional string args', async () => {
  const { prompts } = await client.listPrompts()
  assert.deepEqual(prompts.map((p) => p.name).sort(), ['setup-project', 'use-registry'])
  for (const p of prompts) {
    assert.ok(p.title && p.title.length > 0, `${p.name} title`)
    assert.ok((p.description ?? '').length > 30, `${p.name} description`)
    for (const arg of p.arguments ?? []) {
      assert.equal(arg.required ?? false, false, `${p.name}.${arg.name} must stay optional`)
    }
  }
})

test('use-registry carries the workflow, the census, and the icon rule', async () => {
  const text = await promptText('use-registry')
  for (const needle of [
    'search_components',
    'list_components',
    'get_install_command',
    'find_icons',
    'lucide-react',
    'dependencyFree: true',
    'degraded',
    `@${FIXTURE_ID.scope}/`,
  ]) {
    assert.ok(text.includes(needle), `use-registry is missing "${needle}"`)
  }
  assert.ok(text.length < LENGTH_BUDGET, `use-registry grew to ${text.length} chars`)
})

test('use-registry applies a goal argument when given', async () => {
  const text = await promptText('use-registry', { goal: 'a pricing page with a comparison table' })
  assert.match(text, /Current goal: a pricing page with a comparison table/)
})

test('setup-project interpolates the identity into the registries snippet', async () => {
  const text = await promptText('setup-project', { project: 'Vite React SPA' })
  assert.match(text, /Project context: Vite React SPA/)
  assert.ok(
    text.includes(`"@${FIXTURE_ID.scope}": "${FIXTURE_ID.homepage}/r/{name}.json"`),
    'the components.json snippet must come from the identity, not a hardcoded domain',
  )
  assert.match(text, /tw-animate-css/)
  assert.match(text, /find_icons/)
  assert.ok(text.length < LENGTH_BUDGET, `setup-project grew to ${text.length} chars`)
})
