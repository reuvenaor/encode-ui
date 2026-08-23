# Brand guide template

Write it to whatever path your engine skill names as the guide home.

Copy this structure exactly — don't invent section names. The "What we touched" table is
the user's contractual per-brand report: every family row present, none marked "default".

```markdown
# Brand: <Name> (`<slug>`)

**Status:** shipped
<Install or apply line — your engine skill says what belongs here.>

## Concept

<One paragraph: the brand story distilled from the brief — who it serves, what it must
feel like, what it must never feel like. End with the `character` line VERBATIM as it
appears in the theme entry.>

## Personality tuple

| Dimension | Choice | Why |
|---|---|---|
| Hue territory | <e.g. deep teal 195°> | <brief-derived reason> |
| Chroma character | | |
| Lightness character | | |
| Radius bucket | | |
| Shadow personality | | |
| Tracking sign | | |
| Type pairing | | |
| Motion character | | |
| Chart strategy | <categorical / sequential — declared> | |

## Anchors

<Primary + neutral-undertint + 1-2 support anchors as OKLCH values with one-line
rationale each. Light-first or dark-first call. IF the hue sits in 250–265°: the
explicit brief justification for entering the default-blue band.>

## What we touched

| Family | Tokens | Decision |
|---|---|---|
| Surfaces | background, card, popover, muted, sidebar | |
| Text | foreground pairs, muted-foreground | |
| Brand & action | primary, accent, ring | |
| Borders | border, input, sidebar-border | |
| Charts | chart-1..5 | |
| Sidebar | sidebar-* | |
| Radius | radius (scale derives) | |
| Typography | font-sans / font-mono (/ font-serif) | |
| Tracking | letter-spacing | |
| Shadows | 6 knobs → 8-step ramp | |
| Motion | ease-*, default-transition-* | |
| Overlay | scrim | |

## Contrast card

<Clamp outcome: residuals (must be 0); every token the clamp moved and by how much —
the target is NONE beyond noise. Non-text 3:1 spot-checks (border vs background, ring
vs background, chart hues vs card) for both modes.>

## Uniqueness card

<From uniqueness.json: nearest anchor, ΔEok, hue distance; tuple-dimension diff count
vs that neighbor; verdict. For a second+ generated brand: distance vs the other
generated brands too.>

## Constraints encountered

<shadcn residue rows hit (see the theme-engine skill's shadcn-constraints.md) and what
was decided — or "None".>

## Usage do / don't

<5–8 bullets: accent scarcity rule for this brand, chart labeling, which surfaces carry
the tint, what never goes pure white/black, pairing hierarchy, motion boundaries.>
```
