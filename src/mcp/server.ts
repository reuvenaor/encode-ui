// Server composition. No handlers live here — each tool group registers itself,
// so this file stays a table of contents for the surface.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildInstructions } from './instructions.ts'
import { registerRegistryPrompts } from './prompts.ts'
import { registerCatalogResource } from './resources.ts'
import { registerCatalogTools } from './tools-catalog.ts'
import { registerIconTools } from './tools-icons.ts'
import { registerSearchTools } from './tools-search.ts'
import type { RegistryContext } from './context.ts'

// Matches the npm package and the bin, so a host's server list, the prompt
// slash commands, and the install command all read the same word.
export const SERVER_NAME = 'encode-ui'
export const SERVER_VERSION = '0.4.0'

export function buildRegistryServer(ctx: RegistryContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: buildInstructions(ctx.engine.kind) },
  )
  registerSearchTools(server, ctx)
  registerCatalogTools(server, ctx)
  registerIconTools(server, ctx)
  registerRegistryPrompts(server, ctx)
  registerCatalogResource(server, ctx)
  return server
}
