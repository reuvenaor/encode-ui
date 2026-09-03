# encode-ui

Component lookup over the [encode-ui registry](https://encode-ui.com) — 389 shadcn
registry items (336 components + 53 OKLCH palettes), served to AI coding agents over MCP. Your agent searches the catalog, reads any
component's source, and hands back the exact `npx shadcn@latest add` command.

It also validates a brand theme of your own: `validate_theme` runs the WCAG-AA clamp and
the uniqueness math the registry's 48 themes each passed, and hands back paste-ready CSS
variables.

Read-only by design. This server tells an agent *what* to install; installing stays on your
own shadcn path, and nothing here touches your project.

## Install

One stdio command. `npx` fetches it on first run — nothing to install or keep current:

```bash
npx -y encode-ui
```

Zero flags gives you the zero-setup **web engine**: it fetches the catalog from the deployed
registry at startup, caches it, and falls back to a bundled copy, so startup never fails
offline. Only three runtime dependencies are required — the native stack behind the semantic
engine is optional, so a machine that can't build it still installs and still runs.

### Claude Code

The `--` is required; without it `claude` reads the server's flags as its own.

```bash
claude mcp add encode-ui -- npx -y encode-ui
```

Verify with `claude mcp list` (→ `✔ Connected`) or `/mcp` in a session.

Or install the **plugin** instead, which brings the server plus a brand-theme designer —
see [Plugin](#plugin) below. Pick one: the plugin registers the server itself, so doing
both runs it twice.

### Claude Desktop, Gemini CLI, and other hosts

The same JSON block works anywhere that speaks stdio MCP — Claude Desktop's
**Settings → Developer → Edit Config**, or `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "encode-ui": {
      "command": "npx",
      "args": ["-y", "encode-ui"]
    }
  }
}
```

Prefer this form when passing flags: they arrive as discrete `args` that no wrapper can
reinterpret. Restart the host completely after editing. If the server never appears in a
GUI-launched app, it likely didn't inherit your shell's `PATH` — use an absolute `npx` path.

ChatGPT is not supported: its connectors accept only remote HTTPS MCP servers, and this one
is stdio.

### Gated components

A few items need an account. Sign in at [encode-ui.com](https://encode-ui.com), copy the
token from any gated item's Install tab, and put it in the registration's `env` block —
not on the command line, where `ps` can read it:

```json
{ "env": { "ENCODE_UI_TOKEN": "eyJ…" } }
```

Everything else works without it.

## Tools

| Tool | What it does |
|---|---|
| `search_components` | Component search — natural language or names |
| `get_component` | Metadata for one component, plus the byte size of its source and demo |
| `get_component_source` | The full TSX source, or the demo |
| `find_similar` | Related components |
| `list_groups` | The taxonomy with per-group counts |
| `list_components` | Full membership of one group — the enumeration search can't be |
| `get_install_command` | One `npx shadcn@latest add` line for a set of components |
| `find_icons` | Verified lucide icon names — by concept, or to check a spelling (`Home` → `House`) |
| `validate_theme` | Your own brand theme, checked: AA clamp, per-pair contrast, distance from 48 palettes, plus paste-ready `cssVars` |

Every search and list hit carries `pure`: true when the item's whole install tree adds no
npm packages beyond the shadcn substrate you already have. `search_components` and
`list_components` take a `dependencyFree` filter.

Two behaviours worth knowing. **Search is not an oracle of absence** — for "does the registry
have X?" or "list everything in Y", enumerate with `list_groups` then `list_components` and
judge the descriptions. And **a misspelt name is an error, not an empty result**: it comes
back carrying the closest matches, so the agent self-corrects in one turn.

## Prompts

Two slash commands carry the long-form guidance, at zero token cost until invoked:

| Prompt | Slash form |
|---|---|
| `use-registry` | `/mcp__encode-ui__use-registry` |
| `setup-project` | `/mcp__encode-ui__setup-project` |

`use-registry` is the recurring workflow (discover → assess → install → customize);
`setup-project` is the one-time consumer init — the `components.json` namespace, the OKLCH
token contract, `tw-animate-css`, and a smoke test.

## Plugin

**Claude Code only.** The plugin bundles this server together with a
`brand-theme-designer` agent, the two skills it drives, a slash-command shortcut that
dispatches it, slash forms of the server's two prompts, and a typed command for every
tool — so one install gives you both component lookup and a way to brand your app, all
under the `/encode-ui:*` umbrella:

```
/plugin marketplace add reuvenaor/encode-ui
/plugin install encode-ui@encode-ui-theme-gen
```

| What you get | How you reach it |
|---|---|
| the MCP server | registered automatically — see the caveat below |
| `/encode-ui:brand-theme-designer` | the shortcut: hand it a brief, it runs the agent end to end |
| `brand-theme-designer` agent | designs a full brand from a brief, validates it, writes your CSS, and leaves a brand guide |
| `/encode-ui:brand-design` | the method: personality tuple, OKLCH role mapping, dark re-derivation, shadow knobs, uniqueness floors |
| `/encode-ui:theme-tokens` | where the tokens go in a stock `shadcn init` project, and the `@theme inline` wiring shadows and type need |
| `/encode-ui:use-registry` | the component workflow — the `use-registry` prompt as a plugin command |
| `/encode-ui:setup-project` | one-time consumer setup — the `setup-project` prompt as a plugin command |
| the nine tools, typed | one command per tool: `/encode-ui:search-components`, `/encode-ui:find-similar`, `/encode-ui:get-component`, `/encode-ui:get-component-source`, `/encode-ui:list-groups`, `/encode-ui:list-components`, `/encode-ui:get-install-command`, `/encode-ui:validate-theme`, `/encode-ui:find-icons` |

**Skills and commands are slash commands; agents are not.** The agent is reached by the
shortcut above, by `@agent-encode-ui:brand-theme-designer`, or by just describing what
you want — there is no `/` form for an agent in Claude Code. The two prompt wrappers
mirror [src/mcp/prompts.ts](src/mcp/prompts.ts) verbatim, and the command set tracks
the tool surface one-to-one; `test/plugin-naming.test.ts` goes red if either drifts.

**Caveat — do not do both.** The plugin registers the server itself. If you already ran
`claude mcp add encode-ui`, remove it first (`claude mcp remove encode-ui`), or the server
runs twice and its tools appear under two names (bare, and
`mcp__plugin_encode-ui_registry__*`). Under the plugin the server shows in `/mcp` as
`plugin:encode-ui:registry`, so it sorts under `p` — it is renamed, not missing.

**Not on Claude Code?** Plugins are a Claude Code format, but the pieces are not locked to
it. `validate_theme` is a plain MCP tool that works in any host. And the skills are
plain [Agent Skills](https://agentskills.io/specification) folders — copy
`plugin/skills/brand-design` and `plugin/skills/theme-tokens` into wherever your tool
reads skills from (Cursor, Codex, Copilot and others support the format). The agent
definition and its dispatcher skill are the Claude-Code-specific pieces.

## Engines

`--registry-engine <web|catalog|db>` picks how search works. The default is fine for most
people; the other two trade setup for better ranking.

- **web** (default) — no model, no index. Fetches the catalog from the registry, and source
  bodies per call. Its search is a plain filter over names, aliases and keywords, so
  behaviour-style discovery works best by reading the `encode-ui://catalog` resource once
  and letting the model judge the descriptions.
- **catalog** — offline lexical ranking over the bundled index. Ranking never touches the
  network; source bodies still come from the origin (or a registry checkout, if one
  surrounds the package).
- **db** — hybrid semantic + lexical retrieval over each component's description, full
  source, and demo. The strongest for vague, behaviour-style queries. Served from the
  `index.db` shipped in the package; the first query downloads ~1.2 GB of ONNX weights once
  per machine (`--lexical-only` skips the model entirely).

## Configuration

Every install-time property is a flag; `--help` prints this to stderr. The only
configuration environment variable is `ENCODE_UI_TOKEN`.

| Flag | Engine | Effect |
|---|---|---|
| `--registry-engine <web\|catalog\|db>` | — | Which engine serves the tools. Unset = `web`. |
| `--registry-index <path>` | db | Path to `index.db`. Passing it IS db intent. Default: the bundled index. |
| `--registry-url <url>` | web, catalog | Origin bodies are fetched from. Default `https://encode-ui.com`. |
| `--registry-root <path>` | catalog | Registry checkout to read source bodies from. |
| `--model-dir <path>` | db | Where ONNX weights are cached. Default `~/.cache/encode-ui-rag/models`. |
| `--lexical-only` | db | Skip the model; FTS5-only. Results flagged `degraded`. |
| `--help` / `--version` | — | Print usage / version to stderr and exit. |

A flag the selected engine would ignore is a **usage error** (exit 2), same as a malformed
value — the server never warn-and-ignores something you typed deliberately. Path flags
expand `~` and resolve relative values against the server's cwd.

## Gotchas

- **Rebuilding the index means restarting every running server.** The build replaces
  `index.db` with a new file, while the server opens it once and holds the handle — so a
  long-lived server keeps serving the deleted snapshot, silently. After a rebuild, reconnect
  and check that the startup banner's item count matches.
- **Icons are data, not components.** The registry ships no icon components; `find_icons`
  answers from vendored lucide metadata at the exact tag the registry pins for
  `lucide-react`. Ask it rather than guessing an import.

## License

MIT, Copyright (c) 2026 Reuven Naor — see [LICENSE](LICENSE). This package ships a prebuilt
index carrying component source, some of it adapted from other MIT-licensed projects; their
notices travel with it in [NOTICE.md](NOTICE.md). The bundled `agent-index.json` is generated
from the registry, so regenerating it is a maintainer task rather than something a clone can
reproduce.

Questions, licensing or otherwise: <info@reuvenaor.com>.
