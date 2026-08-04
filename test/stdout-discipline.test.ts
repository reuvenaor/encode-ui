import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    return e.isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
  })

/**
 * Twelve lines guarding the single most catastrophic regression class for a
 * stdio server: stdout IS the JSON-RPC wire, so one console.log anywhere on a
 * request path corrupts the protocol — and the symptom is a client that cannot
 * parse a response, nowhere near the line that caused it.
 *
 * Only the server path is checked. build.ts and verify.ts are CLIs whose whole
 * job is printing to stdout.
 */
test('nothing on the MCP server path writes to stdout', () => {
  const serverPath = [path.join(SRC, 'mcp.ts'), ...walk(path.join(SRC, 'mcp'))]
  // Without this the test passes vacuously if the layout ever moves.
  assert.ok(serverPath.length >= 7, `expected the server path, scanned ${serverPath.length} files`)
  const offenders: string[] = []

  for (const file of serverPath) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return
        if (/\bconsole\.(log|info|debug|warn|dir|table)\b|\bprocess\.stdout\.write\b/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim()}`)
        }
      })
  }

  assert.deepEqual(offenders, [], `stdout is the JSON-RPC wire:\n${offenders.join('\n')}`)
})

test('the modules the server imports do not write to stdout either', () => {
  // These run inside tool calls, so they are on the wire path too — unlike
  // build.ts / verify.ts, which are CLIs.
  const imported = [
    'catalog.ts',
    'config.ts',
    'db.ts',
    'embed.ts',
    'engine.ts',
    'engine-catalog.ts',
    'engine-db.ts',
    'engine-shared.ts',
    'engine-web.ts',
    'icons.ts',
    'items.ts',
    'registry-id.ts',
    'search.ts',
    'source-digests.ts',
    'text.ts',
    'web-index.ts',
  ]
  const offenders: string[] = []

  for (const name of imported) {
    readFileSync(path.join(SRC, name), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return
        if (/\bconsole\.(log|info|debug|dir|table)\b|\bprocess\.stdout\.write\b/.test(line)) {
          offenders.push(`${name}:${i + 1}  ${line.trim()}`)
        }
      })
  }

  assert.deepEqual(offenders, [], `stdout is the JSON-RPC wire:\n${offenders.join('\n')}`)
})
