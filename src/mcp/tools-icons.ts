// The icon tool: verified lucide names instead of guessed imports.
//
// The registry deliberately ships NO icon components — lucide-react IS the icon
// layer (a dependency of 43/200 items, auto-installed by the shadcn CLI). What
// agents get wrong is the NAME: lucide's 1,594 icons answer to three spellings
// each plus deprecated aliases, and a hallucinated import is a build error the
// agent only meets later. This tool resolves every plausible spelling against
// the vendored catalog and returns short context (tags/categories) so the pick
// can be made without another search.
import { matchIcons, resolveIconName, suggestIcons } from '../icons.ts'
import { buildIconsOutput } from './build.ts'
import { ToolError, annotations, guarded, ok } from './result.ts'
import { renderIcons } from './render.ts'
import { FindIconsInput, FindIconsOutput } from './schemas.ts'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ResolvedIcon } from '../icons.ts'
import type { RegistryContext } from './context.ts'

export function registerIconTools(server: McpServer, ctx: RegistryContext): void {
  server.registerTool(
    'find_icons',
    {
      title: 'Find or verify lucide icons',
      description:
        'Verified lucide-react icon names — never guess an icon import. Two modes (at least ' +
        'one of query/names/category is required): `query` searches names, curated tags, and ' +
        'categories by what the icon should depict ("shopping cart", "danger warning"); ' +
        '`names` verifies exact spellings and resolves legacy aliases (Home → House, with the ' +
        'deprecation flagged). `category` filters or browses. Hits carry the canonical name, ' +
        'the import identifier, and tag/category context; the registry itself ships no icon ' +
        `components — lucide-react ${ctx.icons.version} is the icon layer, auto-installed ` +
        'with any icon-using item.',
      inputSchema: FindIconsInput,
      outputSchema: FindIconsOutput.shape,
      annotations: annotations(ctx.engine.kind),
    },
    async ({ query, names, category, limit }): Promise<CallToolResult> =>
      guarded('find_icons', ctx.engine.kind, () => {
        if (category !== undefined && !ctx.icons.categories.has(category)) {
          throw new ToolError(
            `Unknown icon category "${category}". Valid: ${[...ctx.icons.categories].sort().join(', ')}.`,
          )
        }

        let resolved: ResolvedIcon[]
        let unknown: { name: string; suggestions: string[] }[] = []
        if (names !== undefined) {
          // Verification mode wins: exact spellings in, canonical truth out.
          resolved = []
          for (const asked of names) {
            const hit = resolveIconName(ctx.icons, asked)
            if (hit) resolved.push(hit)
            else unknown.push({ name: asked, suggestions: suggestIcons(ctx.icons, asked) })
          }
          if (resolved.length === 0 && unknown.length > 0) {
            throw new ToolError(
              unknown
                .map(
                  (u) =>
                    `No lucide icon named "${u.name}".` +
                    (u.suggestions.length > 0 ? ` Closest: ${u.suggestions.join(', ')}.` : ''),
                )
                .join(' ') + ' Or describe the concept via `query`.',
            )
          }
        } else {
          resolved = matchIcons(ctx.icons, query ?? '', category, limit).map((entry) => ({
            entry,
            alias: null,
          }))
          if (resolved.length === 0 && query !== undefined) {
            unknown = [{ name: query, suggestions: suggestIcons(ctx.icons, query) }]
          }
        }

        const out: FindIconsOutput = buildIconsOutput(ctx.icons.version, resolved, unknown)
        return ok(renderIcons(out), out)
      }),
  )
}
