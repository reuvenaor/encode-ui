// The catalog engine over the synthetic fixture (ranking, filters, neighbours,
// lazy source resolution) plus one pin against the REAL committed artifact:
// the generator's .mjs port of the dependency closure must reproduce
// computeDependencyClosure exactly.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { loadCatalog } from '../src/catalog.ts'
import { createCatalogEngine } from '../src/engine-catalog.ts'
import { DEFAULT_K, MAX_K, orderGroups } from '../src/engine.ts'
import { computeDependencyClosure } from '../src/items.ts'
import {
  BUTTON_DEMO,
  BUTTON_SOURCE,
  SPLIT_HELPER,
  SPLIT_PARTS,
  SPLIT_SOURCE,
  buildCatalogFixture,
} from './fixtures/catalog-fixture.ts'

const { catalog, root } = buildCatalogFixture()
const engine = createCatalogEngine(catalog, { registryRoot: root })

/** Scores are rank-derived (1/(60+rank)) — non-increasing over the hit list. */
function assertMonotonic(hits: readonly { name: string; score: number }[]): void {
  for (let i = 1; i < hits.length; i++) {
    assert.ok(
      hits[i]!.score <= hits[i - 1]!.score,
      `score rose at rank ${i + 1}: ${hits[i - 1]!.name}=${hits[i - 1]!.score} → ${hits[i]!.name}=${hits[i]!.score}`,
    )
  }
}

// ── ranking ──────────────────────────────────────────────────────────────────

test('an exact name outranks everything and says how it matched', async () => {
  const { hits, degraded } = await engine.search('fixture-dialog')
  assert.equal(degraded, false)
  assert.equal(hits[0]?.name, 'fixture-dialog')
  assert.deepEqual(hits[0]?.matchedOn, ['name:catalog'])
  assert.equal(hits[0]?.cosine, null)
})

test('a curated alias resolves to its item at rank 1', async () => {
  const { hits } = await engine.search('modal')
  assert.equal(hits[0]?.name, 'fixture-dialog')
  assert.deepEqual(hits[0]?.matchedOn, ['alias:catalog'])
})

test('an alias never outranks the real item of that name', async () => {
  // fixture-sheet aliases 'fixture-drawer', but fixture-drawer IS an item.
  const { hits } = await engine.search('fixture-drawer')
  assert.equal(hits[0]?.name, 'fixture-drawer')
  assert.deepEqual(hits[0]?.matchedOn, ['name:catalog'])
})

test('behaviour phrasings reach items through keywords', async () => {
  const { hits } = await engine.search('popup window')
  assert.equal(hits[0]?.name, 'fixture-dialog')
  assert.ok(hits[0]?.matchedOn.some((m) => m.startsWith('keywords:')))
})

test('the OR pass fills only when AND runs short, below the AND results', async () => {
  // 'fixture window': the AND pass matches ONLY fixture-dialog (description
  // "Fixture window…" + keywords), then the OR pass fills with the
  // single-term 'fixture' matches. The layering contract, asserted for real:
  // the AND hit ranks first even though an OR-fill hit's RAW BM25 could
  // exceed it, and the emitted scores agree with the order.
  const layered = await engine.search('fixture window')
  assert.equal(layered.hits[0]?.name, 'fixture-dialog')
  assert.ok(layered.hits.length > 1, 'the OR pass filled below the AND result')
  assertMonotonic(layered.hits)

  // AND empty entirely ('popup' + a term nothing carries): OR still finds the
  // dialog — the engine answers instead of returning an empty set.
  const { hits } = await engine.search('popup zzzunknownterm')
  assert.ok(hits.some((h) => h.name === 'fixture-dialog'))
  assertMonotonic(hits)
})

test('search caps at k and never fabricates a cosine', async () => {
  const { hits } = await engine.search('fixture', { k: 3 })
  assert.ok(hits.length <= 3)
  assertMonotonic(hits)
  for (const h of hits) {
    assert.equal(h.cosine, null)
    assert.ok(h.score > 0 && h.score <= 1 / 61, 'rank-derived score in (0, 1/61]')
  }
})

// ── filters ──────────────────────────────────────────────────────────────────

test('filters restrict before ranking', async () => {
  const buttons = await engine.search('fixture', { k: MAX_K, group: 'buttons' })
  assert.ok(buttons.hits.length >= 2)
  assert.ok(buttons.hits.every((h) => h.group === 'buttons'))

  const lib = await engine.search('fixture', { k: MAX_K, type: 'registry:lib' })
  assert.deepEqual(
    lib.hits.map((h) => h.name),
    ['fixture-lib'],
  )

  const animated = await engine.search('fixture', { k: MAX_K, motion: true })
  assert.deepEqual(
    animated.hits.map((h) => h.name),
    ['fixture-magnetic'],
  )

  const pure = await engine.search('fixture', { k: MAX_K, dependencyFree: true })
  assert.ok(pure.hits.every((h) => h.pure))
  assert.ok(!pure.hits.some((h) => h.name === 'fixture-magnetic'))
})

test('the exact short-circuit respects filters', async () => {
  // fixture-dialog is static; asking for motion-only must not smuggle it in.
  const { hits } = await engine.search('fixture-dialog', { motion: true })
  assert.ok(!hits.some((h) => h.name === 'fixture-dialog'))
})

// ── findSimilar ──────────────────────────────────────────────────────────────

test('neighbours favour the same group and composition edges', () => {
  const hits = engine.findSimilar('fixture-button', DEFAULT_K)
  assert.equal(hits[0]?.name, 'fixture-magnetic', 'same group + direct edge should lead')
  assert.ok(!hits.some((h) => h.name === 'fixture-button'), 'seed excluded')
  for (const h of hits) {
    assert.deepEqual(h.matchedOn, ['similar:catalog'])
    assert.equal(h.cosine, null)
  }
})

test('every known name is a valid similarity seed', () => {
  assert.equal(engine.canFindSimilar('theme-one'), true)
  assert.equal(engine.canFindSimilar('no-such-thing'), false)
  assert.deepEqual(engine.findSimilar('no-such-thing'), [])
})

// ── catalog surface ──────────────────────────────────────────────────────────

test('listGroups orders themes last and mirrors orderGroups', () => {
  const rows = engine.listGroups()
  assert.equal(rows.at(-1)?.slug, 'themes')
  assert.deepEqual(
    rows,
    orderGroups([
      { slug: 'buttons', label: 'Buttons', count: 2, isTheme: false },
      { slug: 'forms', label: 'Forms', count: 1, isTheme: false },
      { slug: 'overlays', label: 'Overlays', count: 3, isTheme: false },
      { slug: 'lib', label: 'Utilities', count: 1, isTheme: false },
      { slug: 'themes', label: 'Themes', count: 1, isTheme: true },
    ]),
  )
})

test('listComponents enumerates one group alphabetically with pure flags', () => {
  const rows = engine.listComponents('overlays')
  assert.deepEqual(
    rows.map((r) => r.name),
    ['fixture-dialog', 'fixture-drawer', 'fixture-sheet'],
  )
  assert.ok(rows.every((r) => r.label === 'Overlays' && r.pure))
  assert.deepEqual(engine.listComponents('no-such-group'), [])
})

test('detail and dependencyInfo come straight from the artifact', () => {
  const detail = engine.detail('fixture-split')
  assert.equal(
    detail?.partsFilePath,
    'src/registry/components/forms/fixture-split.parts.tsx, ' +
      'src/registry/components/forms/fixture-split.helper.tsx',
  )
  assert.equal(
    detail?.sourceBytes,
    Buffer.byteLength(SPLIT_SOURCE) + Buffer.byteLength([SPLIT_PARTS, SPLIT_HELPER].join('\n\n')),
  )
  const info = engine.dependencyInfo('fixture-magnetic')
  assert.equal(info.pure, false)
  assert.deepEqual(info.transitiveDependencies, ['motion'])
  assert.deepEqual(engine.dependencyInfo('no-such-thing'), {
    pure: false,
    transitiveDependencies: [],
  })
})

// ── sourceOf ─────────────────────────────────────────────────────────────────

test('source bodies resolve lazily from the checkout payloads', () => {
  const single = engine.sourceOf('fixture-button', 'source')
  assert.ok(Array.isArray(single))
  assert.deepEqual(single, [{ path: 'src/registry/ui/fixture-button.tsx', code: BUTTON_SOURCE }])

  // EVERY payload file after files[0] ships — the .parts.tsx sibling AND the
  // non-parts helper module — as ONE combined siblings entry (db parity).
  const split = engine.sourceOf('fixture-split', 'source')
  assert.ok(Array.isArray(split))
  assert.equal(split.length, 2, 'public module + one combined siblings entry')
  assert.equal(
    split[1]?.path,
    'src/registry/components/forms/fixture-split.parts.tsx, ' +
      'src/registry/components/forms/fixture-split.helper.tsx',
  )
  assert.equal(split[1]?.code, [SPLIT_PARTS, SPLIT_HELPER].join('\n\n'))

  const demo = engine.sourceOf('fixture-button', 'demo')
  assert.ok(Array.isArray(demo))
  assert.equal(demo[0]?.code, BUTTON_DEMO)
})

test('missing part null · no checkout unavailable · missing file drifted', () => {
  assert.equal(engine.sourceOf('theme-one', 'source'), null, 'themes have no source')
  assert.equal(engine.sourceOf('fixture-lib', 'demo'), null, 'the chart-series shape')
  // These two PROMISE sourceBytes but their payloads are absent from the
  // fixture checkout: the checkout drifted — a different answer (and a
  // different remedy) than "no checkout around this install".
  assert.equal(engine.sourceOf('fixture-dialog', 'source'), 'drifted')
  assert.equal(engine.sourceOf('fixture-magnetic', 'source'), 'drifted')
  const detached = createCatalogEngine(catalog, { registryRoot: null })
  assert.equal(detached.sourceOf('fixture-button', 'source'), 'unavailable')
  assert.equal(detached.sourceOf('theme-one', 'source'), null, 'no-part beats unavailable')
})

test('a detached install fetches bodies instead of declining them', async () => {
  // The regression this guards: mcp.ts passed `path.resolve(HERE,'..','..')`
  // unconditionally, which in an `npm i` is node_modules/@encode-ui/ — a real
  // directory holding no registry. So 'unavailable' was dead code, and every
  // source request answered 'drifted', advising `npm run registry:build` in a
  // checkout the operator did not have.
  const asked: string[] = []
  const remote = (name: string, part: 'source' | 'demo') => {
    asked.push(`${name}:${part}`)
    return Promise.resolve([{ path: `${name}.tsx`, code: 'export const X = 1' }])
  }
  const detached = createCatalogEngine(catalog, { registryRoot: null, remote })
  assert.deepEqual(await detached.sourceOf('fixture-button', 'source'), [
    { path: 'fixture-button.tsx', code: 'export const X = 1' },
  ])
  assert.deepEqual(asked, ['fixture-button:source'])
  // The existence oracle still answers first — no round-trip for a part the
  // artifact says does not exist.
  assert.equal(await detached.sourceOf('theme-one', 'source'), null)
  assert.deepEqual(asked, ['fixture-button:source'])
})

test('an explicitly named origin outranks a working checkout', async () => {
  // --registry-url is how you point a local server at live payloads while the
  // checkout on disk is mid-edit; silently preferring the checkout would make
  // the flag a no-op.
  const remote = () => Promise.resolve([{ path: 'remote.tsx', code: 'from the origin' }])
  const preferring = createCatalogEngine(catalog, { registryRoot: root, remote, preferRemote: true })
  assert.deepEqual(await preferring.sourceOf('fixture-button', 'source'), [
    { path: 'remote.tsx', code: 'from the origin' },
  ])
  // Without the flag the checkout wins — faster, and works offline.
  const local = createCatalogEngine(catalog, { registryRoot: root, remote })
  const fromDisk = await local.sourceOf('fixture-button', 'source')
  assert.ok(Array.isArray(fromDisk) && fromDisk[0]?.code !== 'from the origin')
})

test('a corrupt payload throws NAMING the file (stderr is the operator channel)', () => {
  // fixture-drawer promises source; hand it a payload that does not parse.
  writeFileSync(path.join(root, 'public', 'r', 'fixture-drawer.json'), '{"files": [truncated')
  assert.throws(
    () => engine.sourceOf('fixture-drawer', 'source'),
    (err: Error) => {
      assert.match(err.message, /fixture-drawer\.json is unreadable/)
      assert.match(err.message, /mid-write or corrupt/)
      return true
    },
  )
})

// ── parity with the generator (REAL artifact) ────────────────────────────────

test('the artifact closure matches computeDependencyClosure exactly', () => {
  const real = loadCatalog()
  const computed = computeDependencyClosure(
    real.items.map((i) => ({
      name: i.name,
      dependencies: i.dependencies,
      registryDependencies: i.registryDependencies,
    })),
  )
  for (const item of real.items) {
    const info = computed.get(item.name)
    assert.ok(info, `no closure for ${item.name}`)
    assert.equal(info.pure, item.pure, `pure drifted for ${item.name}`)
    assert.deepEqual(
      [...info.transitiveDependencies],
      item.transitiveDependencies,
      `transitive closure drifted for ${item.name} — the build-agent-index.mjs port diverged`,
    )
  }
})

test('a registryDependencies cycle fails loud instead of shipping pure lies', () => {
  // The old guard memoized the empty set at the back-edge: both members of
  // a→b→a would have shipped pure:true / [] while actually pulling recharts.
  assert.throws(
    () =>
      computeDependencyClosure([
        { name: 'a', dependencies: ['recharts'], registryDependencies: ['@fixture/b'] },
        { name: 'b', dependencies: [], registryDependencies: ['@fixture/a'] },
      ]),
    /registryDependencies cycle: a → b → a/,
  )
  // A self-edge is the smallest cycle.
  assert.throws(
    () =>
      computeDependencyClosure([
        { name: 'a', dependencies: [], registryDependencies: ['@fixture/a'] },
      ]),
    /cycle: a → a/,
  )
  // Unknown edge targets are NOT cycles — external names stay a silent no-op.
  const ok = computeDependencyClosure([
    { name: 'a', dependencies: [], registryDependencies: ['@fixture/not-ours'] },
  ])
  assert.deepEqual(ok.get('a'), { pure: true, transitiveDependencies: [] })
})
