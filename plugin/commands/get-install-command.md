---
description: One npx shadcn@latest add line for a set of components
argument-hint: <name> [name…]
---

Call the `get_install_command` tool on the encode-ui MCP server with
`names` set to the space- or comma-separated component names in $ARGUMENTS.
Hand back the single install line it returns; if some names did not resolve,
say which, and do not invent replacements.
