import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { DEFAULT_K, MAX_K, search } from '../src/search.ts'
import {
  buildComponentsOutput,
  buildGroupsOutput,
  buildInstallOutput,
  buildSearchOutput,
  buildSimilarOutput,
} from '../src/mcp/build.ts'
import {
  FindSimilarOutput,
  GetInstallCommandInput,
  GetInstallCommandOutput,
  Hit,
  ListComponentsOutput,
  ListGroupsOutput,
  SearchComponentsInput,
  SearchComponentsOutput,
} from '../src/mcp/schemas.ts'
import { renderGroups, renderInstall, renderSearch, renderSimilar } from '../src/mcp/render.ts'
import { buildFixtureIndex, FIXTURE_ID } from './fixtures/index-fixture.ts'

before(() => {
  process.env.ENCODE_UI_RAG_LEXICAL_ONLY = '1'
})

// The gated set the builders annotate hits from. `alpha-button` stands in for a
// gated item so the flag has both values in one file.
const GATED: ReadonlySet<string> = new Set(['alpha-button'])

const db = buildFixtureIndex([
  { name: 'alpha-button', group: 'buttons', motion: true, keywords: 'widget' },
  { name: 'beta-input', group: 'forms', keywords: 'widget' },
])
after(() => {
  db.close()
})

// ── the drift guard ──────────────────────────────────────────────────────────

test('every SearchHit field is represented in the Hit schema', async () => {
  // The builders copy fields explicitly rather than spreading, so a new field on
  // SearchHit would be silently dropped from the payload instead of failing.
  // This is what turns that omission into a red test.
  const { hits } = await search(db, 'widget', { k: 1 })
  const hit = hits[0]
  assert.ok(hit)
  const declared = new Set(Object.keys(Hit.shape))
  for (const key of Object.keys(hit)) {
    assert.ok(declared.has(key), `SearchHit.${key} is missing from the Hit schema`)
  }
})

test('built payloads satisfy their declared schemas', async () => {
  const { hits, degraded } = await search(db, 'widget', { k: 2 })

  assert.doesNotThrow(() =>
    SearchComponentsOutput.parse(buildSearchOutput('db', 'widget', hits, degraded, GATED)),
  )
  assert.doesNotThrow(() => FindSimilarOutput.parse(buildSimilarOutput('db', 'alpha-button', hits, GATED)))
  assert.doesNotThrow(() =>
    ListGroupsOutput.parse(buildGroupsOutput('db', [{ slug: 'forms', label: 'Forms', count: 31 }])),
  )
  assert.doesNotThrow(() =>
    GetInstallCommandOutput.parse(
      buildInstallOutput(FIXTURE_ID, 'npx shadcn@latest add @encode-ui/x', ['x'], ['y']),
    ),
  )
})

test('scoreKind distinguishes a fusion rank from a cosine similarity', async () => {
  const { hits } = await search(db, 'widget', { k: 1 })
  assert.equal(buildSearchOutput('db', 'widget', hits, false, GATED).hits[0]?.scoreKind, 'rrf')
  assert.equal(buildSimilarOutput('db', 'alpha-button', hits, GATED).neighbours[0]?.scoreKind, 'cosine')
})

test('counts agree with the arrays they describe', async () => {
  const { hits } = await search(db, 'widget', { k: 2 })
  const s = buildSearchOutput('db', 'widget', hits, false, GATED)
  assert.equal(s.count, s.hits.length)
  const n = buildSimilarOutput('db', 'alpha-button', hits, GATED)
  assert.equal(n.count, n.neighbours.length)
  const g = buildGroupsOutput('db', [
    { slug: 'forms', label: 'Forms', count: 31 },
    { slug: 'cards', label: 'Cards', count: 10 },
  ])
  assert.equal(g.totalItems, 41)
})

// ── input contracts ──────────────────────────────────────────────────────────

test('k defaults to 8 and is capped at 25', () => {
  assert.equal(SearchComponentsInput.parse({ query: 'x' }).k, DEFAULT_K)
  assert.equal(SearchComponentsInput.parse({ query: 'x', k: MAX_K }).k, MAX_K)
  assert.throws(() => SearchComponentsInput.parse({ query: 'x', k: MAX_K + 1 }))
  assert.throws(() => SearchComponentsInput.parse({ query: 'x', k: 0 }))
  assert.throws(() => SearchComponentsInput.parse({ query: 'x', k: 1.5 }))
})

test('inputs reject an unknown argument rather than dropping it', () => {
  // Passing the whole .strict() object to registerTool is what buys this; the
  // raw .shape would let Zod 4's default strip swallow a typo'd argument.
  assert.throws(() => SearchComponentsInput.parse({ query: 'x', gruop: 'forms' }), /Unrecognized/)
  assert.throws(() => GetInstallCommandInput.parse({ names: ['a'], extra: 1 }), /Unrecognized/)
})

test('an empty query and an empty name list are rejected', () => {
  assert.throws(() => SearchComponentsInput.parse({ query: '' }))
  assert.throws(() => GetInstallCommandInput.parse({ names: [] }))
})

// ── channel parity: prose must not omit what the payload promises ────────────

test('rendered prose names every hit and its install command', async () => {
  const { hits } = await search(db, 'widget', { k: 2 })
  const out = buildSearchOutput('db', 'widget', hits, false, GATED)
  const text = renderSearch(FIXTURE_ID, out)
  for (const h of out.hits) {
    assert.ok(text.includes(h.name), `${h.name} missing from the rendered text`)
    assert.ok(text.includes(h.installCmd), `install command for ${h.name} missing`)
  }
})

test('an empty result set reads as an answer, not an error', () => {
  const out = buildSearchOutput('db', 'nothing-matches-this', [], false, GATED)
  const text = renderSearch(FIXTURE_ID, out)
  assert.match(text, /No components match/)
  assert.equal(out.count, 0)
})

test('degraded mode is disclosed in the prose as well as the payload', async () => {
  const { hits, degraded } = await search(db, 'widget', { k: 1 })
  assert.equal(degraded, true)
  assert.match(
    renderSearch(FIXTURE_ID, buildSearchOutput('db', 'widget', hits, degraded, GATED)),
    /degraded/,
  )
})

test('renderers surface the aggregate fields their payload carries', () => {
  const groups = renderGroups(
    buildGroupsOutput('db', [
      { slug: 'forms', label: 'Forms', count: 31 },
      { slug: 'cards', label: 'Cards', count: 10 },
    ]),
  )
  assert.match(groups, /forms\s+31\s+Forms/)
  assert.match(groups, /2 groups · 41 components/)

  const install = renderInstall(
    buildInstallOutput(FIXTURE_ID, 'npx shadcn@latest add @encode-ui/a', ['a'], ['b']),
  )
  assert.match(install, /Unknown: b/)
  assert.ok(!renderInstall(buildInstallOutput(FIXTURE_ID, 'cmd', ['a'], [])).includes('Unknown'))
})

test('find_similar prose names the seed it resolved', async () => {
  const { hits } = await search(db, 'widget', { k: 1 })
  const text = renderSimilar(FIXTURE_ID, buildSimilarOutput('db', 'alpha-button', hits, GATED))
  assert.match(text, /@encode-ui\/alpha-button/)
})

test('the catalog engine stamps lexical scores and its engine field', async () => {
  const { hits } = await search(db, 'widget', { k: 1 })

  const s = buildSearchOutput('catalog', 'widget', hits, false, GATED)
  assert.equal(s.engine, 'catalog')
  assert.equal(s.hits[0]?.scoreKind, 'lexical')
  assert.doesNotThrow(() => SearchComponentsOutput.parse(s))

  const n = buildSimilarOutput('catalog', 'alpha-button', hits, GATED)
  assert.equal(n.engine, 'catalog')
  assert.equal(n.neighbours[0]?.scoreKind, 'lexical')
  assert.doesNotThrow(() => FindSimilarOutput.parse(n))

  const g = buildGroupsOutput('catalog', [{ slug: 'forms', label: 'Forms', count: 1 }])
  assert.equal(g.engine, 'catalog')
  assert.doesNotThrow(() => ListGroupsOutput.parse(g))

  const c = buildComponentsOutput('catalog', 'forms', [])
  assert.equal(c.engine, 'catalog')
  assert.doesNotThrow(() => ListComponentsOutput.parse(c))

  // The prose discloses the engine as a mode, never as a fault.
  const text = renderSearch(FIXTURE_ID, s)
  assert.match(text, /catalog engine/)
  assert.ok(!text.includes('degraded'), 'catalog mode must not read as an apology')

  // find_similar's text channel too: its "Nearest to" framing would otherwise
  // pass structural overlap off as embedding neighbours on a host that
  // renders only content[0].text.
  const similarText = renderSimilar(FIXTURE_ID, n)
  assert.match(similarText, /structural overlap/)
  assert.match(similarText, /not embedding similarity/)
  assert.ok(
    !renderSimilar(FIXTURE_ID, buildSimilarOutput('db', 'alpha-button', hits, GATED)).includes(
      'structural overlap',
    ),
    'db neighbours carry no catalog note',
  )
})

test('the web engine stamps lexical scores and discloses itself in the prose', async () => {
  const { hits } = await search(db, 'widget', { k: 1 })

  const s = buildSearchOutput('web', 'widget', hits, false, GATED)
  assert.equal(s.engine, 'web')
  assert.equal(s.hits[0]?.scoreKind, 'lexical')
  assert.doesNotThrow(() => SearchComponentsOutput.parse(s))

  const n = buildSimilarOutput('web', 'alpha-button', hits, GATED)
  assert.equal(n.engine, 'web')
  assert.equal(n.neighbours[0]?.scoreKind, 'lexical')
  assert.doesNotThrow(() => FindSimilarOutput.parse(n))

  // The prose steers discovery to the catalog resource — the web engine's
  // search is a plain filter, and a host that renders only content[0].text
  // must still learn that.
  const text = renderSearch(FIXTURE_ID, s)
  assert.match(text, /web engine/)
  assert.match(text, /encode-ui:\/\/catalog/)
  assert.ok(!text.includes('degraded'), 'web mode must not read as an apology')
  assert.ok(!text.includes('catalog engine'), 'web results carry the web note, not the catalog one')

  const similarText = renderSimilar(FIXTURE_ID, n)
  assert.match(similarText, /structural overlap/)
  assert.match(similarText, /not embedding similarity/)
})
