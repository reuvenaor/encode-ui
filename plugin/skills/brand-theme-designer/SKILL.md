---
name: brand-theme-designer
description: Slash-command shortcut that dispatches the brand-theme-designer agent to design and apply a complete brand theme — palette, typography, shadows, radius, motion — to the user's own shadcn/Tailwind project. Invoke when the user types /encode-ui:brand-theme-designer, or asks for a brand, a visual identity, or a full theme for their app rather than a single colour tweak.
---

# Brand theme designer (dispatcher)

This skill is a **shortcut, not a method**. It hands the work to the
`brand-theme-designer` agent, which owns the whole workflow. Do not design tokens
yourself here, and do not restate the agent's rules.

The brief is `$ARGUMENTS`.

## Step 1 — check the prerequisites

Both must hold before you dispatch. Check them yourself; failing early is cheaper
than failing inside the agent.

1. **The plugin's MCP server is connected.** The agent needs its `validate_theme`
   tool for the WCAG-AA clamp and the uniqueness math. Under this plugin the tool is
   named `mcp__plugin_encode-ui_registry__validate_theme`. If it is missing, say so
   and stop — an unvalidated palette is guesswork, not a brand.
2. **A `components.json` sits at the project root.** Without one the project never ran
   `shadcn init`, and nothing says which CSS file owns the tokens. Say so and stop.

## Step 2 — get a brief

If `$ARGUMENTS` is empty, ask for one before dispatching. Keep it to a single
AskUserQuestion round covering:

- the product and its audience,
- three personality words,
- an existing brand colour to honour, or greenfield,
- light-first or dark-first.

Pass whatever the user gives you straight through. Do not pad it, and do not answer
the taste questions on their behalf — the agent runs its own intake for the rest.

## Step 3 — dispatch

Launch the agent with the Agent tool, `subagent_type: "encode-ui:brand-theme-designer"`.
Put the brief in the prompt verbatim, plus any project facts you already know (the CSS
file path, the framework, the dev command) so the agent does not re-derive them.

The agent may come back with a `QUESTIONS:` block instead of a finished theme. That is
its documented path when it cannot ask the user directly. Put those questions to the
user, then re-dispatch with the answers.

## Step 4 — relay the result

The agent returns a report card: contrast residuals, clamp moves, the nearest palette
with its ΔEok, the personality tuple, the files it changed. Relay that to the user —
its output is not shown to them. Name the CSS file it wrote and the brand guide it
left behind.

Two things stay the user's call, so surface them rather than deciding: any commit the
agent offered, and any question it escalated (a uniqueness collision, a clamp that
moved, a component edit the brand seems to want).
