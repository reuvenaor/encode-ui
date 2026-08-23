---
name: setup-project
description: One-time setup of a project to consume the encode-ui registry — the components.json namespace, the OKLCH token contract, tw-animate-css, lucide-react, and a smoke test. Invoke when the user types /encode-ui:setup-project, or when a project has never installed from the registry before.
---

# Set up the project

This is the plugin's slash form of the MCP server's `setup-project` prompt —
the same checklist under the `/encode-ui:*` umbrella. (The raw MCP prompt
still exists; read its name off `/mcp` under the plugin's server entry.) If
`$ARGUMENTS` is non-empty, treat it as the project context — what is being
built and on which stack.

<!-- MIRROR: verbatim builder output — test/plugin-naming.test.ts pins this against src/mcp/prompts.ts -->

Set up this project to consume the @encode-ui registry (https://encode-ui.com).

Preflight: React 18+ and Tailwind v4 with a components.json — if the project
has no components.json yet, run `npx shadcn@latest init` first.

1. Register the namespace — add to components.json:
   "registries": {
     "@encode-ui": "https://encode-ui.com/r/{name}.json"
   }
2. Token contract — the items style via semantic OKLCH tokens (--background,
   --primary, --chart-1..5 …). If the app CSS lacks them, install one of the
   40 palettes: `npx shadcn@latest add @encode-ui/theme-<name>` (enumerate the
   themes group with list_components to pick by mood; theme-zinc is neutral).
3. Animation layer — ensure `@import 'tw-animate-css';` in the Tailwind CSS
   entry (`npm i -D tw-animate-css` if missing); base primitives use those
   utilities.
4. Icons — lucide-react arrives automatically with any icon-using item; for
   standalone use: `npm install lucide-react`. Verify icon names with the
   find_icons tool, never from memory.
5. Dark mode and palettes — dark is the `.dark` class on <html>; multi-palette
   apps switch via a `data-theme` attribute.
6. Smoke test — `npx shadcn@latest add @encode-ui/button`, render it, and
   confirm it is styled (grey/unstyled output means the token contract is
   missing — revisit step 2).

For day-to-day component work after setup, invoke the use-registry prompt.
