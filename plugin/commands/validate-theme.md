---
description: Check a brand theme — WCAG-AA clamp, contrast pairs, distance from shipped palettes
argument-hint: <css | path-to-css-file>
---

If $ARGUMENTS is a file path, read that file first; otherwise treat $ARGUMENTS
as the theme CSS/tokens directly. Call the `validate_theme` tool on the
encode-ui MCP server with the token set. Present the full report: the clamp
log, every contrast pair with its ratio, the nearest shipped palette with its
ΔEok distance, and the paste-ready cssVars. A failed schema comes back as a
report, not an error — relay it.
