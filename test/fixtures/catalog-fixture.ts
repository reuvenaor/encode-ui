// A synthetic agent-index fixture: written to a temp dir and loaded through
// the REAL loadCatalog (so every test also exercises the Zod gate and the
// canonical-first key map), with just enough payload/demo files on disk to
// drive sourceOf. Covers the shapes that bite: a theme (all nulls), a
// demo-less lib (the chart-series analog), a parts pair, an alias that
// collides with a real item name, and a motion/dependency carrier.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadCatalog } from '../../src/catalog.ts'
import type { Catalog, CatalogItem } from '../../src/catalog.ts'

const HOMEPAGE = 'https://fixture.test'
const SCOPE = 'fixture'

const BUTTON_SOURCE = 'export const FixtureButton = () => null\n'
const BUTTON_DEMO = 'export default function Demo() { return null }\n'
const SPLIT_SOURCE =
  "import { Part } from './fixture-split.parts'\n" +
  "import { Helper } from './fixture-split.helper'\n" +
  'export const Split = () => [Part, Helper]\n'
const SPLIT_PARTS = 'export const Part = () => null\n'
// A sibling that is NOT a .parts.tsx file — the multi-file block shape
// (blog-01's article-item.tsx). Every payload file after files[0] must ship.
const SPLIT_HELPER = 'export const Helper = () => null\n'

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8')

const base: Omit<CatalogItem, 'name' | 'title' | 'description' | 'group' | 'categories'> = {
  type: 'registry:ui',
  keywords: [],
  aliases: [],
  dependencies: [],
  registryDependencies: [],
  transitiveDependencies: [],
  pure: true,
  provenance: 'original',
  license: null,
  sourceUrl: null,
  motion: false,
  gated: false,
  docs: null,
  filePath: null,
  partsFilePath: null,
  sourceBytes: null,
  demoBytes: null,
  installCmd: '',
  docUrl: '',
}

function make(
  name: string,
  group: { slug: string; label: string } | null,
  overrides: Partial<CatalogItem>,
): CatalogItem {
  return {
    ...base,
    name,
    title: name
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    description: `${name} fixture item.`,
    group,
    categories: group ? [group.slug] : [],
    installCmd: `npx shadcn@latest add @${SCOPE}/${name}`,
    docUrl: group ? `${HOMEPAGE}/view/${group.slug}/${name}` : `${HOMEPAGE}/view/${name}`,
    ...overrides,
  }
}

const BUTTONS = { slug: 'buttons', label: 'Buttons' }
const OVERLAYS = { slug: 'overlays', label: 'Overlays' }
const FORMS = { slug: 'forms', label: 'Forms' }
const LIB = { slug: 'lib', label: 'Utilities' }
const THEMES = { slug: 'themes', label: 'Themes' }

export interface CatalogFixture {
  catalog: Catalog
  /** Temp registry root carrying public/r payloads + src/demos for sourceOf. */
  root: string
}

export function buildCatalogFixture(): CatalogFixture {
  const items: CatalogItem[] = [
    make('fixture-button', BUTTONS, {
      description: 'Plain fixture button for pressing things.',
      filePath: 'src/registry/ui/fixture-button.tsx',
      sourceBytes: bytes(BUTTON_SOURCE),
      demoBytes: bytes(BUTTON_DEMO),
      keywords: ['press'],
    }),
    make('fixture-magnetic', BUTTONS, {
      description: 'Button drawn toward the cursor.',
      motion: true,
      dependencies: ['motion'],
      registryDependencies: [`@${SCOPE}/fixture-button`],
      transitiveDependencies: ['motion'],
      pure: false,
      keywords: ['cursor attract'],
      filePath: 'src/registry/components/buttons/fixture-magnetic.tsx',
      sourceBytes: 64,
    }),
    make('fixture-dialog', OVERLAYS, {
      description: 'Fixture window overlaid on the page.',
      aliases: ['modal'],
      keywords: ['popup window', 'overlay window'],
      filePath: 'src/registry/ui/fixture-dialog.tsx',
      sourceBytes: 64,
    }),
    make('fixture-drawer', OVERLAYS, {
      description: 'Touch-friendly fixture drawer.',
      keywords: ['slide panel'],
      filePath: 'src/registry/ui/fixture-drawer.tsx',
      sourceBytes: 64,
    }),
    make('fixture-sheet', OVERLAYS, {
      description: 'Fixture panel from a screen edge.',
      // 'fixture-drawer' collides with the REAL item of that name — the
      // canonical entry must keep the key (the shadow test's live fire).
      aliases: ['fixture-drawer', 'slide-over'],
      filePath: 'src/registry/ui/fixture-sheet.tsx',
      sourceBytes: 64,
    }),
    make('fixture-lib', LIB, {
      type: 'registry:lib',
      description: 'Fixture helper with no demo — the chart-series shape.',
      filePath: 'src/registry/lib/fixture-lib.ts',
      sourceBytes: 64,
      demoBytes: null,
    }),
    make('theme-one', THEMES, {
      type: 'registry:theme',
      description: 'A fixture palette.',
    }),
    make('fixture-split', FORMS, {
      description: 'Multi-file fixture: a parts pair PLUS a non-parts sibling.',
      filePath: 'src/registry/components/forms/fixture-split.tsx',
      partsFilePath:
        'src/registry/components/forms/fixture-split.parts.tsx, ' +
        'src/registry/components/forms/fixture-split.helper.tsx',
      sourceBytes: bytes(SPLIT_SOURCE) + bytes([SPLIT_PARTS, SPLIT_HELPER].join('\n\n')),
    }),
  ]

  const groups = [
    { ...BUTTONS, description: 'Fixture buttons.', count: 2 },
    { ...FORMS, description: 'Fixture forms.', count: 1 },
    { ...OVERLAYS, description: 'Fixture overlays.', count: 3 },
    { ...LIB, description: 'Fixture utilities.', count: 1 },
    { ...THEMES, description: 'Fixture palettes.', count: 1 },
  ]

  const index = {
    schemaVersion: '1',
    registryHash: '0123456789abcdef',
    registry: { scope: SCOPE, homepage: HOMEPAGE },
    counts: { items: items.length, groups: groups.length },
    sources: { registryJsonSha256: 'fixture', groupsSha256: 'fixture', demosDigest: 'fixture' },
    groups,
    items,
  }

  const root = mkdtempSync(path.join(tmpdir(), 'catalog-fixture-'))
  writeFileSync(path.join(root, 'agent-index.json'), JSON.stringify(index))

  const rDir = path.join(root, 'public', 'r')
  mkdirSync(rDir, { recursive: true })
  writeFileSync(
    path.join(rDir, 'fixture-button.json'),
    JSON.stringify({
      files: [{ path: 'src/registry/ui/fixture-button.tsx', content: BUTTON_SOURCE }],
    }),
  )
  writeFileSync(
    path.join(rDir, 'fixture-split.json'),
    JSON.stringify({
      files: [
        { path: 'src/registry/components/forms/fixture-split.tsx', content: SPLIT_SOURCE },
        { path: 'src/registry/components/forms/fixture-split.parts.tsx', content: SPLIT_PARTS },
        { path: 'src/registry/components/forms/fixture-split.helper.tsx', content: SPLIT_HELPER },
      ],
    }),
  )
  const demoDir = path.join(root, 'src', 'demos', 'buttons')
  mkdirSync(demoDir, { recursive: true })
  writeFileSync(path.join(demoDir, 'fixture-button.tsx'), BUTTON_DEMO)

  return { catalog: loadCatalog(path.join(root, 'agent-index.json')), root }
}

export { BUTTON_DEMO, BUTTON_SOURCE, SPLIT_HELPER, SPLIT_PARTS, SPLIT_SOURCE }
