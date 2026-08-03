// Catalog tools: get_component, get_component_source, list_groups, get_install_command.
import { installCommand, qualifiedName, stripScope } from '../registry-id.ts'
import {
  buildComponentOutput,
  buildComponentsOutput,
  buildGroupsOutput,
  buildInstallOutput,
  gatedNames,
} from './build.ts'
import { INDEX_REMEDY, ToolError, annotations, guarded, ok, textOnly } from './result.ts'
import {
  renderComponent,
  renderComponents,
  renderGroups,
  renderInstall,
  renderSource,
} from './render.ts'
import { assertKnown, assertKnownGroup } from './tools-search.ts'
import {
  GetComponentInput,
  GetComponentOutput,
  GetComponentSourceInput,
  GetInstallCommandInput,
  GetInstallCommandOutput,
  ListComponentsInput,
  ListComponentsOutput,
  ListGroupsOutput,
} from './schemas.ts'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { EngineDetail } from '../engine.ts'
import type { RegistryContext } from './context.ts'

/** The two-stage miss: unknown name → did-you-mean; known-but-unreadable → corrupt. */
function requireDetail(ctx: RegistryContext, clean: string, asked: string): EngineDetail {
  // Accepted spellings resolve exactly like search's short-circuit — so
  // get_component("modal") lands on dialog instead of a did-you-mean miss.
  // Downstream code uses detail.name (the canonical spelling), never `clean`.
  const detail = ctx.engine.detail(ctx.engine.resolveName(clean) ?? clean)
  if (detail) return detail
  // Throws with "did you mean" when the name is simply unknown — a one-turn
  // correction, where {found:false} would only force an anyOf into the JSON
  // Schema to buy the same behaviour.
  assertKnown(ctx.engine, clean, asked)
  // Reached only when the engine lists the name but cannot read its record,
  // i.e. the index disagrees with itself.
  throw new ToolError(
    `The index lists "${clean}" but cannot read its row. It appears corrupt; ` +
      INDEX_REMEDY[ctx.engine.kind],
  )
}

export function registerCatalogTools(server: McpServer, ctx: RegistryContext): void {
  // Derived once at registration — see the same line in tools-search.ts.
  const gated = gatedNames(ctx.catalog)

  server.registerTool(
    'get_component',
    {
      title: 'Get a encode-ui component',
      description:
        'Metadata for one component by name: description, group, dependencies, ' +
        'provenance/license, and the install command. Reports the byte size of the ' +
        'source and demo without sending them — fetch those from get_component_source ' +
        'once you know what they cost.',
      inputSchema: GetComponentInput,
      outputSchema: GetComponentOutput.shape,
      annotations: annotations(ctx.engine.kind),
    },
    async ({ name }): Promise<CallToolResult> =>
      guarded('get_component', ctx.engine.kind, () => {
        const detail = requireDetail(ctx, stripScope(ctx.identity, name), name)
        const out: GetComponentOutput = buildComponentOutput(
          ctx.identity,
          detail,
          ctx.engine.dependencyInfo(detail.name),
          gated,
        )
        return ok(renderComponent(out), out)
      }),
  )

  // DELIBERATELY has no outputSchema, and must keep it that way.
  //
  // The SDK is all-or-nothing per tool: declaring one forces structuredContent,
  // and a host that renders the structured payload (Claude Code does, discarding
  // the text block) would then show 27 KB of TSX with every newline escaped —
  // more tokens, no syntax highlighting, harder for a model to read. Code is
  // prose here on purpose.
  server.registerTool(
    'get_component_source',
    {
      title: 'Get a component’s source',
      description:
        'Every TSX file one component ships, or its demo usage example, in fenced code ' +
        'blocks. A multi-file component returns ALL of its files — the public module ' +
        'plus every sibling it imports (.parts.tsx pairs, block modules) — because the ' +
        'entry file alone does not compile. Check sourceBytes/demoBytes on get_component ' +
        'first if size matters. Returns code as text rather than a JSON field, so it ' +
        'stays readable.',
      inputSchema: GetComponentSourceInput,
      // The one tool that egresses on the web engine: it fetches the payload
      // from the deployed registry, with ENCODE_UI_TOKEN when one is set.
      annotations: annotations(ctx.engine.kind, { network: true }),
    },
    async ({ name, part }): Promise<CallToolResult> =>
      guarded('get_component_source', ctx.engine.kind, async () => {
        const detail = requireDetail(ctx, stripScope(ctx.identity, name), name)
        const canonical = detail.name

        // Sync on the local engines, a fetch on the web engine — one await
        // covers both (the interface returns SourceResult | Promise<…>).
        const files = await ctx.engine.sourceOf(canonical, part)
        if (files === 'gated') {
          // Web engine only: the item requires a registry account (known from
          // the index before any fetch, or the origin answered 401).
          throw new ToolError(
            `"${canonical}" is a gated item — its ${part} requires a registry account. ` +
              `Sign in at ${ctx.identity.homepage} to copy a token, export it as ` +
              'ENCODE_UI_TOKEN in this MCP server’s environment, and restart; the same ' +
              `token authorizes the CLI install: ${detail.installCmd}`,
          )
        }
        if (files === 'unavailable') {
          // Catalog engine without a registry checkout around it (a detached
          // tarball install): metadata still works, bodies cannot be served.
          throw new ToolError(
            `The ${part} for "${canonical}" is not available from this install — the catalog ` +
              'engine serves code bodies from the registry checkout, which is not present. ' +
              `Fetch the payload at ${ctx.identity.homepage}/r/${canonical}.json, or install ` +
              `directly: ${detail.installCmd}`,
          )
        }
        if (files === 'drifted') {
          // Same trichotomy, different store: on the web engine the origin
          // 404'd a part the index promises; on the catalog engine the
          // checkout IS present — telling the operator it's missing (the old
          // conflated answer) sent them chasing the wrong problem.
          throw new ToolError(
            ctx.engine.kind === 'web'
              ? `The registry origin has no ${part} payload for "${canonical}" (404) — the ` +
                'fetched index may be newer than the deployment (or this origin has not ' +
                'published demo payloads yet). Retry later, or install directly: ' +
                detail.installCmd
              : `The registry checkout is present but the ${part} file for "${canonical}" is ` +
                'missing or renamed — the checkout has drifted from the catalog since it ' +
                'was generated. The server operator can realign them by running ' +
                '`npm run registry:build` at the registry root. Meanwhile: fetch the payload ' +
                `at ${ctx.identity.homepage}/r/${canonical}.json, or install directly: ${detail.installCmd}`,
          )
        }
        if (files === null) {
          // A missing part used to omit a section silently, which reads as the
          // tool having ignored the request.
          const other = part === 'source' ? 'demo' : 'source'
          const otherExists = (part === 'source' ? detail.demoBytes : detail.sourceBytes) !== null
          throw new ToolError(
            `Component "${canonical}" has no ${part}.` +
              (otherExists ? ` Its ${other} is available — call again with part:"${other}".` : ''),
          )
        }
        return textOnly(renderSource(qualifiedName(ctx.identity, canonical), part, files))
      }),
  )

  server.registerTool(
    'list_groups',
    {
      title: 'List component groups',
      description:
        'The registry taxonomy with a component count per group. Use a slug from here as the ' +
        '`group` filter on search_components, or enumerate a group in full with list_components.',
      inputSchema: {},
      outputSchema: ListGroupsOutput.shape,
      annotations: annotations(ctx.engine.kind),
    },
    async (): Promise<CallToolResult> =>
      guarded('list_groups', ctx.engine.kind, () => {
        const out: ListGroupsOutput = buildGroupsOutput(ctx.engine.kind, ctx.engine.listGroups())
        return ok(renderGroups(out), out)
      }),
  )

  server.registerTool(
    'list_components',
    {
      title: 'List a group’s components',
      description:
        'Every component in one group — full membership, not a ranked sample. Search always ' +
        'returns its top k, so "list ALL X" and "does the registry have X?" need this instead: ' +
        'enumerate, then judge the descriptions yourself. Returns name, title, and description ' +
        'per item; get_component has the details.',
      inputSchema: ListComponentsInput,
      outputSchema: ListComponentsOutput.shape,
      annotations: annotations(ctx.engine.kind),
    },
    async ({ group, dependencyFree }): Promise<CallToolResult> =>
      guarded('list_components', ctx.engine.kind, () => {
        assertKnownGroup(ctx.engine, group)
        const rows = ctx.engine
          .listComponents(group)
          .filter((r) => dependencyFree === undefined || r.pure === dependencyFree)
        const out: ListComponentsOutput = buildComponentsOutput(ctx.engine.kind, group, rows)
        return ok(renderComponents(out), out)
      }),
  )

  server.registerTool(
    'get_install_command',
    {
      title: 'Get the install command',
      description:
        'One `npx shadcn@latest add` command installing all the named components at once. ' +
        'Duplicates collapse; names with no such component come back under `unknown`.',
      inputSchema: GetInstallCommandInput,
      outputSchema: GetInstallCommandOutput.shape,
      annotations: annotations(ctx.engine.kind),
    },
    async ({ names }): Promise<CallToolResult> =>
      guarded('get_install_command', ctx.engine.kind, () => {
        // Aliases resolve here too: ["modal", "dialog"] collapses to ONE
        // @encode-ui/dialog rather than reporting "modal" unknown.
        const clean = names
          .map((n) => stripScope(ctx.identity, n))
          .map((n) => ctx.engine.resolveName(n) ?? n)
        const known = ctx.engine.knownNames()
        const found = [...new Set(clean.filter((n) => known.has(n)))]
        const unknown = [...new Set(clean.filter((n) => !known.has(n)))]

        // Partial success is real success: `command` covers what exists and
        // `unknown` names the rest. But when NOTHING resolved there is no command
        // to give, and the old '(nothing to install)' was the worst possible
        // answer — a SUCCESS whose payload is a parenthetical a model might paste
        // into a shell.
        if (found.length === 0) {
          throw new ToolError(
            `None of these are encode-ui components: ${unknown.join(', ')}. ` +
              'Use search_components to find the right names.',
          )
        }
        const out: GetInstallCommandOutput = buildInstallOutput(
          ctx.identity,
          installCommand(ctx.identity, found),
          found,
          unknown,
        )
        return ok(renderInstall(out), out)
      }),
  )
}
