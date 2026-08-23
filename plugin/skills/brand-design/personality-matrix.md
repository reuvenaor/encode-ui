# Personality matrix — brief → token direction

Route the brief's personality words to a row, then COMMIT to the whole row (coherence
rule in [SKILL.md](SKILL.md)). Hue territories are OKLCH degrees — starting territory,
not a cage; the uniqueness territory-scan may push you to the unoccupied part of it.

| Cluster | Brief words | Hue territory | Chroma | Lightness | Radius | Shadows | Tracking | Motion | Pairing direction | Charts |
|---|---|---|---|---|---|---|---|---|---|---|
| Trust & precision | fintech, legal, medical, exact, calm confidence | teal 180–210 · slate-cyan 210–240 · deep green 150–170 | hushed–balanced | paper light / ink-dark-first | sharp–balanced | barely-there or crisp | −0.01em | productive | neutral grotesk + dev mono (Inter / Geist class) | sequential, or 2-hue categorical |
| Playful & bold | creative tools, kids, games, joyful, energetic | coral 20–45 · magenta 330–355 · orange 45–70 | saturated–neon | airy light | soft | soft premium, tinted | 0 | expressive | geometric friendly sans (DM Sans, Outfit class) | vivid categorical, CVD-checked |
| Luxury & premium | fashion, jewelry, hospitality, editorial gold-on-ink | gold/bronze 75–95 · oxblood 15–30 · ink 260–290 hushed | hushed | dusky / ink-dark-first | balanced–soft | soft large-blur, warm-tinted | +0.02em display, 0 body | expressive | high-contrast serif display + quiet sans (Playfair/Fraunces + Inter) | sequential, metallic ramp |
| Organic & wellness | health, sustainability, food-natural, mindful | green 130–160 · sage 110–130 · earth 60–85 | hushed–balanced | paper, warm | soft | soft, green-tinted | 0 | expressive-slow | humanist sans + serif body (Lora class) | sequential greens or earth categorical |
| Technical & brutalist | dev tools, engineering, terminal, raw | any high-contrast anchor; often red 25–35 · green 140 on near-black | saturated | ink-dark-first or stark paper | sharp (0) | hard offset, 0 blur | +0.02em+ | productive | mono-forward (Space Mono, JetBrains Mono lead) | categorical, few series, hard hues |
| Editorial & literary | publishing, portfolio, longform, considered | ink 260–290 hushed · burgundy 0–20 · forest 150–170 | hushed | paper | balanced | barely-there | 0 body, −0.01 display | productive | serif-led (Lora/Fraunces body or display) + sans UI | sequential, restrained |
| Energetic consumer | fitness, food-fast, events, deals, loud | red-orange 25–50 · lime 110–130 · hot pink 340–360 | neon | airy light | balanced–soft | crisp product | −0.01em | productive-fast | condensed-feel sans, heavy weights | vivid categorical |
| Calm & minimal | notes, productivity, focus, quiet | any hue at hushed chroma; violet-gray 270–300 · warm gray 60–80 | hushed | airy light / dusky dark | balanced | barely-there | −0.01em | productive | single neutral family, weight-only hierarchy | single-hue sequential |

## Routing heuristics (token routing)

When the user asks for an ADJUSTMENT rather than a brand, move only the tokens the
request names:

| Request | Tokens to move |
|---|---|
| "make it [color]" | `primary`, `ring`, `sidebar-primary` (+ `accent` if the brief implies it) |
| "warmer / cooler" | undertint hue of `background`, `card`, `muted`, `border`, `shadow-color` |
| "background darker/lighter" | `background`, `card`, `popover`, `muted`, `sidebar` — not the accent |
| "more premium" | chroma down, contrast up, serif display, softer larger shadows, slower motion |
| "more energetic" | chroma up, radius up a bucket, accent frequency up, motion faster |
| "softer" | radius up a bucket, shadow blur up, opacity down, tracking toward 0 |
| "more technical" | mono share up, tracking positive, radius down a bucket, shadows harder |

Guardrail: an adjustment never silently changes the tuple's other dimensions — if the
request implies a personality change ("actually make it brutalist"), re-route through the
matrix as a new concept instead.
