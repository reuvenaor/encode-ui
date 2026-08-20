// The two vendored theme artifacts, tested over the REAL committed files.
// Both are generated upstream in encode-ui-registry (a clone here cannot
// regenerate them), so every assertion is a drift guard: hand-edit either file,
// or let the upstream core change without re-running `npm run themes`, and this
// goes red. Same contract as icons.test.ts guards src/lucide-icons.json.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COLOR_TOKENS,
  clampPresets,
  composeShadows,
  dEok,
  parseOklch,
  ratio,
  resolvePreset,
  validatePresets,
} from '../src/theme-engine-core.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CORE = path.resolve(HERE, '../src/theme-engine-core.ts')
const ANCHORS = path.resolve(HERE, '../theme-anchors.json')

interface AnchorFile {
  palettes: { name: string; label: string; anchor: { l: number; c: number; h: number } }[]
  palettesSha256: string
  engineCoreSha256: string
}

const anchors = JSON.parse(readFileSync(ANCHORS, 'utf8')) as AnchorFile
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// ── artifact integrity ───────────────────────────────────────────────────────

test('the vendored core hashes to what theme-anchors.json recorded', () => {
  assert.equal(
    sha256(readFileSync(CORE, 'utf8')),
    anchors.engineCoreSha256,
    'theme-engine-core.ts and theme-anchors.json disagree — regenerate both with ' +
      '`npm run themes` in the encode-ui-registry checkout',
  )
})

test('the anchor records hash to what theme-anchors.json recorded', () => {
  // Mirrors the generator's serialization exactly: one record per line, indented
  // four spaces, comma-joined. Reformatting the file by hand reddens this.
  const serialized = anchors.palettes.map((p) => `    ${JSON.stringify(p)}`).join(',\n')
  assert.equal(sha256(serialized), anchors.palettesSha256)
})

test('the core stays dependency-free — the reason it can be vendored at all', () => {
  const specifiers = readFileSync(CORE, 'utf8').match(/^\s*(?:import|export)\s+.*\bfrom\b.*$/gm)
  assert.equal(specifiers, null, `vendored core must import nothing; found: ${specifiers?.join(', ')}`)
})

test('every anchor is a plausible OKLCH point', () => {
  assert.ok(anchors.palettes.length > 40, `only ${anchors.palettes.length} palettes — truncated?`)
  for (const { name, label, anchor } of anchors.palettes) {
    assert.ok(name && label, `palette record missing name/label: ${JSON.stringify(anchor)}`)
    assert.ok(anchor.l >= 0 && anchor.l <= 1, `${name}: L out of range (${anchor.l})`)
    assert.ok(anchor.c >= 0 && anchor.c < 0.5, `${name}: C out of range (${anchor.c})`)
    assert.ok(anchor.h >= 0 && anchor.h < 360, `${name}: H out of range (${anchor.h})`)
  }
})

test('palette names are unique', () => {
  const names = anchors.palettes.map((p) => p.name)
  assert.equal(new Set(names).size, names.length)
})

// ── the math still works after vendoring ─────────────────────────────────────

test('contrast math reproduces the WCAG extremes', () => {
  const white = parseOklch('oklch(1 0 0)')
  const black = parseOklch('oklch(0 0 0)')
  assert.ok(white && black)
  // Pure black on pure white is 21:1 by definition — the calibration point.
  assert.equal(Math.round(ratio(white, black) * 100) / 100, 21)
  assert.equal(ratio(white, white), 1)
})

test('composeShadows emits the full 8-step ramp in order', () => {
  const ramp = composeShadows({ 'shadow-color': 'oklch(0 0 0)', 'shadow-opacity': '0.1' })
  assert.deepEqual(Object.keys(ramp), [
    'shadow-2xs',
    'shadow-xs',
    'shadow-sm',
    'shadow',
    'shadow-md',
    'shadow-lg',
    'shadow-xl',
    'shadow-2xl',
  ])
  // sm..xl are two-layer; 2xs/xs/2xl are single.
  assert.ok(ramp['shadow-sm']?.includes(','))
  assert.ok(!ramp['shadow-2xs']?.includes(','))
})

test('dEok is zero for a point against itself and grows with distance', () => {
  const a = { L: 0.5, C: 0.2, H: 260 }
  assert.equal(dEok(a, a), 0)
  assert.ok(dEok(a, { L: 0.5, C: 0.2, H: 280 }) > 0)
})

test('validatePresets rejects an incomplete entry rather than throwing', () => {
  const { errors } = validatePresets({ probe: { character: 'x', light: {}, dark: {} } })
  assert.ok(errors.length > 0)
  assert.ok(errors.some((e) => e.includes('missing colour')))
})

test('a complete entry resolves and clamps to an AA-clean surface', () => {
  // Black on white in every slot: trivially passes AA, so the clamp must be a
  // no-op. That makes this a regression pin on clamp *inaction*, which is what
  // a well-designed brand entry should also produce.
  const mode: Record<string, string> = {}
  for (const tok of COLOR_TOKENS) mode[tok] = tok.endsWith('-foreground') ? 'oklch(0 0 0)' : 'oklch(1 0 0)'
  mode.foreground = 'oklch(0 0 0)'
  const entry = { character: 'probe', light: { ...mode, radius: '0.5rem' }, dark: { ...mode } }

  assert.deepEqual(validatePresets({ probe: entry }).errors, [])
  const resolved = resolvePreset(entry)
  assert.equal(resolved.light.radius, '0.5rem')
  assert.ok(resolved.light['shadow-sm'], 'the ramp must always be present')

  const { report } = clampPresets({ probe: { light: resolved.light, dark: resolved.dark } })
  assert.deepEqual(report.residuals, [])
  assert.deepEqual(report.log, [])
})

// ── drift against the upstream checkout, when there is one ───────────────────

/**
 * The real guard: editing src/lib/theme-engine-core.ts upstream without
 * re-running `npm run themes` must go red. Skipped from the published tarball,
 * which has no registry checkout above it.
 */
test('the vendored core matches the registry source, banner aside', () => {
  const upstream = path.resolve(HERE, '../../src/lib/theme-engine-core.ts')
  if (!existsSync(upstream)) return
  const vendored = readFileSync(CORE, 'utf8')
  const source = readFileSync(upstream, 'utf8')
  assert.ok(
    vendored.endsWith(source),
    'vendored core is not a verbatim copy of src/lib/theme-engine-core.ts — ' +
      'run `npm run themes` in the registry checkout',
  )
})
