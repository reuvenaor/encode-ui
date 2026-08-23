# Font pairings — proven combinations

Pairings that ship well together (x-heights compatible, contrast deliberate). All are
open-licence families available from Fontsource or Google Fonts.

Whether a family is ready to USE is your engine's question, not this table's: the engine
skill you loaded says how a family becomes available (a self-hosted manifest, a Fontsource
install, a `@font-face` block you write). Check there before committing to a pairing, and
when the brief demands a face your pipeline cannot serve, ask the user rather than
silently substituting.

| Pairing (sans + mono [+ serif]) | Personality fit | Note |
|---|---|---|
| Inter + JetBrains Mono | trust, product, calm-minimal | the neutral workhorse; hierarchy by weight |
| Space Grotesk + Space Mono | technical, display-forward, indie | shared skeleton — grotesk display over mono body accents |
| DM Sans + Space Mono | playful-geometric, friendly tools | round geometry vs boxy mono tension |
| Playfair Display + Inter (+ Lora body) | luxury, editorial gold-on-ink | high-contrast serif DISPLAY ONLY; Inter carries UI |
| Fraunces + DM Sans | organic-premium, food, expressive | Fraunces's soft wonk headlines over clean geometric UI |
| Lora + Inter | editorial body, longform, considered | serif body text, sans UI chrome |
| Architects Daughter + system mono | notebook, sketch, human | novelty face — headlines/accents; body legibility suffers at length |
| Outfit + Fira Code + Merriweather | modern SaaS with warmth | proven in the wild |
| Plus Jakarta Sans + IBM Plex Mono + Lora | rounded-professional | proven in the wild |
| Geist + Geist Mono | Vercel-school minimal | superfamily — zero pairing risk |
| Montserrat + Space Mono + Lora | geometric display, event/consumer | wide caps love positive tracking |
| Manrope + IBM Plex Mono | civic, official, precise | semi-geometric with institutional calm |

Rules:

- The MONO matters even for non-technical brands — code blocks, kbd and numbers appear
  wherever `font-mono` is called, and a mismatched mono breaks the spell.
- Serif slots are optional; only luxury/editorial/organic personalities usually earn one.
- Weight range check: the chosen family's variable axis must cover 400–700 (UI regular +
  semibold); display-only faces with a 400-only cut (Architects Daughter) stay accents.
- Never a CDN or Google Fonts `<link>` in shipped output — the family is self-hosted or
  installed as a package, so the app has no third-party request on first paint.
