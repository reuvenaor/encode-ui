# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`encode-ui` on npm — a read-only MCP server giving coding agents component lookup over the
[encode-ui shadcn registry](https://encode-ui.com). Nine tools, two prompts, three engines
behind one surface. Consumer docs are in [README.md](README.md); contribution rules in
[CONTRIBUTING.md](CONTRIBUTING.md).

This repo ALSO holds a Claude Code plugin (`plugin/`) and the marketplace manifest that
serves it (`.claude-plugin/marketplace.json`). MCP cannot distribute an agent or a skill —
the spec has three server primitives, and skills-over-MCP is an in-review draft Claude Code
declined to implement — so the plugin is how the `brand-theme-designer` agent and its two
skills reach consumers. The plugin is NOT in the npm tarball (`files`); it ships by git.

## Commands

```bash
npm test          # node:test suite — no runner dependency
npm run typecheck
npm run check     # typecheck + test; the gate for any change
npm run build     # tsc -> dist/, plus schema.sql and lucide-icons.json
```

`build:index` / `verify` / `eval` are maintainer tasks that need the registry checkout and an
embedding model — they cannot run from a standalone clone.

## The load-bearing parts

- **`src/engine.ts` is the contract.** Three engines implement it: `engine-web.ts` (default,
  fetches the catalog and bodies from the registry origin), `engine-catalog.ts` (offline
  MiniSearch ranking over the bundled `agent-index.json`), and `engine-db.ts` (hybrid
  semantic + lexical over `index.db`). `engine-shared.ts` holds what the artifact-backed
  engines must agree on — alias resolution, filters, group ordering, source combining — and a
  byte-parity test pins them together.
- **The db module loads dynamically.** A broken native `better-sqlite3` install must never
  break the zero-setup path.
- **`agent-index.json` is generated upstream**, in the registry repo, and committed here. A
  clone cannot regenerate it. Treat it as an input. **`src/theme-engine-core.ts` and
  `theme-anchors.json` are the same kind of thing** — written by
  `scripts/build-rag-theme-assets.mjs` on every `npm run themes` upstream, and pinned here
  by digest in `test/theme-core.test.ts`. The core is a VERBATIM copy under a banner; it is
  copyable only because it imports nothing, and the generator re-asserts that before writing.
- **`validate_theme` is the odd tool out.** Every other tool answers about the catalog; this
  one runs the AA clamp and the uniqueness math over a theme the CALLER wrote. It is pure
  computation over those two vendored artifacts — no engine, no network — and a schema
  failure comes back as a report, not a thrown error.
- **`index.db` is gitignored.** `prepack` verifies a present one against `agent-index.json`'s
  source digests and refuses a stale one; absent, it packs a catalog-only tarball, which is a
  supported shape.
- **Tests carry their reasons.** Most non-obvious assertions exist because something broke;
  the comment above says what. Retarget at the intent rather than deleting.

## Rules that bite

- Tools are **read-only**. Nothing here mutates a consumer's project.
- `get_component_source` deliberately has **no `outputSchema`** — the SDK is all-or-nothing
  per tool, and a schema would deliver 27 KB of TSX JSON-escaped. Don't "fix" it.
- Internals never reach the model: stack traces and paths go to stderr, the model gets one
  sentence. `guarded()` enforces it.
- A flag the selected engine would ignore is a **usage error**, not a warn-and-ignore.
- Plain TypeScript only — no syntax a stock `tsc` cannot parse.
