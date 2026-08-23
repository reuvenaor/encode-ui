---
description: One component's metadata — deps, motion, source and demo byte sizes
argument-hint: <component-name>
---

Call the `get_component` tool on the encode-ui MCP server with
`name: $ARGUMENTS`. Present the metadata: description, group, dependencies,
whether it is dependency-free, gating, and the `sourceBytes`/`demoBytes` — so
the user can decide whether to fetch the source next with
`/encode-ui:get-component-source`.
