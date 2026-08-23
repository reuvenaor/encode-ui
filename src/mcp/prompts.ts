// MCP prompts — the on-demand half of the context-lift split.
//
// SERVER_INSTRUCTIONS is always loaded, so it stays lean; these prompts carry
// the rich, multi-step guidance (workflow, dependency census, setup checklist)
// and cost zero tokens until a user invokes one — in Claude Code they surface
// as /mcp__encode-ui__use-registry and …__setup-project. The plugin also wraps
// them as /encode-ui:use-registry and /encode-ui:setup-project: those two
// skills MIRROR this file's builders verbatim (identity from agent-index.json,
// engine 'web'), and test/plugin-naming.test.ts reddens when they drift.
//
// Builders are pure (identity + optional arg in, string out) and read no DB —
// testable against FIXTURE_ID with no environment. MCP prompt arguments are
// STRINGS ONLY by spec; keep every argsSchema field a z.string().
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { EngineKind } from '../engine.ts'
import type { RegistryIdentity } from '../registry-id.ts'
import type { RegistryContext } from './context.ts'

export function buildUseRegistryPrompt(
  id: RegistryIdentity,
  goal?: string,
  kind: EngineKind = 'db',
): string {
  const scope = `@${id.scope}`
  return [
    `You are consuming the ${scope} component registry (${id.homepage}) through the`,
    'encode-ui MCP server. All its tools are read-only; installs go through',
    `\`npx shadcn@latest add ${scope}/<name>\`. Work this way:`,
    '',
    ...(goal ? [`Current goal: ${goal} — apply the steps below to it.`, ''] : []),
    '1. DISCOVER. Call search_components with behaviour language ("something that',
    '   shows a loading placeholder"), not keywords. For "does it exist?" or "list',
    '   ALL X" questions, enumerate instead: list_groups, then list_components —',
    '   search is a ranked retriever, not an oracle of absence.',
    '2. ASSESS. Read descriptions before trusting hits. get_component shows deps,',
    '   motion, and source/demo byte costs BEFORE you fetch anything big;',
    '   find_similar lists alternates of a candidate you like.',
    '3. INSTALL. Batch every pick into ONE command via get_install_command —',
    `   ${scope}/* registryDependencies resolve automatically. Do not hand-copy`,
    '   source when the install command exists.',
    '4. CUSTOMIZE. get_component_source only when actually modifying code;',
    '   part:"demo" shows canonical usage.',
    '',
    'Dependencies — what an install legitimately adds to package.json (expected,',
    'not a defect): lucide-react (91/312 code items), motion (73),',
    '@tanstack/react-table (12), recharts (7), date-fns (6), @dnd-kit (5),',
    '@xyflow/react (4), react-day-picker (2), and single-item deps (cmdk,',
    'embla-carousel-react, vaul, canvas-confetti, input-otp, react-hook-form,',
    'react-resizable-panels, sonner). class-variance-authority and radix-ui do',
    'NOT count — any shadcn/ui primitive already brings them, so 140 of the 312',
    'code items are TRANSITIVELY dependency-free (pure React + Tailwind — their',
    'whole install tree adds no npm packages beyond that substrate); filter with',
    'dependencyFree: true on search_components or list_components, and read the',
    '`pure` flag on every hit.',
    '',
    'Icons: this registry deliberately ships NO icon components — lucide-react IS',
    'the icon layer, auto-installed with any icon-using item. Never guess an icon',
    'import: find_icons verifies names, resolves legacy aliases (Home → House),',
    "and searches by concept. Import named: `import { House } from 'lucide-react'`.",
    '',
    'Styling: items style ONLY via semantic OKLCH tokens (--primary, --background,',
    '--chart-1..5). Dark mode is the `.dark` class. If the app lacks the token',
    'contract, run the setup-project prompt first.',
    '',
    ...(kind === 'db'
      ? [
          'Honesty rules: report `degraded: true` results as lexical-only; read a low',
          'top-hit `cosine` as a hint to enumerate, never as proof of absence.',
        ]
      : kind === 'catalog'
        ? [
            'Honesty rules: this install runs the lexical catalog engine — every score is',
            'rank-derived (scoreKind "lexical") and `cosine` is null; enumerate with',
            'list_components to prove absence, never read scores as calibrated.',
          ]
        : [
            'Honesty rules: this install runs the web engine — search_components is a',
            'plain substring filter over the fetched registry index (scoreKind "lexical",',
            '`cosine` null), so step 1\'s behaviour-language advice applies to the semantic',
            'db engine only: here prefer names/aliases/keywords, or read the catalog',
            'resource (encode-ui://catalog) and judge the descriptions yourself; enumerate',
            'with list_components to prove absence, never read scores as calibrated.',
          ]),
  ].join('\n')
}

export function buildSetupProjectPrompt(id: RegistryIdentity, project?: string): string {
  const scope = `@${id.scope}`
  return [
    `Set up this project to consume the ${scope} registry (${id.homepage}).`,
    ...(project ? ['', `Project context: ${project}`] : []),
    '',
    'Preflight: React 18+ and Tailwind v4 with a components.json — if the project',
    'has no components.json yet, run `npx shadcn@latest init` first.',
    '',
    `1. Register the namespace — add to components.json:`,
    '   "registries": {',
    `     "${scope}": "${id.homepage}/r/{name}.json"`,
    '   }',
    '2. Token contract — the items style via semantic OKLCH tokens (--background,',
    '   --primary, --chart-1..5 …). If the app CSS lacks them, install one of the',
    // Countless on purpose: the palette catalog grows, and a literal here rotted
    // once already (it said 40 while the registry shipped 53).
    `   shipped palettes: \`npx shadcn@latest add ${scope}/theme-<name>\` (enumerate the`,
    '   themes group with list_components to pick by mood; theme-zinc is neutral).',
    "3. Animation layer — ensure `@import 'tw-animate-css';` in the Tailwind CSS",
    '   entry (`npm i -D tw-animate-css` if missing); base primitives use those',
    '   utilities.',
    '4. Icons — lucide-react arrives automatically with any icon-using item; for',
    '   standalone use: `npm install lucide-react`. Verify icon names with the',
    '   find_icons tool, never from memory.',
    '5. Dark mode and palettes — dark is the `.dark` class on <html>; multi-palette',
    '   apps switch via a `data-theme` attribute.',
    `6. Smoke test — \`npx shadcn@latest add ${scope}/button\`, render it, and`,
    '   confirm it is styled (grey/unstyled output means the token contract is',
    '   missing — revisit step 2).',
    '',
    'For day-to-day component work after setup, invoke the use-registry prompt.',
  ].join('\n')
}

export function registerRegistryPrompts(server: McpServer, ctx: RegistryContext): void {
  server.registerPrompt(
    'use-registry',
    {
      title: 'Use the encode-ui registry correctly',
      description:
        'The end-to-end component workflow: search → assess → install → customize, ' +
        'plus the dependency census and the icon rule.',
      argsSchema: {
        goal: z
          .string()
          .optional()
          .describe('What you are building right now (optional — the workflow is applied to it).'),
      },
    },
    ({ goal }) => ({
      description: 'encode-ui registry usage guide',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: buildUseRegistryPrompt(ctx.identity, goal, ctx.engine.kind),
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'setup-project',
    {
      title: 'Set up a project to consume the registry',
      description:
        'First-time consumer setup: components.json namespace, OKLCH theme tokens, ' +
        'tw-animate-css, lucide-react, smoke test.',
      argsSchema: {
        project: z
          .string()
          .optional()
          .describe("What you're building and the current stack (optional context)."),
      },
    },
    ({ project }) => ({
      description: 'encode-ui registry consumer setup',
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: buildSetupProjectPrompt(ctx.identity, project) },
        },
      ],
    }),
  )
}
