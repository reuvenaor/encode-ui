# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`encode-ui` on npm — a read-only MCP server giving coding agents component lookup over the
[encode-ui shadcn registry](https://encode-ui.com). Eight tools, two prompts, three engines
behind one surface. Consumer docs are in [README.md](README.md); contribution rules in
[CONTRIBUTING.md](CONTRIBUTING.md).

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
  clone cannot regenerate it. Treat it as an input.
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
