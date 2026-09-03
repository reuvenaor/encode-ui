// The handshake version follows package.json — never a literal. Three releases
// (0.5.1, 0.5.2, 0.6.0) shipped announcing 0.5.0 before this pin existed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SERVER_NAME, SERVER_VERSION } from '../src/mcp/server.ts'

test('SERVER_VERSION and SERVER_NAME follow package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    name: string
    version: string
  }
  assert.equal(SERVER_VERSION, pkg.version)
  assert.equal(SERVER_NAME, pkg.name)
  assert.match(SERVER_VERSION, /^\d+\.\d+\.\d+/)
})
