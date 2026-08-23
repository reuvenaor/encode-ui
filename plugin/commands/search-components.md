---
description: Search the encode-ui registry — natural language or names
argument-hint: <query>
---

Call the `search_components` tool on the encode-ui MCP server with
`query: $ARGUMENTS`. Present each hit as name — group — description, with its
install command. Search is a filter, not an oracle of absence: if nothing
matches, say so and suggest `/encode-ui:list-groups` to browse the taxonomy
instead.
