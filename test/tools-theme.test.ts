// validate_theme, driven through a real Client over the real vendored engine.
//
// The load-bearing test is the ensign parity case: a theme this registry
// actually shipped must come back through the MCP surface with the same numbers
// its brand guide records. If the vendored core ever diverges from the one the
// site builds with, that assertion is what notices.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadIconCatalog } from '../src/icons.ts'
import { loadAnchors } from '../src/theme-anchors.ts'
import { loadCatalog } from '../src/catalog.ts'
import { createDbEngineFromDb } from '../src/engine-db.ts'
import { buildRegistryServer } from '../src/mcp/server.ts'
import { COLOR_TOKENS } from '../src/theme-engine-core.ts'
import { ValidateThemeOutput } from '../src/mcp/schemas.ts'
import { buildFixtureIndex, FIXTURE_ID } from './fixtures/index-fixture.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ANCHORS = path.resolve(HERE, '../theme-anchors.json')

const db = buildFixtureIndex([{ name: 'alpha-button', group: 'buttons' }])
const server = buildRegistryServer({
  engine: createDbEngineFromDb(db),
  identity: FIXTURE_ID,
  icons: loadIconCatalog(),
  anchors: loadAnchors(),
  catalog: loadCatalog(),
  catalogSync: 'in-sync',
})
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
const client = new Client({ name: 'theme-test', version: '0' })
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

after(async () => {
  await client.close()
  await server.close()
  db.close()
})

const call = async (args: Record<string, unknown>) => {
  const r = await client.callTool({ name: 'validate_theme', arguments: args })
  return {
    isError: Boolean(r.isError),
    text: (r.content as { text?: string }[])[0]?.text ?? '',
    out: r.structuredContent ? ValidateThemeOutput.parse(r.structuredContent) : null,
  }
}

/** A minimal AA-clean entry: black text on white surfaces in every slot. */
function monoEntry(): { light: Record<string, string>; dark: Record<string, string> } {
  const mode: Record<string, string> = {}
  for (const tok of COLOR_TOKENS) {
    mode[tok] = tok.endsWith('-foreground') ? 'oklch(0 0 0)' : 'oklch(1 0 0)'
  }
  mode.foreground = 'oklch(0 0 0)'
  mode.primary = 'oklch(0.45 0.15 30)'
  mode['primary-foreground'] = 'oklch(1 0 0)'
  return { light: { ...mode, radius: '0.5rem' }, dark: { ...mode } }
}

// ── the parity case ──────────────────────────────────────────────────────────

/**
 * Skipped from the published tarball, which has no registry checkout above it.
 */
test('a shipped theme reproduces the numbers in its own brand guide', async () => {
  const presetsPath = path.resolve(HERE, '../../src/themes/presets.json')
  if (!existsSync(presetsPath)) return
  const presets = JSON.parse(readFileSync(presetsPath, 'utf8')) as Record<
    string,
    { character: string; light: Record<string, string>; dark: Record<string, string> }
  >
  const ensign = presets.ensign
  if (!ensign) return

  // presets.json names font FAMILIES, resolved against the registry's own font
  // manifest. A consumer has no manifest, so the tool takes full stacks — which
  // is what the shipped payload emits anyway.
  const light = { ...ensign.light }
  light['font-sans'] = 'Manrope, ui-sans-serif, system-ui, sans-serif'
  light['font-mono'] = "'IBM Plex Mono', ui-monospace, monospace"

  const { out } = await call({ slug: 'ensign', character: ensign.character, light, dark: ensign.dark })
  assert.ok(out)
  assert.equal(out.valid, true)
  assert.deepEqual(out.errors, [])
  // The guide records "0 adjustments, 0 residuals" — the clamp must not design.
  assert.deepEqual(out.contrast.clampLog, [])
  assert.deepEqual(out.contrast.residuals, [])
  assert.deepEqual(out.contrast.skips, [])

  // …and the uniqueness reading the guide quotes.
  const nearest = out.uniqueness.nearest[0]
  assert.equal(nearest?.name, 'starry-night')
  assert.equal(nearest?.dEok, 0.1123)
  assert.equal(nearest?.dHue, 0.4)
  // ensign is itself in the catalogue; matching itself at ΔE 0 would be noise.
  assert.ok(!out.uniqueness.nearest.some((n) => n.name === 'ensign'))
  assert.equal(out.uniqueness.defaultBlue, true, 'the brief entered the band deliberately')

  // The payload shape a consumer pastes.
  assert.ok(out.cssVars)
  assert.equal(out.cssVars.light.primary, 'oklch(0.4120 0.2060 263)')
  assert.ok(out.cssVars.theme?.['tracking-normal'])
  assert.deepEqual(out.css, {
    '@layer base': { body: { 'letter-spacing': 'var(--tracking-normal)' } },
  })
})

// ── reports, not throws ──────────────────────────────────────────────────────

test('an incomplete entry reports its errors instead of failing the call', async () => {
  const { isError, out } = await call({ slug: 'probe', light: { primary: 'oklch(0.5 0.2 30)' }, dark: {} })
  assert.equal(isError, false, 'a schema failure is an answer, not a tool error')
  assert.ok(out)
  assert.equal(out.valid, false)
  assert.ok(out.errors.length > 0)
  assert.ok(out.errors.some((e) => e.includes('missing colour')))
  assert.equal(out.cssVars, null)
  // Uniqueness still lands: it needs only `primary`, and that is the number a
  // designer wants while the palette can still move.
  assert.ok(out.uniqueness.anchor)
  assert.ok(out.uniqueness.nearest.length > 0)
})

test('a failing contrast pair is reported, never silently clamped away', async () => {
  const entry = monoEntry()
  // Mid-grey on white is ~2.8:1 — repairable, so it lands in clampLog.
  entry.light['muted-foreground'] = 'oklch(0.7 0 0)'
  const { out } = await call({ slug: 'probe', ...entry })
  assert.ok(out)
  assert.ok(out.contrast.clampLog.length > 0, 'the clamp must say what it would move')
  assert.ok(out.contrast.clampLog.some((l) => l.includes('muted-foreground')))
  // Repairable, so nothing is left under AA and the entry still ships.
  assert.deepEqual(out.contrast.residuals, [])
  assert.equal(out.valid, true)
})

test('every measured pair carries its ratio, worst first', async () => {
  const { out } = await call({ slug: 'probe', ...monoEntry() })
  assert.ok(out)
  assert.equal(out.contrast.target, 4.5)
  assert.ok(out.contrast.pairs.length > 20, `only ${out.contrast.pairs.length} pairs measured`)
  assert.ok(out.contrast.pairs.every((p) => p.passes === p.ratio >= 4.5))
  const ratios = out.contrast.pairs.map((p) => p.ratio)
  assert.deepEqual(ratios, [...ratios].sort((a, b) => a - b), 'worst first')
  assert.ok(out.contrast.pairs.some((p) => p.mode === 'dark'), 'both modes are checked')
})

test('a bare font family is refused with the fix in the message', async () => {
  const entry = monoEntry()
  entry.light['font-sans'] = 'Inter'
  const { isError, text } = await call({ slug: 'probe', ...entry })
  assert.equal(isError, true)
  assert.match(text, /full CSS stack/)
  assert.match(text, /ui-sans-serif/)
  assert.ok(!text.includes('src/themes'), 'no registry-internal path reaches the model')
})

test('an unknown key is rejected rather than silently dropped', async () => {
  const entry = monoEntry()
  entry.light['not-a-token'] = 'oklch(0.5 0 0)'
  const { out } = await call({ slug: 'probe', ...entry })
  assert.ok(out)
  assert.ok(out.errors.some((e) => e.includes('not-a-token')))
})

test('a typo in the arguments is rejected, not swallowed', async () => {
  const { isError } = await call({ slug: 'probe', ...monoEntry(), lite: {} })
  assert.equal(isError, true)
})

// ── the read-only promise ────────────────────────────────────────────────────

test('validating writes nothing — not even the artifact it reads', async () => {
  const before = statSync(ANCHORS).mtimeMs
  await call({ slug: 'probe', ...monoEntry() })
  assert.equal(statSync(ANCHORS).mtimeMs, before)
})

test('the prose channel never contradicts the structured one', async () => {
  const entry = monoEntry()
  entry.light['muted-foreground'] = 'oklch(0.7 0 0)'
  const { text, out } = await call({ slug: 'probe', ...entry })
  assert.ok(out)
  assert.match(text, /^probe: PASSES/)
  assert.match(text, /Uniqueness:/)
  assert.ok(text.includes(String(out.contrast.pairs.length)), 'the pair count agrees')
})
