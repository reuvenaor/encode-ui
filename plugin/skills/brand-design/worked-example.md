# Worked example — an annotated miniature

Twelve representative tokens for an imagined brand — **"Ledgerline"**, trust & precision
fintech, deep-teal anchor (hue 195), sharp-balanced, barely-there shadows, Inter +
JetBrains Mono, productive motion. Each line shows the WHY that a complete entry needs
for every token. When the engine you loaded points at shipped brand guides, read one
alongside its own entry — a real brand carried end to end teaches more than this
miniature can.

```jsonc
"light": {
  // Radix step 1 — NOT pure white: the teal undertint at trace chroma IS the brand.
  "background": "oklch(0.985 0.005 195)",
  // Step 12 — near-black pulled toward the anchor hue, never #000.
  "foreground": "oklch(0.22 0.015 200)",
  // Step 2 — one visible step below background, same hue family.
  "muted": "oklch(0.955 0.008 195)",
  // Step 11 — passes 4.5:1 on background AND card by DESIGN (the clamp should no-op).
  "muted-foreground": "oklch(0.48 0.03 200)",
  // Step 9 — the anchor: max chroma of the whole ramp lives here and only here.
  "primary": "oklch(0.45 0.11 195)",
  // On-primary text: lightness chosen for ≥4.5:1 on the anchor — checked, not hoped.
  "primary-foreground": "oklch(0.97 0.01 195)",
  // Step 7 — border carries the undertint too; ring = primary lifted one step.
  "border": "oklch(0.90 0.012 195)",
  "ring": "oklch(0.55 0.10 195)",
  // Destructive: red-family, but at THIS brand's chroma ceiling — not a neon import.
  "destructive": "oklch(0.50 0.13 25)",
  // Charts declared: sequential teal ramp (financial magnitude data), 5 stops of one hue.
  "chart-1": "oklch(0.65 0.09 195)",
  "radius": "0.375rem",            // sharp-balanced: precision, not severity
  "font-sans": "Inter",            // manifest name — resolver appends the fallback stack
  "letter-spacing": "-0.01em",     // modern-negative, the trust cluster's signature
  "shadow-color": "oklch(0.35 0.04 200)", // ambient teal-gray, never pure black
  "shadow-opacity": "0.07",        // barely-there: elevation whispers
  "default-transition-duration": "130ms"  // productive: the ledger answers instantly
},
"dark": {
  // Re-derivation, not inversion: brand hue at low chroma/lightness — not black.
  "background": "oklch(0.17 0.012 200)",
  // Elevation = LIGHTER surface, not heavier shadow.
  "card": "oklch(0.21 0.014 200)",
  // Anchor desaturated ~25% and lifted — saturated teal vibrates on dark ground.
  "primary": "oklch(0.62 0.085 195)",
  // Alpha border: adapts to any surface it crosses.
  "border": "oklch(1 0 0 / 10%)",
  // Dark shadows: same geometry, opacity up (0.07 → 0.28).
  "shadow-opacity": "0.28"
}
```

What the miniature demonstrates, in order: undertinted neutrals (1, 3), the Radix role
mapping (1→background, 2→muted, 9→primary, 11/12→text), designed-not-clamped contrast
(4, 6), accent scarcity via a single max-chroma token (5), harmonized destructive (9),
a DECLARED chart strategy (10), and dark as re-derivation (background/card/primary/
border/shadow-opacity). A real entry sets every token of the v2 surface with this level
of intent — Partial-merge is legacy compatibility, not a shortcut.
