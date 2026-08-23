// The plugin's naming surface, pinned. Claude Code derives every user-visible
// handle from three strings we own — the plugin name (plugin.json), the server
// key (plugin/.mcp.json), and the marketplace name (marketplace.json) — and a
// rename in one place silently breaks references in the others: the dispatcher
// skill names the namespaced validate_theme tool, and the two prompt-wrapper
// skills mirror src/mcp/prompts.ts verbatim. Each assertion here failed a
// review question once ("why does the skill name a tool that no longer
// exists?") before it was written down.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSetupProjectPrompt, buildUseRegistryPrompt } from '../src/mcp/prompts.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8')
const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(read(rel)) as Record<string, unknown>

const MIRROR_MARKER =
  '<!-- MIRROR: verbatim builder output — test/plugin-naming.test.ts pins this against src/mcp/prompts.ts -->'

test('the three name sources hold the shipped values', () => {
  const plugin = readJson('plugin/.claude-plugin/plugin.json')
  assert.equal(plugin.name, 'encode-ui')

  const marketplace = readJson('.claude-plugin/marketplace.json')
  assert.equal(marketplace.name, 'encode-ui-theme-gen')
  const entries = marketplace.plugins as Array<{ name: string; source: string }>
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.name, 'encode-ui')
  assert.equal(entries[0]?.source, './plugin')

  const mcp = readJson('plugin/.mcp.json')
  const servers = mcp.mcpServers as Record<string, { command: string; args: string[] }>
  // ONE server, keyed `registry` — the key is the second half of the
  // host-derived names (`plugin:encode-ui:registry`,
  // `mcp__plugin_encode-ui_registry__*`). `encode-ui` here would stutter.
  assert.deepEqual(Object.keys(servers), ['registry'])
  // Flag-free on purpose: the plugin runs the zero-setup web engine.
  assert.deepEqual(servers.registry, { command: 'npx', args: ['-y', 'encode-ui'] })
})

test('the dispatcher skill names the tool the server key actually mints', () => {
  const mcp = readJson('plugin/.mcp.json')
  const key = Object.keys(mcp.mcpServers as Record<string, unknown>)[0]
  const skill = read('plugin/skills/brand-theme-designer/SKILL.md')
  assert.ok(
    skill.includes(`mcp__plugin_encode-ui_${key}__validate_theme`),
    'dispatcher must name the namespaced validate_theme tool derived from the .mcp.json key',
  )
})

test('the prompt-wrapper skills mirror the builders verbatim', () => {
  const idx = readJson('agent-index.json')
  const registry = idx.registry as { scope: string; homepage: string }
  const id = { scope: registry.scope, homepage: registry.homepage }

  // kind 'web' because plugin/.mcp.json passes no engine flag — the wrapper
  // must carry the web engine's honesty rules, not the db engine's.
  const cases: Array<[string, string]> = [
    ['plugin/skills/use-registry/SKILL.md', buildUseRegistryPrompt(id, undefined, 'web')],
    ['plugin/skills/setup-project/SKILL.md', buildSetupProjectPrompt(id, undefined)],
  ]
  for (const [rel, expected] of cases) {
    const file = read(rel)
    const at = file.indexOf(MIRROR_MARKER)
    assert.ok(at >= 0, `${rel} must carry the MIRROR marker`)
    const body = file.slice(at + MIRROR_MARKER.length)
    assert.equal(body, `\n\n${expected}\n`, `${rel} drifted from src/mcp/prompts.ts`)
  }
})
