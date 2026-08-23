---
name: brand-design
description: Branding-agency method for designing a complete, genuinely unique brand theme from a brief — the 8-dimension personality tuple, OKLCH color ramps via the Radix 12-step role model mapped onto shadcn tokens, dark-mode re-derivation, typography pairing and tracking personality, the 6-knob shadow system, radius commitment, motion character, chart palette strategy, and the uniqueness discipline (hue floors, variation tuple, anti-default-blue). Invoke when designing or revising a brand theme from a brief — before writing any preset entry.
---

# Brand design

"AAA" here means **agency-quality**, not WCAG AAA: a theme should look like a branding
company shipped it. The unit of quality is COMMITMENT — a brand personality binds every
lever at once (hue, neutrals, radius, shadows, type, tracking, motion), and a vague brief
is an instruction to pick a clear direction and commit, never to produce a safe middle
ground. Design decisions live here; mechanical enforcement (the AA contrast clamp, the
uniqueness report) lives in the engine — whichever one your engine skill names — and is
your instrument, not your art director.

**Companions:** [personality-matrix.md](personality-matrix.md) — brief → token-direction
routing · [font-pairings.md](font-pairings.md) — proven pairings + availability ·
[worked-example.md](worked-example.md) — an annotated miniature entry ·
[brand-guide-template.md](brand-guide-template.md) — the deliverable's structure.

## The variation tuple

Every brand is a point in an 8-dimensional space. Two themes sharing a hue but differing
in 3+ other dimensions read as different products; two themes differing only in hue read
as a palette swap.

| Dimension | Range of positions |
|---|---|
| Hue territory | anchor hue family, in degrees (OKLCH) |
| Chroma character | hushed (≤0.05) · balanced (~0.1) · saturated (0.15+) · neon (0.2+) |
| Lightness character | airy-light · paper · dusky · ink-dark-first |
| Radius bucket | sharp 0–0.25rem · balanced 0.5rem · soft 0.75–1.4rem |
| Shadow personality | barely-there · soft-large-blur · crisp-tight · hard-offset (0 blur) |
| Tracking sign | negative (modern) · zero (humanist) · positive (technical/display) |
| Type pairing | one of the proven pairings, or a justified new one |
| Motion character | productive (120–150ms, crisp ease-out) · expressive (200–300ms, soft ease-in-out) |

Coherence rule: the dimensions must AGREE with the personality. A brutalist brand is
0 radius + hard shadows + mono-leaning type + positive tracking + productive motion — all
five, not two. Route the brief through the personality matrix first.

## Color

- **Author in OKLCH.** Equal L reads as equal brightness, so ramps hold their hue while
  lightness moves; programmatic derivation is predictable (evilmartians, "OKLCH in CSS").
- **Ramps have role-assigned steps** (Radix 12-step model). Map roles onto the shadcn
  vocabulary instead of picking colors ad hoc:

| Radix step role | shadcn tokens |
|---|---|
| 1 app background | `background` |
| 2 subtle background | `muted`, `sidebar` |
| 3–5 component states | `secondary`, `accent` (rest → hover territory) |
| 6–8 borders (8 = strongest) | `border`, `input`, `ring` |
| 9–10 solid brand (9 = max chroma) | `primary`, `sidebar-primary` |
| 11 low-contrast text | `muted-foreground` |
| 12 high-contrast text | `foreground`, `card-foreground` |

- **Neutrals carry the brand undertint.** Pick the gray whose hue sits nearest the accent
  (Radix gray-pairing; shadcn's own base colors are tinted: Mauve, Olive, Mist, Taupe).
  A brand with pure-gray neutrals reads as a template with a colored button.
- **Never pure `#fff` / `#000` surfaces** — `oklch(1 0 0)` and `oklch(0 0 0)` are banned
  as `background`/`card` values. Tint toward the brand hue at very low chroma (worked
  example for a green brand: `#FBFDF8` light, `#0C1A10` dark).
- **60-30-10 with accent scarcity.** ~60% undertinted neutral surface, ~30% secondary
  support, ~10% brand accent; on enterprise-dense surfaces the accent appears essentially
  only on primary actions and active states. Contrast through scarcity.
- **Destructive stays red-family** but harmonized to the brand's chroma/lightness
  character — a neon brand gets a neon-adjacent red, a hushed brand a muted brick.

## Dark mode is a re-derivation

Never numeric inversion. Re-derive: desaturate the accent ~20–30% and lift its lightness
(saturated colors vibrate on dark ground); express elevation as LIGHTER surfaces
(`card`/`popover` a few L-points above `background`), not heavier shadows; alpha borders
(`oklch(1 0 0 / 10%)` family) auto-adapt to any surface and are preferred for
`border`/`input` in dark. The dark background is the brand hue at very low chroma and low
lightness — not black.

## Typography and tracking

- **≤ 2 families + an optional mono.** Hierarchy comes from weight, size and tracking
  before a third family is even considered.
- Pair by contrast or by superfamily; check x-heights sit close (a tall-x sans next to a
  small-x serif looks broken at UI sizes). Start from the proven pairings companion.
- Variable fonts only (one file per family, every weight).
- **Tracking is a personality signal**: modern/clean −0.01…−0.025em; humanist ~0;
  technical/brutalist/display +0.02em or more. Set ONE `letter-spacing` knob — the engine
  derives the full scale from it.

## Shadows

Six knobs (`color / opacity / blur / spread / offset-x / offset-y`) compose the entire
8-step elevation ramp — author the knobs, never individual steps.

- Opacity 0.05–0.15 in light mode, 0.2–0.4 in dark (the only knob that routinely differs
  per mode is `shadow-color`/opacity — geometry stays shared).
- **Tint `shadow-color` with the brand hue** — pure black shadows on a warm brand look
  like dust. A deep desaturated version of the brand hue reads as ambient light.

| Personality | Knob shape |
|---|---|
| barely-there enterprise | blur 2–4px, offset-y 1px, opacity ≤0.08 |
| soft premium | blur 12–24px, offset-y 4–8px, opacity ~0.10 |
| crisp product | blur 3–6px, offset-y 2px, opacity ~0.12 |
| hard brutalist | blur 0, offset 3–5px both axes, opacity 0.6–1.0 |

## Radius

Commit to a bucket: **sharp** 0–0.25rem, **balanced** 0.5rem, **soft** 0.75–1.4rem.
"0.5rem because it's the default" is a named failure — the bucket must be chosen BY the
personality, and 0rem is a legitimate, strong choice. The engine derives the whole scale
(×0.6 … ×2.6) from the one base value.

## Motion

Motion character is a brand lever equal to hue (Carbon's productive/expressive split):

- **Productive** (tools, enterprise, dev): 120–150ms default duration, crisp `ease-out`
  curves — the UI answers instantly.
- **Expressive** (consumer, premium, playful): 200–300ms, soft `ease-in-out` /
  gentle-overshoot curves — the UI performs a little.

Set the default-transition duration + easing tokens; leave per-component explicit
durations alone (they are compositions, not brand surface).

## Charts and sidebar

- `chart-1..5` is a DECLARED strategy, never leftovers: **categorical** (hues ≥30° apart
  at similar lightness/chroma, sanity-checked against the Okabe-Ito colorblind-safe
  reference) or **sequential** (one-hue ramp for magnitude data). Say which in the guide.
- Never color-only meaning — the chart components already ship sr-only data tables; keep
  series distinguishable by position/label too.
- **Sidebar echoes the main palette** (tinted neutral of the same hue, brand primary
  reused) — never an independent second palette.

## Uniqueness discipline

Uniqueness is designed in before the first token, then measured after.

1. **Territory scan first**: read the existing anchors (every vendored palette + every
   generated brand) and list the 3 nearest occupied hues to the brief's likely territory.
2. **Floors** (hard): primary-anchor ΔE ≤ the dedupe floor vs ANY anchor = same theme —
   stop and re-anchor. Hue distance < 30° to the nearest anchor requires ≥ 3 tuple
   dimensions differing from that neighbor.
3. **The default-blue attractor** (~250–265°) is opt-in only: enter it when the brief
   demands it, and record the justification in the guide.
4. **The crowded-wheel reality** (measured over a catalogue of ~50 palettes): once a
   catalogue passes roughly forty anchors, NO chromatic hue clears 30° from every one of
   them — the widest gap anywhere is under 50°.
   The floor's operative form is therefore the tuple rule; the winning move is an arc
   whose sub-30° neighbors all belong to FOREIGN personality clusters (their tuples
   diverge from yours structurally), never the heartland of your own cluster where
   same-cluster neighbors share your tuple direction and differentiation collapses.
5. **On collision** after one re-anchor cycle: shift hue ≥30° within the personality's
   matrix territory, or keep the hue and differentiate on 3+ tuple dimensions, or ask the
   user — in that order.

## Accessibility — the current bar

Design toward ≥4.5:1 for every foreground/surface text pair in BOTH modes; the engine's
AA clamp enforces it mechanically (foreground lightness bisection, hue/chroma preserved)
and fails the build on residuals. Your goal is that the clamp is a NO-OP — if it moves a
token more than a hair, the lightness architecture was wrong: re-derive, don't ship
clamp-mangled values. Non-text UI (border/input/ring, chart marks) targets 3:1 against
its surface. Never emit the tinted-surface trap — low-alpha brand tint + same-hue text
(the `bg-primary/10 text-primary` pattern failed 43 of 80 preset-modes in production).
This is the whole bar: AA by clamp + visible focus ring. Do not gold-plate toward WCAG
AAA and do not relitigate accessibility per theme.

## Anti-patterns

- Default blue (250–265°) with no brief justification — the attractor everyone falls into.
- 0.5rem radius, black shadows, system font: three "defaults" = no brand at all.
- Dark mode as lightness inversion (vibrating saturated accents, black background).
- Pure-white cards on a branded page (the undertint is the brand).
- A third type family to fix a hierarchy problem that weight/size/tracking should solve.
- Designing to the clamp — shipping whatever the repair net caught instead of re-deriving.
- One-lever "uniqueness": a new hue on an otherwise-zinc theme.
