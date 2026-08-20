---
name: theme-tokens
description: Applying a designed brand theme to a consumer's own shadcn/Tailwind v4 project — locating the CSS file from components.json, the :root/.dark block shape and the @theme inline mappings a full brand needs, validating the token set with the encode-ui MCP server's validate_theme tool, reading its clamp and uniqueness report, wiring fonts, and verifying in both modes. Invoke when writing or revising theme tokens in an app you are building, after the brand-design method has produced the token set.
---

# Theme tokens (consumer project)

The [brand-design](../brand-design/SKILL.md) skill decides WHAT the tokens are. This skill
is the other half: where they go in someone's own app, how they get checked, and what
"done" looks like. Nothing here is specific to the encode-ui registry — it describes a
stock `shadcn init` project on Tailwind v4.

**Companion:** the `validate_theme` tool on the `encode-ui` MCP server. It runs the same
WCAG-AA clamp and uniqueness math the registry's own 48 themes passed, over your candidate
token set, and hands back a paste-ready `cssVars` block. Pure computation — it writes
nothing and fetches nothing.

## Where the tokens live

**Never guess the path.** Read `components.json` at the project root and use its
`tailwind.css` field:

```jsonc
{ "tailwind": { "css": "src/app/globals.css" } }   // Next.js app router
{ "tailwind": { "css": "src/index.css" } }         // Vite
```

That file already holds the `:root` and `.dark` blocks `shadcn init` wrote. A brand REPLACES
the token values in those two blocks; it does not add a third block, and it does not add a
`data-theme` selector unless the app actually needs runtime palette switching.

If `components.json` is missing, the project has not run `shadcn init` — say so and stop.
Guessing a CSS file and writing tokens into it is how you end up with two competing
palettes and no error message.

## The token surface

Thirty-two colour tokens in **both** modes, plus `radius`, are the floor. A brand entry
that stops there has made five of the eight tuple decisions by accident.

| Group | Tokens | Mode |
|---|---|---|
| Surfaces | `background` `card` `popover` `muted` `secondary` `accent` `sidebar` | both |
| Text | `foreground` `card-foreground` `popover-foreground` `muted-foreground` `secondary-foreground` `accent-foreground` `primary-foreground` `destructive-foreground` `sidebar-foreground` `sidebar-primary-foreground` `sidebar-accent-foreground` | both |
| Brand | `primary` `destructive` `sidebar-primary` `sidebar-accent` | both |
| Lines | `border` `input` `ring` `sidebar-border` `sidebar-ring` | both |
| Charts | `chart-1` … `chart-5` | both |
| Geometry | `radius` | light only (mode-invariant) |
| Scrim | `overlay` | light, dark may re-anchor |
| Shadows | `shadow-color` `shadow-opacity` `shadow-blur` `shadow-spread` `shadow-offset-x` `shadow-offset-y` | light, dark may re-anchor |
| Type | `font-sans` `font-serif` `font-mono` `letter-spacing` | light only |
| Motion | `ease-in` `ease-out` `ease-in-out` `default-transition-duration` `default-transition-timing-function` | light only |

Mode-invariant keys belong in the light block only. Authoring `font-sans` under `.dark`
is a mistake the validator reports rather than silently honouring.

**Font values must be full CSS stacks**, not bare family names:
`"Manrope, ui-sans-serif, system-ui, sans-serif"`. The MCP tool refuses a bare name,
because the stack is what actually ships and the fallback is what renders before the
webfont loads.

## Making the extra tokens real

`shadcn init` wires only the colour tokens and `--radius` into Tailwind. Shadows, fonts,
tracking and the overlay scrim are inert until they are mapped — a brand that authors them
without this step looks like a colour swap and nothing else.

Add to the `@theme inline` block in the same CSS file:

```css
@theme inline {
  /* …the --color-* mappings shadcn init already wrote… */

  /* Multiplicative radius scale, so a 0-radius brand is square at every step. */
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);

  /* Shadows are the one namespace Tailwind compiles as literals, so each step
     needs wiring to a runtime var. Map all eight or the unmapped ones keep
     Tailwind's defaults and the ramp goes inconsistent. */
  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow: var(--shadow);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);

  --font-sans: var(--font-sans);
  --font-serif: var(--font-serif);
  --font-mono: var(--font-mono);

  /* The whole tracking scale derives from one authored knob. */
  --tracking-tighter: calc(var(--tracking-normal) - 0.05em);
  --tracking-tight: calc(var(--tracking-normal) - 0.025em);
  --tracking-normal: var(--tracking-normal);
  --tracking-wide: calc(var(--tracking-normal) + 0.025em);
  --tracking-wider: calc(var(--tracking-normal) + 0.05em);
  --tracking-widest: calc(var(--tracking-normal) + 0.1em);

  /* Only if the brand tints modal scrims — then dialogs use bg-overlay/80. */
  --color-overlay: var(--overlay);
}
```

Two more that are easy to miss, in `@layer base`:

```css
@layer base {
  body {
    @apply bg-background text-foreground;
    /* Preflight resolves the page font at build time and tracking tokens are
       inert without a consumer — both need wiring explicitly. */
    font-family: var(--font-sans);
    letter-spacing: var(--tracking-normal, 0em);
  }
}
```

## The pipeline

1. Design the full token set with the brand-design method.
2. Call **`validate_theme`** with `slug`, `character`, `light`, `dark`.
3. Read the report (below). Fix in the DESIGN, never by hand-patching output.
4. Write the returned `cssVars` into the project's CSS: `cssVars.light` → `:root`,
   `cssVars.dark` → `.dark`, `cssVars.theme` → `:root` as well (it is mode-invariant), each
   key prefixed with `--`. Add `cssVars.css`'s `@layer base` body rule when present.
5. Verify in both modes.
6. Write the brand guide.

## Reading the report

| Signal | What it means |
|---|---|
| `errors` non-empty | Schema failure — a missing token or an unknown key. Nothing else in the report is trustworthy yet. |
| `warnings` mentioning a raw font stack | Expected and correct here: you passed a stack, and no `@font-face` is generated for you. |
| `clampLog` non-empty | The AA clamp WOULD move those tokens. A hair is noise; anything more means the lightness architecture is wrong — **re-derive, do not ship the clamped value**. |
| `residuals` non-empty | Pairs that stay under 4.5:1 even after repair. Never a shipping state. |
| `skips` non-empty | A value the engine could not parse. Almost always a typo in an `oklch()` string. |
| `pairs` | Every foreground/surface combination, worst first, across both modes. The first row is the theme's tightest pair. |
| `uniqueness.verdict: duplicate` | ΔEok ≤ 0.02 from a shipped palette — the same colour. Re-anchor. |
| `uniqueness.verdict: crowded` | Under 30° of hue from the nearest. Shippable, but radius/shadows/type/tracking/motion must carry the difference. |
| `uniqueness.defaultBlue: true` | The anchor sits in the 250–265° band everyone falls into. Fine if the brief demanded it — record why in the guide. |

Uniqueness here measures distance from the 48 palettes the encode-ui registry ships. That
is a "does this read as a stock theme?" check, not a licence question — you are branding
your own app, and landing near one of them is a signal to weigh, not a blocker.

## Fonts

Self-host or install as a package; never a CDN `<link>` in shipped output, which puts a
third-party request on first paint.

- **Next.js:** `next/font/local` or `next/font/google`, then set `--font-sans` to the
  generated CSS variable inside the stack.
- **Anything else:** `npm i @fontsource-variable/<family>`, import it once at the app
  entry, and use the family name in the stack.

Whatever the route, the family name in your `@font-face` (or the Fontsource package) must
match the first name in the `font-sans` stack exactly, or the fallback renders silently.

## Verification

Both modes, always — judging light only is how dark ships broken.

1. Run the project's own dev server (read `package.json` scripts; do not assume `npm run
   dev` or a port).
2. Toggle `.dark` on `<html>` and look at the same screens twice.
3. Check a dense surface, not just a landing page: a form, a table, a dialog, a chart if
   the app has one. Cards on cards is where surface elevation fails.
4. Confirm the focus ring is visible in both modes — `ring` is a token a brand can
   accidentally make invisible.
5. If no browser is available, say so and downgrade to report-only rather than claiming a
   visual pass.

## Guide home

Write the brand guide to `docs/brand.md` unless the project has an obvious docs
convention — follow the structure in
[brand-guide-template.md](../brand-design/brand-guide-template.md). The "What we touched"
table is the contract: every family row filled, none marked "default".

## Anti-patterns

- Writing tokens into a CSS file you found by guessing instead of via `components.json`.
- Authoring colours only, then reporting a brand — untouched shadows, type and motion are
  three decisions not made.
- Shipping the clamp's output. The clamp repairs; it does not design.
- Editing a shadcn UI component to make the brand work. That is a finding to raise with
  the user, never a silent divergence.
- A `.dark` block carrying `font-sans`, `radius`, or motion keys — they are mode-invariant.
- Judging only light mode.
- Bare family names in a font token.
