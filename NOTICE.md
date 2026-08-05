# NOTICE — third-party sources & attribution

Encode UI is Copyright (c) 2026 **Reuven Naor** and licensed under the MIT License (see
[LICENSE](LICENSE)). Questions about licensing or attribution: <info@reuvenaor.com>.

The encode-ui registry ships **our own component library**: every item is authored or
rewritten in-repo to the encode-ui design system (semantic OKLCH tokens, logical-direction
RTL-safe utilities, React 19 ref-as-prop, `motion/react`, reduced-motion support,
jsx-a11y-strict). Where an item derives from an MIT-licensed source, that source is credited
below and in the item's own header.

## Provenance classes

Every item's `meta.provenance` in `registry.json` records one of:

| Class | Meaning | Attribution mechanism |
|---|---|---|
| `shadcn` | Pulled from the upstream `@shadcn` registry (MIT) | `meta.license` + this file |
| `adapted:<source>` | Rewritten from an MIT source into our contract | Per-file header carrying the source's copyright line + a pointer here, plus `meta.license` |
| `original` | Authored here; no third-party code | `meta.provenance` — nothing to attribute |
| themes: `vendored` | OKLCH palette data (tokens, not code) | See “Theme palettes” below |

`original` items carry **no attribution comment**. Component *concepts* are not copyrightable
(17 U.S.C. §102(b) excludes any "idea, procedure, process, system, method of operation,
concept"), so an item we authored ourselves owes no credit to whoever popularized the pattern.

## MIT sources used for adaptation

Each source's MIT grant permits redistribution and adaptation **provided the copyright notice
and the permission notice are preserved**. The copyright line travels in each adapted file's
header; the permission notice is reproduced in full below and pointed at from those headers.

| Source | Copyright | URL |
|---|---|---|
| shadcn/ui | Copyright (c) shadcn | https://ui.shadcn.com · https://github.com/shadcn-ui/ui |
| Magic UI | Copyright (c) Magic UI | https://github.com/magicuidesign/magicui |
| chanhdai.com | Copyright (c) 2026 Chánh Đại | https://github.com/ncdai/chanhdai.com |

### The MIT permission notice

All three sources above are licensed under the MIT License. The notice below applies to each of
them, with that source's copyright line from the table above:

```
MIT License

Copyright (c) <the holder named above>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**If you install an adapted item, this notice comes with it.** The warranty disclaimer is the
upstream author's liability shield and is part of what their grant requires you to carry
forward, so keep the header (and a copy of this notice) in your own distribution.

## Theme palettes (`theme-*` items)

The 40 OKLCH palettes in `src/themes/presets.json` are a vendored catalogue: 39 named palettes
from **tweakcn** (https://github.com/jnsahaj/tweakcn, Apache-2.0, licence at
https://www.apache.org/licenses/LICENSE-2.0) plus the neutral `zinc` from **shadcn/ui** (MIT,
covered by the notice above). Palette data are colour tokens, not code.

**Modified from upstream.** Twelve tweakcn palettes shipped a `--destructive` / foreground pair
at 3.76:1, below the WCAG AA 4.5:1 text minimum; those pairs are darkened in `presets.json`.
No other palette values are changed.

## Icon metadata (Lucide)

`src/lucide-icons.json` in the MCP package vendors **metadata only** — icon names, tags,
categories, and alias records from the Lucide monorepo's `icons/*.json` files, pinned to the
tag the registry pins for `lucide-react`. No SVG geometry and no component code are copied;
the icons themselves reach consumers solely via the `lucide-react` npm package that registry
items declare as a dependency.

- **Lucide** — ISC, © Lucide Contributors — https://github.com/lucide-icons/lucide/blob/main/LICENSE
- Portions of Lucide are derived from **Feather** — MIT, © 2013-2022 Cole Bemis (the
  LICENSE file above enumerates the ~110 affected icons)

Both notices are also embedded in the artifact's `license` key.

## The `encode-ui` npm package

The MCP server publishes as `encode-ui`. Its tarball ships a prebuilt index that carries
**component source**, including the items adapted from the MIT sources listed above — so this
NOTICE and the MIT LICENSE are shipped inside the package alongside it, which is what keeps
those permission notices travelling with the code they cover.
