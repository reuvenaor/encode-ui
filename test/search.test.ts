import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { knnCeiling } from '../src/db.ts'
import {
  MAX_K,
  RRF_K,
  WEIGHT_DENSE,
  WEIGHT_LEXICAL,
  findSimilar,
  fuse,
  lexicalArm,
  search,
  toFtsQuery,
} from '../src/search.ts'
import { buildFixtureIndex } from './fixtures/index-fixture.ts'
import type { DB } from '../src/db.ts'
import type { Ranked } from '../src/search.ts'

// The dense arm needs the model; the lexical arm does not. Every case below runs
// lexical-only so the suite stays offline and deterministic — the defect under
// test (filters applied after fusion, over a pool sized in chunks) is arm-agnostic.
before(() => {
  process.env.ENCODE_UI_RAG_LEXICAL_ONLY = '1'
})

// 30 items per group, all sharing a keyword so one query matches every one of them.
const GROUPS = ['forms', 'buttons', 'cards'] as const
const db: DB = buildFixtureIndex(
  GROUPS.flatMap((group, g) =>
    Array.from({ length: 30 }, (_, i) => ({
      name: `${group}-${String(i).padStart(2, '0')}`,
      group,
      motion: i % 2 === 0,
      type: g === 2 ? 'registry:lib' : 'registry:ui',
      keywords: 'widget gadget thing',
    })),
  ),
)

after(() => {
  db.close()
})

test('toFtsQuery reduces user text to safe quoted terms', () => {
  assert.equal(toFtsQuery('magnetic button'), '"magnetic" OR "button"')
  assert.equal(toFtsQuery('magnetic-button'), '"magnetic" OR "button"', 'hyphens split')
  assert.equal(toFtsQuery('a button'), '"button"', 'single-char terms are dropped')
  assert.equal(toFtsQuery('button button'), '"button"', 'deduped')
  assert.equal(toFtsQuery(''), '')
  assert.equal(toFtsQuery('!!! ???'), '')
  // FTS5 MATCH is a query language: these would throw or change meaning unquoted.
  assert.equal(toFtsQuery('say "hi"'), '"say" OR "hi"')
  assert.equal(toFtsQuery('a AND b OR c'), '"and" OR "or"')
  assert.equal(toFtsQuery('x NEAR y'), '"near"')
  assert.equal(toFtsQuery('foo*'), '"foo"')
  assert.equal(toFtsQuery('^foo'), '"foo"')
})

test('knnCeiling is bounded by the corpus and by vec0', () => {
  assert.equal(knnCeiling(db), 90, 'one doc chunk per item')
})

// ── fusion ───────────────────────────────────────────────────────────────────

test('the swept fusion constants are what shipped', () => {
  // Swept over 52 labeled queries. Textbook RRF (k=60, equal weights) scores
  // WORSE than dense alone here — 0.870 vs 0.925 MRR — because the code and demo
  // facets already carry exact names. Do not "correct" these to the canonical
  // values without re-running eval/sweep.ts.
  assert.equal(RRF_K, 10)
  assert.equal(WEIGHT_DENSE, 1)
  assert.equal(WEIGHT_LEXICAL, 0.25)
})

test('fuse scores by RANK, not by any score the arms carried', () => {
  // The reference implementation fused by raw score and stamped every keyword
  // hit with similarity 1.0, so lexical silently outranked every vector hit.
  // Ranks have no scale to reconcile, which is why that cannot happen here.
  const rows = (names: string[]): Ranked[] =>
    names.map((itemName, i) => ({ chunkId: i, itemName, facet: 'doc' }))

  const fused = fuse([{ label: 'semantic', weight: WEIGHT_DENSE, rows: rows(['a', 'b', 'c']) }])
  assert.equal(fused.get('a')?.score, WEIGHT_DENSE / (RRF_K + 1))
  assert.equal(fused.get('b')?.score, WEIGHT_DENSE / (RRF_K + 2))
  assert.ok(fused.get('a')!.score > fused.get('c')!.score)
})

test('fuse accumulates an item across its facets and both arms', () => {
  const fused = fuse([
    {
      label: 'semantic',
      weight: WEIGHT_DENSE,
      rows: [
        { chunkId: 1, itemName: 'x', facet: 'doc' },
        { chunkId: 2, itemName: 'x', facet: 'code' },
      ],
    },
    {
      label: 'lexical',
      weight: WEIGHT_LEXICAL,
      rows: [{ chunkId: 3, itemName: 'x', facet: 'doc' }],
    },
  ])
  const entry = fused.get('x')
  assert.ok(entry)
  // An item matching on several facets IS stronger evidence, so the scores add.
  assert.equal(
    entry.score,
    WEIGHT_DENSE / (RRF_K + 1) + WEIGHT_DENSE / (RRF_K + 2) + WEIGHT_LEXICAL / (RRF_K + 1),
  )
  assert.deepEqual([...entry.facets].sort(), ['code:semantic', 'doc:lexical', 'doc:semantic'])
})

test('fuse of nothing is empty', () => {
  assert.equal(fuse([]).size, 0)
  assert.equal(fuse([{ label: 'lexical', weight: 1, rows: [] }]).size, 0)
})

test('fuse takes rrfK as a parameter, so the sweep runs the real fusion', () => {
  const rows: Ranked[] = [{ chunkId: 1, itemName: 'a', facet: 'doc' }]
  assert.equal(fuse([{ label: 'semantic', weight: 1, rows }]).get('a')?.score, 1 / (RRF_K + 1))
  assert.equal(fuse([{ label: 'semantic', weight: 1, rows }], 60).get('a')?.score, 1 / 61)
})

test('lexicalArm is exported for the sweep and honours nameBoost', () => {
  // The boost only reorders (name column vs text column); the row shape and the
  // filter contract must be identical to what search() itself consumes.
  const rows = lexicalArm(db, 'widget', 10, undefined, {}, 3.0)
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => typeof r.chunkId === 'number' && r.facet === 'doc'))
  const filtered = lexicalArm(db, 'widget', 10, undefined, { group: 'forms' }, 3.0)
  assert.ok(filtered.length > 0)
  assert.ok(filtered.every((r) => r.itemName.startsWith('forms-')))
})

test('fuse tracks the smallest dense distance per item, null without one', () => {
  const fused = fuse([
    {
      label: 'semantic',
      weight: WEIGHT_DENSE,
      rows: [
        { chunkId: 1, itemName: 'x', facet: 'doc', distance: 0.5 },
        { chunkId: 2, itemName: 'x', facet: 'code', distance: 0.3 },
      ],
    },
    {
      label: 'lexical',
      weight: WEIGHT_LEXICAL,
      rows: [{ chunkId: 3, itemName: 'x', facet: 'doc' }],
    },
  ])
  assert.equal(fused.get('x')?.minDistance, 0.3, 'smallest dense distance wins')

  const lexOnly = fuse([
    { label: 'lexical', weight: 1, rows: [{ chunkId: 1, itemName: 'y', facet: 'doc' }] },
  ])
  assert.equal(lexOnly.get('y')?.minDistance, null, 'lexical rows carry no distance')
})

// ── the defect this commit exists for ────────────────────────────────────────

test('a group filter returns k items, not k minus whatever fusion dropped', async () => {
  const { hits } = await search(db, 'widget', { group: 'forms', k: 25 })
  assert.equal(hits.length, 25, 'forms holds 30 matching items, so 25 must be reachable')
  assert.ok(
    hits.every((h) => h.group === 'forms'),
    'every hit belongs to the requested group',
  )
  assert.equal(new Set(hits.map((h) => h.name)).size, 25, 'no duplicates')
})

test('a type filter behaves the same way', async () => {
  const { hits } = await search(db, 'widget', { type: 'registry:lib', k: MAX_K })
  assert.equal(hits.length, 25)
  assert.ok(hits.every((h) => h.type === 'registry:lib'))
})

test('a motion filter matches on both true and false', async () => {
  const animated = await search(db, 'widget', { motion: true, k: MAX_K })
  assert.equal(animated.hits.length, 25)
  assert.ok(animated.hits.every((h) => h.motion))

  const still = await search(db, 'widget', { motion: false, k: MAX_K })
  assert.equal(still.hits.length, 25)
  assert.ok(still.hits.every((h) => !h.motion))
})

test('filters compose', async () => {
  const { hits } = await search(db, 'widget', { group: 'forms', motion: true, k: MAX_K })
  assert.equal(hits.length, 15, 'forms has 30 items, half of them animated')
  assert.ok(hits.every((h) => h.group === 'forms' && h.motion))
})

test('returning fewer than k means the index really has fewer', async () => {
  const small = buildFixtureIndex([
    { name: 'only-one', group: 'forms', keywords: 'widget' },
    { name: 'elsewhere', group: 'cards', keywords: 'widget' },
  ])
  const { hits } = await search(small, 'widget', { group: 'forms', k: 10 })
  assert.equal(hits.length, 1)
  small.close()
})

test('an unmatched filter yields no hits rather than unfiltered ones', async () => {
  // The tool layer rejects unknown slugs outright (a later commit); at this layer
  // the contract is simply that the filter is honoured.
  const { hits } = await search(db, 'widget', { group: 'nonexistent', k: 10 })
  assert.deepEqual(hits, [])
})

// ── unfiltered behaviour is unchanged ────────────────────────────────────────

test('k bounds an unfiltered search and the default is 8', async () => {
  assert.equal((await search(db, 'widget', { k: 10 })).hits.length, 10)
  assert.equal((await search(db, 'widget')).hits.length, 8)
})

test('an empty query yields no hits instead of throwing', async () => {
  const { hits } = await search(db, '   ', { k: 5 })
  assert.deepEqual(hits, [])
})

test('lexical-only mode is reported as degraded', async () => {
  const { degraded } = await search(db, 'widget', { k: 1 })
  assert.equal(degraded, true)
})

test('cosine is null when a hit has no dense evidence', async () => {
  // The whole offline suite runs lexical-only, so no hit can carry a cosine —
  // exactly the "degraded mode ⇒ cosine: null" contract callers rely on.
  const { hits } = await search(db, 'widget', { k: 5 })
  assert.ok(hits.length > 0)
  assert.ok(
    hits.every((h) => h.cosine === null),
    'a lexical-only match must not fabricate an absolute similarity',
  )
})

test('hits carry the fields the MCP layer renders', async () => {
  const { hits } = await search(db, 'widget', { k: 1 })
  const hit = hits[0]
  assert.ok(hit)
  assert.match(hit.installCmd, /^npx shadcn@latest add @encode-ui\//)
  assert.match(hit.docUrl, /^https:\/\/encode-ui\.com\/view\//)
  assert.ok(hit.matchedOn.length > 0)
  assert.equal(typeof hit.score, 'number')
  assert.equal(hit.provenance, 'original')
})

// ── findSimilar ──────────────────────────────────────────────────────────────

test('findSimilar returns exactly k when the index holds that many', () => {
  // 90 items, so k=25 is comfortably reachable. The old (k + 1) * 4 over-fetch
  // was filtered down to doc chunks AFTER the KNN cap, so it could under-return.
  const hits = findSimilar(db, 'forms-00', MAX_K)
  assert.equal(hits.length, MAX_K)
  assert.ok(!hits.some((h) => h.name === 'forms-00'), 'the seed is never its own neighbour')
  assert.equal(new Set(hits.map((h) => h.name)).size, MAX_K, 'no duplicates')
  assert.ok(hits.every((h) => h.matchedOn.includes('doc:similar')))
})

test('findSimilar scores are descending cosine similarities', () => {
  const scores = findSimilar(db, 'forms-00', 10).map((h) => h.score)
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  )
  assert.ok(scores.every((s) => s <= 1))
})

test('findSimilar reports TRUE cosine, not 1 − L2', () => {
  // The fixture vectors are unit vectors rotated by seed·π/64, so the exact
  // cosine between forms-00 (seed 0) and its i-th nearest neighbour is
  // cos((i+1)·π/64). The old `1 − distance` transform under-reported every one
  // (≈0.9988 read as ≈0.951 at the first neighbour) and went negative in far
  // tails; vec0's metric is L2, and for unit vectors cosine = 1 − d²/2.
  const hits = findSimilar(db, 'forms-00', 5)
  assert.equal(hits.length, 5)
  hits.forEach((h, i) => {
    const want = Math.cos(((i + 1) * Math.PI) / 64)
    assert.ok(
      Math.abs(h.score - want) < 1e-4,
      `${h.name}: score ${h.score} ≠ cos(${i + 1}π/64) ${want.toFixed(6)}`,
    )
  })
})

test('findSimilar exposes its cosine under both keys', () => {
  // For similar-hits the score IS a cosine, so the absolute field must agree —
  // callers can then read `cosine` uniformly across both retrieval tools.
  const hits = findSimilar(db, 'forms-00', 3)
  assert.ok(hits.length > 0)
  assert.ok(hits.every((h) => h.cosine === h.score))
})

test('findSimilar caps at what the index actually holds', () => {
  const small = buildFixtureIndex([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
  assert.equal(findSimilar(small, 'a', MAX_K).length, 2, 'three items minus the seed')
  small.close()
})

test('findSimilar on an unknown name returns nothing', () => {
  assert.deepEqual(findSimilar(db, 'no-such-component', 5), [])
})
