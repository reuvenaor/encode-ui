// The one MCP resource: the whole catalog as a compact markdown projection —
// the deliberate "load everything" path (≈20k tokens for ~350 items) that
// complements the cheap default (search_components, ~500 tokens a call).
// Served on BOTH engines from the committed agent-index.json — the catalog
// ctx already loaded fail-loud at startup, so registration takes it as an
// argument and can no longer skip silently on a corrupt artifact. Reading it
// is a caller's explicit choice, never something a tool result pays for.
//
// Kept lean on purpose: name, aliases, description, and a couple of flags per
// line. No URLs (llms.txt carries those), no keywords (they are BM25 fodder
// for the engine — an agent reading descriptions in context needs no hints).
import type { Catalog } from '../catalog.ts'
import type { CatalogSyncStatus, WebIndexSource } from '../engine.ts'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RegistryContext } from './context.ts'

export const CATALOG_RESOURCE_URI = 'encode-ui://catalog'

export function renderCatalogMarkdown(
  catalog: Catalog,
  sync: CatalogSyncStatus = 'in-sync',
  indexSource?: WebIndexSource,
): string {
  const lines: string[] = [
    `# encode-ui registry catalog (@${catalog.identity.scope})`,
    '',
    `${catalog.items.length} items · ${catalog.groups.length} groups · registry hash ${catalog.registryHash}`,
    `Install any item: npx shadcn@latest add @${catalog.identity.scope}/<name>`,
    'Per-item metadata: get_component · source bodies: get_component_source.',
    ...(sync === 'in-sync'
      ? []
      : [
          '',
          '> Note: this snapshot comes from the committed agent-index.json and may not',
          '> match the live db index the tools answer from — the server operator can',
          '> realign them by rebuilding the index (`npm run build:index` in registry/rag).',
        ]),
    // The web engine's index and its BODIES come from different places when the
    // origin was unreachable at startup: this listing is off disk while
    // get_component_source still fetches live. The two notes never co-occur —
    // on web, sync is always in-sync; on db, indexSource is undefined.
    ...(indexSource === 'cache'
      ? [
          '',
          '> Note: this snapshot came from the local disk cache — the deployed registry',
          '> was unreachable when this server started — so it may be older than the live',
          '> registry. Restart the server with network access to refresh it.',
        ]
      : indexSource === 'seed'
        ? [
            '',
            '> Note: this snapshot is the copy BUNDLED with this package: the deployed',
            '> registry was unreachable at startup and no cache was warm. It may be older',
            '> than the live registry, and source bodies cannot be fetched while the',
            '> origin is unreachable. Restart with network access to refresh it.',
          ]
        : []),
    '',
  ]
  const byGroup = new Map<string, (typeof catalog.items)[number][]>()
  for (const item of catalog.items) {
    const slug = item.group?.slug ?? '(ungrouped)'
    const list = byGroup.get(slug)
    if (list) list.push(item)
    else byGroup.set(slug, [item])
  }
  for (const group of catalog.groups) {
    const items = byGroup.get(group.slug) ?? []
    if (items.length === 0) continue
    lines.push(`## ${group.label} (${items.length}) — ${group.description}`, '')
    for (const item of items) {
      const aka = item.aliases.length > 0 ? ` (aka ${item.aliases.join(', ')})` : ''
      const flags = [
        item.motion ? 'animated' : null,
        item.pure ? 'dependency-free' : null,
        item.gated ? 'gated' : null,
      ].filter((f): f is string => f !== null)
      const suffix = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
      lines.push(`- ${item.name}${aka}: ${item.description}${suffix}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Registers the resource the server instructions unconditionally advertise.
 * No internal load and no catch: ctx.catalog was loaded fail-loud at startup,
 * so a corrupt shipped artifact stops the server instead of leaving every
 * `resources/read` failing "not found" with zero stderr trace of why.
 */
export function registerCatalogResource(server: McpServer, ctx: RegistryContext): void {
  const { catalog, catalogSync, engine } = ctx
  let rendered: string | null = null
  server.registerResource(
    'catalog',
    CATALOG_RESOURCE_URI,
    {
      title: 'Full component catalog',
      description:
        `Every component in one view — name, aliases, description, flags, grouped by ` +
        `taxonomy (${catalog.items.length} items, ≈20k tokens). Read it for browse/planning/` +
        `"what exists?" questions; prefer search_components for targeted lookups.`,
      mimeType: 'text/markdown',
    },
    (uri) => {
      rendered ??= renderCatalogMarkdown(catalog, catalogSync, engine.meta.indexSource)
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: rendered }],
      }
    },
  )
}
