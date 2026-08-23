---
name: use-registry
description: The encode-ui registry workflow — discover, assess, install, customize — plus the dependency census and the icon rule. Invoke when the user types /encode-ui:use-registry, or at the start of any component-hunting session over the encode-ui registry.
---

# Use the registry

This is the plugin's slash form of the MCP server's `use-registry` prompt — the
same guidance under the `/encode-ui:*` umbrella. (The raw MCP prompt still
exists; read its name off `/mcp` under the plugin's server entry.) If
`$ARGUMENTS` is non-empty, it is the current goal — apply the workflow below
to it.

<!-- MIRROR: verbatim builder output — test/plugin-naming.test.ts pins this against src/mcp/prompts.ts -->

You are consuming the @encode-ui component registry (https://encode-ui.com) through the
encode-ui MCP server. All its tools are read-only; installs go through
`npx shadcn@latest add @encode-ui/<name>`. Work this way:

1. DISCOVER. Call search_components with behaviour language ("something that
   shows a loading placeholder"), not keywords. For "does it exist?" or "list
   ALL X" questions, enumerate instead: list_groups, then list_components —
   search is a ranked retriever, not an oracle of absence.
2. ASSESS. Read descriptions before trusting hits. get_component shows deps,
   motion, and source/demo byte costs BEFORE you fetch anything big;
   find_similar lists alternates of a candidate you like.
3. INSTALL. Batch every pick into ONE command via get_install_command —
   @encode-ui/* registryDependencies resolve automatically. Do not hand-copy
   source when the install command exists.
4. CUSTOMIZE. get_component_source only when actually modifying code;
   part:"demo" shows canonical usage.

Dependencies — what an install legitimately adds to package.json (expected,
not a defect): lucide-react (91/312 code items), motion (73),
@tanstack/react-table (12), recharts (7), date-fns (6), @dnd-kit (5),
@xyflow/react (4), react-day-picker (2), and single-item deps (cmdk,
embla-carousel-react, vaul, canvas-confetti, input-otp, react-hook-form,
react-resizable-panels, sonner). class-variance-authority and radix-ui do
NOT count — any shadcn/ui primitive already brings them, so 140 of the 312
code items are TRANSITIVELY dependency-free (pure React + Tailwind — their
whole install tree adds no npm packages beyond that substrate); filter with
dependencyFree: true on search_components or list_components, and read the
`pure` flag on every hit.

Icons: this registry deliberately ships NO icon components — lucide-react IS
the icon layer, auto-installed with any icon-using item. Never guess an icon
import: find_icons verifies names, resolves legacy aliases (Home → House),
and searches by concept. Import named: `import { House } from 'lucide-react'`.

Styling: items style ONLY via semantic OKLCH tokens (--primary, --background,
--chart-1..5). Dark mode is the `.dark` class. If the app lacks the token
contract, run the setup-project prompt first.

Honesty rules: this install runs the web engine — search_components is a
plain substring filter over the fetched registry index (scoreKind "lexical",
`cosine` null), so step 1's behaviour-language advice applies to the semantic
db engine only: here prefer names/aliases/keywords, or read the catalog
resource (encode-ui://catalog) and judge the descriptions yourself; enumerate
with list_components to prove absence, never read scores as calibrated.
