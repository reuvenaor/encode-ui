// Server composition. No handlers live here — each tool group registers itself,
// so this file stays a table of contents for the surface.
import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildInstructions } from './instructions.ts'
import { registerRegistryPrompts } from './prompts.ts'
import { registerCatalogResource } from './resources.ts'
import { registerCatalogTools } from './tools-catalog.ts'
import { registerIconTools } from './tools-icons.ts'
import { registerSearchTools } from './tools-search.ts'
import { registerThemeTools } from './tools-theme.ts'
import type { RegistryContext } from './context.ts'

// Matches the npm package and the bin, so a host's server list, the prompt
// slash commands, and the install command all read the same word.
export const SERVER_NAME = 'encode-ui'
// Read from package.json at load time — `../../` resolves from both src/mcp/
// and dist/mcp/ — so the handshake and `--version` cannot lag a release bump:
// 0.5.1, 0.5.2 and 0.6.0 all shipped announcing 0.5.0 from a literal here.
export const SERVER_VERSION: string = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version

export function buildRegistryServer(ctx: RegistryContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: buildInstructions(ctx.engine.kind) },
  )
  registerSearchTools(server, ctx)
  registerCatalogTools(server, ctx)
  registerIconTools(server, ctx)
  registerThemeTools(server, ctx)
  registerRegistryPrompts(server, ctx)
  registerCatalogResource(server, ctx)
  return server
}
