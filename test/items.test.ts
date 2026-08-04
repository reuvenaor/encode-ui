import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import {
  ITEM_DETAIL_PROJECTION,
  ITEM_SUMMARY_PROJECTION,
  MAX_CHUNKS_PER_ITEM,
  fetchDetail,
  fetchSummaries,
  itemColumns,
  itemFilterSql,
  jsonStringList,
  listGroupRows,
  toSearchHit,
} from '../src/items.ts'
import { orderGroups } from '../src/engine.ts'
import { buildFixtureIndex } from './fixtures/index-fixture.ts'
import type { ItemSummaryRow } from '../src/items.ts'

const db = buildFixtureIndex([
  { name: 'alpha-button', group: 'buttons', motion: true },
  { name: 'beta-input', group: 'forms' },
  { name: 'gamma-card', group: 'cards', type: 'registry:lib' },
  { name: 'use-mobile', group: null, type: 'registry:hook' },
])

after(() => {
  db.close()
})

// ── the check `satisfies` cannot make: alias → REAL column ───────────────────

test('every projected column exists in the items table', () => {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map((c) => c.name),
  )
  for (const projection of [ITEM_SUMMARY_PROJECTION, ITEM_DETAIL_PROJECTION]) {
    for (const [alias, column] of Object.entries(projection)) {
      assert.ok(columns.has(column), `projection alias "${alias}" → missing column "${column}"`)
    }
  }
})

test('the detail projection is a superset of the summary projection', () => {
  for (const [alias, column] of Object.entries(ITEM_SUMMARY_PROJECTION)) {
    assert.equal(
      (ITEM_DETAIL_PROJECTION as Record<string, string>)[alias],
      column,
      `detail projection disagrees with summary on "${alias}"`,
    )
  }
})

test('itemColumns emits aliased, qualified columns', () => {
  assert.equal(
    itemColumns({ grp: 'group_slug', motion: 'motion' }),
    'i.group_slug AS grp, i.motion AS motion',
  )
  assert.equal(itemColumns({ name: 'name' }, 'x'), 'x.name AS name')
})

test('MAX_CHUNKS_PER_ITEM matches the facets schema.sql permits', () => {
  // The CHECK constraint is what makes k × this a provable lower bound on items.
  const ddl = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chunks'").get() as {
      sql: string
    }
  ).sql
  const facets = [...ddl.matchAll(/'(doc|code|demo)'/g)].map((m) => m[1])
  assert.equal(new Set(facets).size, MAX_CHUNKS_PER_ITEM)
})

// ── mapping ──────────────────────────────────────────────────────────────────

test('toSearchHit converts motion, passes through nulls, rounds the score', () => {
  const row: ItemSummaryRow = {
    name: 'x',
    title: 'X',
    description: 'd',
    grp: null,
    type: 'registry:ui',
    installCmd: 'cmd',
    docUrl: 'url',
    provenance: null,
    motion: 1,
  }
  const hit = toSearchHit(row, 0.1234567891, ['doc:semantic'], null, false)
  assert.equal(hit.motion, true)
  assert.equal(hit.group, null)
  assert.equal(hit.provenance, null)
  assert.equal(hit.score, 0.123457, '6dp, matching the previous inline mappers')
  assert.deepEqual(hit.matchedOn, ['doc:semantic'])

  assert.equal(toSearchHit({ ...row, motion: 0 }, 1, [], null, false).motion, false)
})

test('toSearchHit copies matchedOn rather than aliasing it', () => {
  const facets = ['doc:semantic']
  const hit = toSearchHit(
    {
      name: 'x',
      title: 'X',
      description: '',
      grp: null,
      type: 't',
      installCmd: '',
      docUrl: '',
      provenance: null,
      motion: 0,
    },
    0,
    facets,
    null,
    false,
  )
  facets.push('code:lexical')
  assert.deepEqual(hit.matchedOn, ['doc:semantic'])
})

test('jsonStringList degrades instead of throwing', () => {
  assert.deepEqual(jsonStringList('["a","b"]'), ['a', 'b'])
  assert.deepEqual(jsonStringList('[]'), [])
  assert.deepEqual(jsonStringList('[1,2,"c"]'), ['c'], 'non-strings are dropped')
  assert.deepEqual(jsonStringList('null'), [])
  assert.deepEqual(jsonStringList('{}'), [])
  assert.deepEqual(jsonStringList('not json'), [], 'a corrupt column must not kill a tool call')
  assert.deepEqual(jsonStringList(''), [])
  assert.deepEqual(jsonStringList(undefined), [])
  assert.deepEqual(jsonStringList(42), [])
})

// ── filtering ────────────────────────────────────────────────────────────────

test('itemFilterSql keeps placeholders and params in step', () => {
  const combos = [
    {},
    { group: 'forms' },
    { type: 'registry:ui' },
    { motion: true },
    { group: 'forms', type: 'registry:ui' },
    { group: 'forms', motion: false },
    { type: 'registry:ui', motion: true },
    { group: 'forms', type: 'registry:ui', motion: true },
  ]
  for (const f of combos) {
    const { sql, params } = itemFilterSql(f)
    assert.equal(
      (sql.match(/\?/g) ?? []).length,
      params.length,
      `placeholder/param mismatch for ${JSON.stringify(f)}`,
    )
    // Every fragment must be AND-prefixed so it can be appended to a WHERE clause.
    if (params.length > 0) assert.ok(sql.startsWith(' AND '), sql)
    else assert.equal(sql, '')
  }
})

test('itemFilterSql binds motion as an integer, including false', () => {
  assert.deepEqual(itemFilterSql({ motion: false }).params, [0])
  assert.deepEqual(itemFilterSql({ motion: true }).params, [1])
})

test('itemFilterSql fragments actually run against the schema', () => {
  const { sql, params } = itemFilterSql({ group: 'forms', motion: false })
  const rows = db.prepare(`SELECT i.name FROM items i WHERE 1 = 1${sql}`).all(...params) as {
    name: string
  }[]
  assert.deepEqual(
    rows.map((r) => r.name),
    ['beta-input'],
  )
})

// ── queries ──────────────────────────────────────────────────────────────────

test('fetchSummaries returns one row per known name, keyed by name', () => {
  const rows = fetchSummaries(db, ['gamma-card', 'alpha-button', 'nope'])
  assert.deepEqual([...rows.keys()].sort(), ['alpha-button', 'gamma-card'])
  assert.equal(rows.get('alpha-button')?.motion, 1)
  assert.equal(rows.get('gamma-card')?.type, 'registry:lib')
  assert.equal(rows.get('use-mobile'), undefined)
})

test('fetchSummaries handles the empty set without touching the database', () => {
  assert.equal(fetchSummaries(db, []).size, 0)
})

test('fetchSummaries selects exactly the summary aliases', () => {
  const row = fetchSummaries(db, ['alpha-button']).get('alpha-button')
  assert.ok(row)
  assert.deepEqual(Object.keys(row).sort(), Object.keys(ITEM_SUMMARY_PROJECTION).sort())
})

test('fetchDetail selects exactly the detail aliases, and misses are undefined', () => {
  const row = fetchDetail(db, 'alpha-button')
  assert.ok(row)
  assert.deepEqual(Object.keys(row).sort(), Object.keys(ITEM_DETAIL_PROJECTION).sort())
  assert.deepEqual(jsonStringList(row.registryDeps), ['@encode-ui/utils'])
  assert.equal(fetchDetail(db, 'nope'), undefined)
})

test('an ungrouped item round-trips a null group', () => {
  const row = fetchDetail(db, 'use-mobile')
  assert.ok(row)
  assert.equal(row.grp, null)
  assert.equal(toSearchHit(row, 0, [], null, false).group, null)
})

test('group order breaks count ties by slug — identical to orderGroups', () => {
  // Two one-item groups: without the slug tie-break SQLite's GROUP BY order
  // decides, which need not match the catalog engine's orderGroups — the two
  // engines would present the same taxonomy in different orders.
  const tied = buildFixtureIndex([
    { name: 'z-item', group: 'zebra' },
    { name: 'a-item', group: 'apple' },
  ])
  const rows = listGroupRows(tied)
  assert.deepEqual(
    rows.map((r) => r.slug),
    ['apple', 'zebra'],
  )
  assert.deepEqual(rows, orderGroups(rows.map((r) => ({ ...r, isTheme: false }))))
  tied.close()
})
