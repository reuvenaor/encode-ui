// The icon catalog, tested over the REAL committed artifact — deterministic,
// parsed in ~2 ms, and every assertion here doubles as a shape-check on what
// actually ships in the tarball.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadIconCatalog, matchIcons, resolveIconName, suggestIcons } from '../src/icons.ts'
import { buildIconsOutput } from '../src/mcp/build.ts'
import { renderIcons } from '../src/mcp/render.ts'
import { FindIconsInput } from '../src/mcp/schemas.ts'
import type { IconEntry } from '../src/icons.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const catalog = loadIconCatalog()

// ── artifact integrity ───────────────────────────────────────────────────────

test('the artifact is internally consistent and plausibly complete', () => {
  const raw = JSON.parse(readFileSync(path.resolve(HERE, '../src/lucide-icons.json'), 'utf8')) as {
    count: number
    icons: unknown[]
  }
  assert.equal(raw.count, raw.icons.length)
  assert.ok(catalog.icons.length > 1500, `only ${catalog.icons.length} icons — truncated artifact?`)
  assert.ok(catalog.categories.size >= 40, `only ${catalog.categories.size} categories`)
})

/**
 * The drift guard: bumping lucide-react without re-vendoring must go red here.
 * Skipped when the registry package.json is absent (the published tarball).
 */
test('the artifact version matches the registry lucide-react pin', () => {
  const registryPkg = path.resolve(HERE, '../../package.json')
  if (!existsSync(registryPkg)) return
  const pin = (
    JSON.parse(readFileSync(registryPkg, 'utf8')) as {
      dependencies?: Record<string, string>
    }
  ).dependencies?.['lucide-react']
  if (pin === undefined) return
  assert.equal(
    catalog.version,
    pin.replace(/^[~^]/, ''),
    'lucide-react pin moved — run `npm --prefix rag run vendor:icons` and commit the artifact',
  )
})

// ── name resolution ──────────────────────────────────────────────────────────

test('every spelling an agent emits resolves to the canonical icon', () => {
  for (const input of ['house', 'House', 'HouseIcon', 'LucideHouse', 'HOUSE']) {
    const hit = resolveIconName(catalog, input)
    assert.equal(hit?.entry.name, 'house', `"${input}" did not resolve`)
    assert.equal(hit?.alias, null, `"${input}" flagged as an alias`)
  }
})

test('an alias resolves to the canonical icon and names itself', () => {
  for (const input of ['home', 'Home', 'HomeIcon']) {
    const hit = resolveIconName(catalog, input)
    assert.equal(hit?.entry.name, 'house', `"${input}" did not resolve`)
    assert.equal(hit?.alias?.name, 'home', `"${input}" not flagged as the home alias`)
  }
})

test('a deprecated alias resolves AND carries its deprecation flag', () => {
  for (const input of ['area-chart', 'AreaChart', 'AreaChartIcon']) {
    const hit = resolveIconName(catalog, input)
    assert.equal(hit?.entry.name, 'chart-area', `"${input}" did not resolve`)
    assert.equal(hit?.alias?.deprecated, true, `"${input}" not flagged deprecated`)
  }
})

test('an unknown name resolves to null, and suggestions are close', () => {
  assert.equal(resolveIconName(catalog, 'definitely-not-an-icon'), null)
  assert.ok(suggestIcons(catalog, 'hose').includes('house'))
})

// ── search ───────────────────────────────────────────────────────────────────

test('a multi-word concept query ANDs its terms', () => {
  const hits = matchIcons(catalog, 'shopping cart')
  assert.equal(hits[0]?.name, 'shopping-cart')
})

test('tag-only matches surface icons whose names never mention the concept', () => {
  const hits = matchIcons(catalog, 'danger', undefined, 10)
  assert.ok(hits.length > 0, 'no hits for "danger"')
  assert.ok(
    hits.some((h) => h.tags.includes('danger')),
    'no hit carries the danger tag',
  )
})

test('category alone browses alphabetically; with a query it filters', () => {
  const browse = matchIcons(catalog, '', 'navigation', 5)
  assert.equal(browse.length, 5)
  const sorted = [...browse.map((h) => h.name)].sort()
  assert.deepEqual(
    browse.map((h) => h.name),
    sorted,
  )
  for (const hit of matchIcons(catalog, 'arrow', 'text', 10)) {
    assert.ok(hit.categories.includes('text'), `${hit.name} escaped the category filter`)
  }
})

test('ties prefer the shorter, then alphabetical, name', () => {
  const hits = matchIcons(catalog, 'arrow up', undefined, 5)
  assert.equal(hits[0]?.name, 'arrow-up')
})

// ── input schema ─────────────────────────────────────────────────────────────

test('the input schema requires at least one mode and stays strict', () => {
  assert.throws(() => FindIconsInput.parse({}), /at least one of query, names, or category/i)
  assert.throws(() => FindIconsInput.parse({ query: 'x', bogus: 1 }))
  assert.equal(FindIconsInput.parse({ query: 'x' }).limit, 8)
})

// ── builder + renderer agreement ─────────────────────────────────────────────

const FAKE: IconEntry = {
  name: 'test-icon',
  pascal: 'TestIcon',
  tags: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'],
  categories: ['testing'],
  aliases: [{ name: 'old-test', deprecated: true }],
}

test('the builder caps tags and the renderer agrees with the payload', () => {
  const out = buildIconsOutput(
    '0.0.0',
    [{ entry: FAKE, alias: { name: 'old-test', deprecated: true } }],
    [{ name: 'nope', suggestions: ['test-icon'] }],
  )
  assert.equal(out.icons[0]?.tags.length, 8)
  assert.equal(out.icons[0]?.deprecatedAliases[0], 'old-test')
  assert.match(out.usage ?? '', /import \{ TestIcon \} from 'lucide-react'/)

  const text = renderIcons(out)
  assert.match(text, /test-icon \(TestIcon\)/)
  assert.match(text, /"old-test" is a deprecated alias/)
  assert.match(text, /unknown: "nope" — closest: test-icon/)
})

test('an empty result renders honestly', () => {
  const out = buildIconsOutput('0.0.0', [], [])
  assert.equal(out.usage, null)
  assert.match(renderIcons(out), /No icons matched/)
})
