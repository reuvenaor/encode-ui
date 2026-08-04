// The agent-index artifact, tested over the REAL committed file — every
// assertion doubles as a shape-check on what actually ships in the tarball,
// and the drift guard makes a stale artifact a red `rag:check` instead of a
// quietly wrong catalog engine.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultCatalogPath, loadCatalog, resolveComponentName } from '../src/catalog.ts'
import { sha256, sourceDigestsOf } from '../src/source-digests.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY_ROOT = path.resolve(HERE, '..', '..')
const catalog = loadCatalog()

// ── artifact integrity ───────────────────────────────────────────────────────

test('the artifact is internally consistent and plausibly complete', () => {
  const raw = JSON.parse(readFileSync(defaultCatalogPath(), 'utf8')) as {
    counts: { items: number; groups: number }
    items: unknown[]
    groups: unknown[]
  }
  assert.equal(raw.counts.items, raw.items.length)
  assert.equal(raw.counts.groups, raw.groups.length)
  assert.ok(catalog.items.length > 300, `only ${catalog.items.length} items — truncated artifact?`)
  assert.ok(catalog.groups.length >= 20, `only ${catalog.groups.length} groups`)
  for (const group of catalog.groups) {
    assert.ok(group.description.length > 0, `group "${group.slug}" has no description`)
  }
})

test('registryHash matches the records it claims to cover', () => {
  // The generator hashes the one-line JSON records; JSON.parse → stringify
  // round-trips key order, so a hand-edited record (or a drifted serializer)
  // breaks this equality.
  const raw = JSON.parse(readFileSync(defaultCatalogPath(), 'utf8')) as { items: unknown[] }
  const recomputed = sha256(raw.items.map((i) => JSON.stringify(i)).join('\n')).slice(0, 16)
  assert.equal(
    recomputed,
    catalog.registryHash,
    'registryHash does not match the item records — regenerate with `npm run registry:build`',
  )
})

test('every item group resolves to a listed group, counts included', () => {
  const bySlug = new Map(catalog.groups.map((g) => [g.slug, g]))
  const seen = new Map<string, number>()
  for (const item of catalog.items) {
    if (item.group === null) continue
    const group = bySlug.get(item.group.slug)
    assert.ok(group, `item "${item.name}" points at unlisted group "${item.group.slug}"`)
    assert.equal(item.group.label, group.label)
    seen.set(item.group.slug, (seen.get(item.group.slug) ?? 0) + 1)
  }
  for (const group of catalog.groups) {
    assert.equal(seen.get(group.slug), group.count, `group "${group.slug}" count drifted`)
  }
})

test('the served copy under public/ is byte-identical', () => {
  const served = path.join(REGISTRY_ROOT, 'public', 'agent-index.json')
  if (!existsSync(served)) return // tarball layout — only the rag copy ships
  assert.ok(
    readFileSync(defaultCatalogPath()).equals(readFileSync(served)),
    'rag/agent-index.json and public/agent-index.json diverged — rerun `npm run registry:build`',
  )
})

// ── name resolution ──────────────────────────────────────────────────────────

test('resolution accepts the spellings an agent emits', () => {
  for (const input of ['sonner', 'Sonner', 'SONNER']) {
    const hit = resolveComponentName(catalog, input)
    assert.equal(hit?.item.name, 'sonner', `"${input}" did not resolve`)
    assert.equal(hit?.viaAlias, null)
  }
  for (const input of ['toast', 'Toast']) {
    const hit = resolveComponentName(catalog, input)
    assert.equal(hit?.item.name, 'sonner', `alias "${input}" did not resolve`)
    assert.equal(hit?.viaAlias, 'toast')
  }
  assert.equal(resolveComponentName(catalog, 'dropdown menu')?.item.name, 'dropdown-menu')
  assert.equal(resolveComponentName(catalog, 'DropdownMenu')?.item.name, 'dropdown-menu')
  assert.equal(resolveComponentName(catalog, 'no-such-thing'), null)
})

test('an alias never shadows a canonical name', () => {
  // The live-fire case: sheet declares the alias 'drawer', but drawer IS an
  // item — the canonical entry must keep the key.
  const drawer = resolveComponentName(catalog, 'drawer')
  assert.equal(drawer?.item.name, 'drawer')
  assert.equal(drawer?.viaAlias, null)
  // And the invariant across the whole key map.
  for (const [key, { item, alias }] of catalog.byKey) {
    if (catalog.byName.has(key)) {
      assert.equal(alias, null, `alias key "${key}" shadows the item of that name`)
      assert.equal(item.name, key)
    }
  }
})

test("a dashless spelling can never steal another item's exact name", (t) => {
  // Synthetic collision the real corpus does not (yet) contain: an item named
  // `datatable` next to `data-table`, whose dashless form is the same key.
  // The exact-name pass must win in BOTH artifact orders.
  const item = (name: string): Record<string, unknown> => ({
    name,
    type: 'registry:ui',
    title: name,
    description: 'x',
    group: null,
    categories: [],
    keywords: [],
    aliases: [],
    dependencies: [],
    registryDependencies: [],
    transitiveDependencies: [],
    pure: true,
    provenance: null,
    license: null,
    sourceUrl: null,
    motion: false,
    gated: false,
    filePath: null,
    partsFilePath: null,
    sourceBytes: null,
    demoBytes: null,
    installCmd: `npx shadcn@latest add @x/${name}`,
    docUrl: 'https://x.test/view/x',
    docs: null,
  })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bykey-collision-'))
  t.after(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const write = (names: readonly string[]): string => {
    const items = names.map(item)
    const file = path.join(dir, `${names.join('_')}.json`)
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: '1',
        registryHash: '0123456789abcdef',
        registry: { scope: 'x', homepage: 'https://x.test' },
        counts: { items: items.length, groups: 0 },
        sources: { registryJsonSha256: 'f', groupsSha256: 'f', demosDigest: 'f' },
        groups: [],
        items,
      }),
    )
    return file
  }
  for (const order of [
    ['datatable', 'data-table'],
    ['data-table', 'datatable'],
  ] as const) {
    const cat = loadCatalog(write(order))
    assert.equal(
      resolveComponentName(cat, 'datatable')?.item.name,
      'datatable',
      `exact name lost to a dashless form (order: ${order.join(', ')})`,
    )
    assert.equal(resolveComponentName(cat, 'data-table')?.item.name, 'data-table')
  }
})

// ── drift guard ──────────────────────────────────────────────────────────────
//
// Recomputes the generator's three source digests from the checkout, via the
// shared TypeScript definition (src/source-digests.ts — the same one
// build:index persists into index.db meta). scripts/build-agent-index.mjs
// keeps its own .mjs port (it cannot be imported across the package
// boundary); THIS comparison of a fresh recompute against the committed
// artifact is what pins the two implementations together — if either side
// changes shape, this goes red and forces them back into agreement.

const REBUILD =
  'registry changed — run `npm run registry:build` and commit rag/agent-index.json + public/agent-index.json'

test('the committed artifact matches the registry sources', () => {
  const registryJson = path.join(REGISTRY_ROOT, 'registry.json')
  if (!existsSync(registryJson)) return // tarball layout — no sources to compare
  assert.deepEqual(sourceDigestsOf(REGISTRY_ROOT), catalog.sources, REBUILD)
})

test('no keyword or alias was mined from the eval benchmark', () => {
  // The canary behind propose-keywords.mjs's integrity rule: keywords are
  // authored from item descriptions/source/demos, NEVER from the 208 labeled
  // eval queries — metadata equal to a query verbatim would overfit the
  // benchmark and void every recall number the eval reports.
  const evalQueries = path.join(HERE, '..', 'eval', 'queries.json')
  if (!existsSync(evalQueries)) return // tarball layout ships no eval corpus
  const parsed = JSON.parse(readFileSync(evalQueries, 'utf8')) as { queries?: { q: string }[] }
  const rows = parsed.queries ?? []
  const queryTexts = new Set(rows.map((row) => row.q.trim().toLowerCase()))
  assert.ok(queryTexts.size > 100, 'eval corpus shape changed — update the canary')
  for (const item of catalog.items) {
    for (const term of [...item.keywords, ...item.aliases]) {
      assert.ok(
        !queryTexts.has(term.trim().toLowerCase()),
        `"${item.name}" carries "${term}" — verbatim from the eval benchmark`,
      )
    }
  }
})

test('the drift comparison itself detects a changed input', () => {
  const registryJson = path.join(REGISTRY_ROOT, 'registry.json')
  if (!existsSync(registryJson)) return
  // Negative fixture: a doctored input must produce a different digest —
  // proving the guard above can actually fire.
  const doctored = Buffer.concat([readFileSync(registryJson), Buffer.from('x')])
  assert.notEqual(sha256(doctored), catalog.sources.registryJsonSha256)
})
