# Security

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/reuvenaor/encode-ui/security/advisories/new)
rather than opening a public issue. You should get a first response within a few days.

## What this server can and cannot do

Worth knowing before you run it, because "an MCP server" can mean almost anything:

- **Every tool is read-only.** The server tells your agent what to install and hands back
  an `npx shadcn@latest add` command. It never installs anything, never writes to your
  project, and never runs a package manager.
- **One tool reaches the network.** `get_component_source` fetches component bodies from
  the registry origin (`https://encode-ui.com` by default, or whatever `--registry-url`
  names). It is the only tool that egresses, and it is marked `openWorldHint` for exactly
  that reason. The `db` engine serves bodies from its bundled index and makes no requests
  at all.
- **The only secret it reads is `ENCODE_UI_TOKEN`**, your registry bearer token, sent as an
  `Authorization` header to that same origin. Put it in your MCP host's `env` block, not on
  the command line, where any process listing can read it.
- **It executes no component code.** Source is transported as text; nothing is evaluated.

## Optional native dependencies

The semantic engine pulls `better-sqlite3`, `sqlite-vec`, and `@huggingface/transformers`.
They are `optionalDependencies` — if they fail to build, the default engine still runs. The
model weights the `db` engine downloads on first use come from the Hugging Face CDN and are
cached under your platform cache directory.
