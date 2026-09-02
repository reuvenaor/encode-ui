// Retrieval tools: search_components, find_similar.
import { stripScope } from '../registry-id.ts'
import { buildSearchOutput, buildSimilarOutput, gatedNames } from './build.ts'
import { INDEX_REMEDY, ToolError, annotations, guarded, ok } from './result.ts'
import { renderSearch, renderSimilar } from './render.ts'
import {
  FindSimilarInput,
  FindSimilarOutput,
  SearchComponentsInput,
  SearchComponentsOutput,
} from './schemas.ts'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { RegistryEngine } from '../engine.ts'
import type { RegistryContext } from './context.ts'

/** Shared by both tools: a name that missed becomes a correctable error. */
function assertKnown(engine: RegistryEngine, clean: string, asked: string): void {
  if (engine.knownNames().has(clean)) return
  const near = engine.suggestNames(clean)
  throw new ToolError(
    `No component named "${asked}".` +
      (near.length > 0
        ? ` Closest: ${near.join(', ')}.`
        : ' Use search_components to find one by description.'),
  )
}

/**
 * Shared by search_components and list_components: an unknown slug is a wrong
 * question (the caller can fix it), never an empty answer.
 */
function assertKnownGroup(engine: RegistryEngine, group: string): void {
  if (engine.groupSlugs().has(group)) return
  throw new ToolError(
    `Unknown group "${group}". Valid slugs: ${[...engine.groupSlugs()].sort().join(', ')}. ` +
      'Call list_groups for labels and counts.',
  )
}

/** Per-engine copy: the db text promises a calibrated cosine, which the
 *  catalog engine does not have — its description must not either. */
const SEARCH_DESCRIPTIONS: Record<RegistryEngine['kind'], string> = {
  db:
    'Find React components in the encode-ui registry by intent, behaviour, or name. ' +
    'Hybrid semantic + lexical search over each component’s description, source, and demo. ' +
    'Use natural language ("something that shows a loading placeholder") — it does not need ' +
    'keywords. Every hit carries the exact install command. `score` is a fusion rank ' +
    '(scoreKind "rrf"), comparable only within one result set; `cosine` is an absolute ' +
    'similarity that IS comparable across searches (null when a hit had no dense evidence). ' +
    'Measured guide: right answers average ≈0.77 top-hit cosine and nothing-matches queries ' +
    '≈0.63, with overlapping ranges — read a low top cosine as a hint to enumerate, never proof. ' +
    'Caveat: a match is evidence of text overlap, not capability — lexical matching ignores ' +
    'negation (a component described as "with no image asset" still ranks for "image"), and ' +
    'a hit matching many matchedOn facets matched in many places; it is not more true. Read ' +
    'the descriptions before trusting hits; for "find ALL X" use list_components instead.',
  catalog:
    'Find React components in the encode-ui registry by name, alias, or behaviour. ' +
    'Lexical relevance ranking (catalog engine) over each component’s name, title, ' +
    'description, and curated keywords/aliases — "modal", "toast", or "something that ' +
    'shows a loading placeholder" all work. Every hit carries the exact install command. ' +
    '`score` is a relevance rank (scoreKind "lexical"), comparable only within one result ' +
    'set, and `cosine` is always null on this engine — no score here is calibrated, so ' +
    'never read one as proof of presence or absence. Caveats: a ranked retriever cannot ' +
    'prove absence (for "find ALL X" or "does the registry have X?" use list_groups + ' +
    'list_components and judge the descriptions yourself), and lexical matching ignores ' +
    'negation (a component described as "with no image asset" still ranks for "image") — ' +
    'read the descriptions before trusting hits.',
  web:
    'Find React components in the encode-ui registry by name, alias, or keyword. ' +
    'Web engine: a plain substring filter over the index fetched from the deployed ' +
    'registry (name, aliases, curated keywords, title, description) — exact names and ' +
    'aliases ("modal", "toast") work best; loose behaviour phrasing may miss. Terms ' +
    'split on punctuation and single characters are dropped, so "toast?" and "a ' +
    'dialog." behave like the bare words. For ' +
    'discovery and planning, read the catalog resource encode-ui://catalog (≈25k tokens) ' +
    'once and judge the descriptions yourself. Every hit carries the exact install ' +
    'command. `score` is rank-derived (scoreKind "lexical"), comparable only within one ' +
    'result set, and `cosine` is always null — no score here is calibrated. A filter ' +
    'cannot prove absence: for "find ALL X" or "does the registry have X?" use ' +
    'list_groups + list_components and judge the descriptions yourself.',
}

const SIMILAR_DESCRIPTIONS: Record<RegistryEngine['kind'], string> = {
  db:
    'Components nearest to a given one in embedding space. Useful for "what else is like this" ' +
    'and for finding variants. Works offline — no query embedding needed. `score` here is a ' +
    'true cosine similarity (scoreKind "cosine"), unlike the fusion score search returns.',
  catalog:
    'Components related to a given one — same group, shared categories, composition edges, ' +
    'and description overlap. Useful for "what else is like this" and for finding variants. ' +
    '`score` is a structural heuristic (scoreKind "lexical"), comparable only within one ' +
    'result set; this install has no embedding index, so these are not embedding-space ' +
    'neighbours.',
  web:
    'Components related to a given one — same group, shared categories, and composition ' +
    'edges, computed from the fetched registry index. Useful for "what else is like this" ' +
    'and for finding variants. `score` is a structural heuristic (scoreKind "lexical"), ' +
    'comparable only within one result set; these are not embedding-space neighbours.',
}

export function registerSearchTools(server: McpServer, ctx: RegistryContext): void {
  // Derived once at registration, not per request: 349 names, and the catalog
  // snapshot cannot change while the server runs.
  const gated = gatedNames(ctx.catalog)

  server.registerTool(
    'search_components',
    {
      title: 'Search encode-ui components',
      description: SEARCH_DESCRIPTIONS[ctx.engine.kind],
      inputSchema: SearchComponentsInput,
      outputSchema: SearchComponentsOutput.shape,
      annotations: annotations(ctx.engine.kind),
    },
    async ({ query, k, group, type, motion, dependencyFree }): Promise<CallToolResult> =>
      guarded('search_components', ctx.engine.kind, async () => {
        // An unknown slug used to filter everything out and render "No matching
        // components" — an empty answer standing in for a wrong question. The
        // registry DOES have matches; only the filter was wrong, and unlike a
        // genuine miss that is something the caller can fix.
        if (group !== undefined) assertKnownGroup(ctx.engine, group)
        const { hits, degraded } = await ctx.engine.search(query, {
          k,
          ...(group !== undefined ? { group } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(motion !== undefined ? { motion } : {}),
          ...(dependencyFree !== undefined ? { dependencyFree } : {}),
        })
        // The annotation is the point: TypeScript checks this payload against the
        // very schema the SDK validates, so the runtime check is a backstop that
        // should never fire.
        const out: SearchComponentsOutput = buildSearchOutput(
          ctx.engine.kind,
          query,
          hits,
          degraded,
          gated,
        )
        return ok(renderSearch(ctx.identity, out), out)
      }),
  )

  server.registerTool(
    'find_similar',
    {
      title: 'Find similar components',
      description: SIMILAR_DESCRIPTIONS[ctx.engine.kind],
      inputSchema: FindSimilarInput,
      outputSchema: FindSimilarOutput.shape,
      annotations: annotations(ctx.engine.kind),
    },
    async ({ name, k }): Promise<CallToolResult> =>
      guarded('find_similar', ctx.engine.kind, () => {
        const asked = stripScope(ctx.identity, name)
        // Same resolution as the detail tools: a curated alias seeds its item.
        const seed = ctx.engine.resolveName(asked) ?? asked
        assertKnown(ctx.engine, seed, name)
        // Reached only for a name the index HAS (db engine: the doc vector is
        // missing after a partial rebuild — reporting that as "no such
        // component" would be the index lying about its own corpus; the
        // catalog engine accepts every known seed).
        if (!ctx.engine.canFindSimilar(seed)) {
          throw new ToolError(
            `The index has no embedding for "${seed}", so its neighbours cannot be computed. ` +
              `The index is incomplete; ${INDEX_REMEDY[ctx.engine.kind]}`,
          )
        }
        const out: FindSimilarOutput = buildSimilarOutput(
          ctx.engine.kind,
          seed,
          ctx.engine.findSimilar(seed, k),
          gated,
        )
        return ok(renderSimilar(ctx.identity, out), out)
      }),
  )
}

export { assertKnown, assertKnownGroup }
