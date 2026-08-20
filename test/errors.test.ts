import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadIconCatalog } from '../src/icons.ts'
import { loadAnchors } from '../src/theme-anchors.ts'
import { suggestNames } from '../src/items.ts'
import { ToolError, guarded } from '../src/mcp/result.ts'
import { loadCatalog } from '../src/catalog.ts'
import { createDbEngineFromDb } from '../src/engine-db.ts'
import { buildRegistryServer } from '../src/mcp/server.ts'
import { buildFixtureIndex, FIXTURE_ID } from './fixtures/index-fixture.ts'

before(() => {
  process.env.ENCODE_UI_RAG_LEXICAL_ONLY = '1'
})

const db = buildFixtureIndex([
  { name: 'magnetic-button', group: 'buttons', keywords: 'widget' },
  { name: 'button', group: 'buttons', keywords: 'widget' },
  { name: 'password-input', group: 'forms', keywords: 'widget' },
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
const client = new Client({ name: 'errors-test', version: '0' })
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

after(async () => {
  await client.close()
  await server.close()
  db.close()
})

interface Called {
  isError: boolean
  text: string
}

const call = async (name: string, args: Record<string, unknown>): Promise<Called> => {
  const r = await client.callTool({ name, arguments: args })
  const first = (r.content as { type: string; text?: string }[])[0]
  return { isError: Boolean(r.isError), text: first?.text ?? '' }
}

// ── guarded() ────────────────────────────────────────────────────────────────

test('guarded passes a ToolError through untouched', async () => {
  await assert.rejects(
    guarded('t', 'db', () => {
      throw new ToolError('written for the model')
    }),
    (err: Error) => {
      assert.ok(err instanceof ToolError)
      assert.equal(err.message, 'written for the model')
      return true
    },
  )
})

test("guarded replaces an unexpected error with the ENGINE'S OWN remedy", async () => {
  const boom = (): never => {
    throw new Error('SQLITE_ERROR: no such column: /Users/someone/index.db')
  }
  await assert.rejects(guarded('t', 'db', boom), (err: Error) => {
    assert.ok(err instanceof ToolError)
    assert.ok(!err.message.includes('SQLITE_ERROR'), 'internals must not reach the model')
    assert.ok(!err.message.includes('/Users/'), 'paths must not reach the model')
    assert.match(err.message, /npm run verify/, 'db remedy inspects the index')
    return true
  })
  // The catalog engine has no index.db to verify — its fixable input is the
  // bundled artifact, so its remedy is refreshing the package that carries it.
  await assert.rejects(guarded('t', 'catalog', boom), (err: Error) => {
    assert.ok(err instanceof ToolError)
    assert.ok(!err.message.includes('npm run verify'), 'verify is db-only advice')
    assert.match(err.message, /ships with the package/, 'catalog remedy refreshes the artifact')
    return true
  })
  // The web engine's fixable input is connectivity, not a local artifact.
  await assert.rejects(guarded('t', 'web', boom), (err: Error) => {
    assert.ok(err instanceof ToolError)
    assert.ok(!err.message.includes('npm run verify'), 'verify is db-only advice')
    assert.ok(!err.message.includes('ships with the package'), 'bundled-artifact advice is catalog-only')
    assert.match(err.message, /network/, 'web remedy points at connectivity')
    assert.match(err.message, /--registry-url/, 'and names the override flag')
    assert.ok(!err.message.includes('/Users/'), 'paths must not reach the model')
    return true
  })
})

test('guarded returns the value on the happy path', async () => {
  assert.equal(await guarded('t', 'db', () => 42), 42)
  assert.equal(await guarded('t', 'catalog', () => Promise.resolve('x')), 'x')
})

// ── suggestions ──────────────────────────────────────────────────────────────

test('suggestNames finds the near miss', () => {
  assert.ok(suggestNames(db, 'magnetic-btn').includes('magnetic-button'))
  assert.ok(suggestNames(db, 'passwordinput').includes('password-input'))
  assert.deepEqual(suggestNames(db, 'zzzzzzzzzzzzzzzz'), [], 'no padding with nonsense')
})

// ── wrong question vs no answer ──────────────────────────────────────────────

test('a search matching nothing is a valid answer, not an error', async () => {
  const r = await call('search_components', { query: 'nothing-at-all-like-this' })
  assert.equal(r.isError, false, 'the registry genuinely having nothing is an answer')
})

test('an unknown group is an error that lists the valid slugs', async () => {
  const r = await call('search_components', { query: 'widget', group: 'form' })
  assert.equal(r.isError, true, 'the registry HAS matches; the filter was wrong')
  assert.match(r.text, /Unknown group "form"/)
  assert.match(r.text, /buttons/)
  assert.match(r.text, /forms/)
})

test('list_components rejects an unknown slug exactly like search does', async () => {
  const r = await call('list_components', { group: 'form' })
  assert.equal(r.isError, true)
  assert.match(r.text, /Unknown group "form"/)
  assert.match(r.text, /forms/)
})

test('an unknown component name suggests the closest', async () => {
  for (const tool of ['get_component', 'find_similar', 'get_component_source']) {
    const r = await call(tool, { name: 'magnetic-btn' })
    assert.equal(r.isError, true, `${tool} should reject an unknown name`)
    assert.match(r.text, /magnetic-button/, `${tool} should suggest the near miss`)
  }
})

test('a missing part points at the one that exists', async () => {
  const r = await call('get_component_source', { name: 'button', part: 'demo' })
  assert.equal(r.isError, true)
  assert.match(r.text, /has no demo/)
  assert.match(r.text, /part:"source"/)
})

test('get_install_command reports partial success, and fails only when nothing resolves', async () => {
  const partial = await call('get_install_command', { names: ['button', 'nope'] })
  assert.equal(partial.isError, false, 'some names resolved — that is success')
  assert.match(partial.text, /Unknown: nope/)

  const none = await call('get_install_command', { names: ['nope', 'also-nope'] })
  assert.equal(none.isError, true)
  assert.ok(
    !none.text.includes('nothing to install'),
    'a successful result whose payload is a parenthetical is the worst outcome',
  )
  assert.match(none.text, /search_components/)
})

test('duplicates collapse rather than repeating in the command', async () => {
  const r = await call('get_install_command', { names: ['button', 'button', '@encode-ui/button'] })
  assert.equal(r.isError, false)
  assert.equal(r.text.match(/@encode-ui\/button/g)?.length, 1)
})

// ── the leak guard, mechanised ───────────────────────────────────────────────

test('no error message leaks a path, a stack, or a driver code', async () => {
  const failures = await Promise.all([
    call('search_components', { query: 'widget', group: 'nope' }),
    call('list_components', { group: 'nope' }),
    call('get_component', { name: 'nope' }),
    call('find_similar', { name: 'nope' }),
    call('get_component_source', { name: 'nope' }),
    call('get_component_source', { name: 'button', part: 'demo' }),
    call('get_install_command', { names: ['nope'] }),
    call('find_icons', { names: ['nope-not-real'] }),
    call('find_icons', { query: 'house', category: 'nope' }),
  ])
  for (const f of failures) {
    assert.equal(f.isError, true)
    assert.doesNotMatch(f.text, /\/(Users|home|var|tmp|private)\//, 'absolute path leaked')
    assert.doesNotMatch(f.text, /index\.db/, 'index filename leaked')
    assert.doesNotMatch(f.text, /SQLITE_|better-sqlite3/, 'driver internals leaked')
    assert.doesNotMatch(f.text, /\bat .*\(.*:\d+:\d+\)/, 'stack frame leaked')
  }
})

// ── find_icons failure shapes ────────────────────────────────────────────────

test('find_icons with no mode argument is a schema rejection', async () => {
  const r = await call('find_icons', {})
  assert.equal(r.isError, true)
  assert.match(r.text, /at least one of query, names, or category/i)
})

test('all-unknown icon names fail; a mixed set partially succeeds', async () => {
  const all = await call('find_icons', { names: ['definitely-not-real-xyz'] })
  assert.equal(all.isError, true)
  assert.match(all.text, /No lucide icon named/)

  const mixed = await call('find_icons', { names: ['house', 'definitely-not-real-xyz'] })
  assert.equal(mixed.isError, false)
  assert.match(mixed.text, /house \(House\)/)
  assert.match(mixed.text, /unknown: "definitely-not-real-xyz"/)
})
