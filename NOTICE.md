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
from **tweakcn** (https://github.com/jnsahaj/tweakcn, Apache-2.0 — the full licence text is
reproduced in the [annex](#annex-apache-license-20) below; tweakcn's repository carries no
NOTICE file) plus the neutral `zinc` from **shadcn/ui** (MIT, covered by the notice above).
Palette data are colour tokens, not code.

**Modified from upstream.** Twelve tweakcn palettes shipped a `--destructive` / foreground pair
at 3.76:1, below the WCAG AA 4.5:1 text minimum; those pairs are darkened in `presets.json`.
Additionally, every text-bearing foreground/surface pair is **WCAG-AA-clamped at build time**
(`scripts/theme-resolve.mjs`, run by `npm run themes` / `npm run manifest`): a pair under 4.5:1
has its foreground's OKLCH lightness moved just far enough to pass, chroma and hue preserved.
The vendored JSON stays as published; the clamp re-applies automatically on any re-sync, and a
pair the clamp cannot repair fails the build.

## Fonts (`public/fonts/`)

The self-hosted font library (latin subsets, woff2, sourced via Fontsource's CDN mirror of
Google Fonts) — every family under the **SIL Open Font License 1.1**, with the family's own
`OFL.txt` (copyright line included) committed alongside its files:

| Family | Directory | Upstream |
|---|---|---|
| Inter | `public/fonts/inter/` | https://github.com/rsms/inter |
| Space Grotesk | `public/fonts/space-grotesk/` | https://github.com/floriankarsten/space-grotesk |
| DM Sans | `public/fonts/dm-sans/` | https://github.com/googlefonts/dm-fonts |
| Instrument Sans | `public/fonts/instrument-sans/` | https://github.com/Instrument/instrument-sans |
| Geist | `public/fonts/geist/` | https://github.com/vercel/geist-font |
| Plus Jakarta Sans | `public/fonts/plus-jakarta-sans/` | https://github.com/tokotype/PlusJakartaSans |
| Manrope | `public/fonts/manrope/` | https://github.com/sharanda/manrope |
| Bricolage Grotesque | `public/fonts/bricolage-grotesque/` | https://github.com/ateliertriay/bricolage |
| Figtree | `public/fonts/figtree/` | https://github.com/erikdkennedy/figtree |
| JetBrains Mono | `public/fonts/jetbrains-mono/` | https://github.com/JetBrains/JetBrainsMono |
| Space Mono | `public/fonts/space-mono/` | https://github.com/googlefonts/spacemono |
| Geist Mono | `public/fonts/geist-mono/` | https://github.com/vercel/geist-font |
| IBM Plex Mono | `public/fonts/ibm-plex-mono/` | https://github.com/IBM/plex |
| Playfair Display | `public/fonts/playfair-display/` | https://github.com/clauseggers/Playfair-Display |
| Lora | `public/fonts/lora/` | https://github.com/cyrealtype/Lora-Cyrillic |
| Fraunces | `public/fonts/fraunces/` | https://github.com/undercasetype/Fraunces |
| Instrument Serif | `public/fonts/instrument-serif/` | https://github.com/Instrument/instrument-serif |
| EB Garamond | `public/fonts/eb-garamond/` | https://github.com/octaviopardo/EBGaramond12 |
| Newsreader | `public/fonts/newsreader/` | https://github.com/productiontype/Newsreader |
| Bitter | `public/fonts/bitter/` | https://github.com/solmatas/BitterPro |
| Architects Daughter | `public/fonts/architects-daughter/` | https://fonts.google.com/specimen/Architects+Daughter |

The manifest is `src/themes/fonts.json`; `scripts/build-themes.mjs` emits `@font-face` rules
only for families a theme preset references.

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

## Runtime-downloaded model weights (not redistributed)

The MCP server's optional `db` engine embeds queries with
**Qwen3-Embedding-0.6B** — model id `onnx-community/Qwen3-Embedding-0.6B-ONNX` on Hugging
Face (https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX), an ONNX conversion
of Qwen/Qwen3-Embedding-0.6B — **Apache-2.0, © the Qwen team (Alibaba Cloud)**. The weights
are **not** vendored, committed, or shipped in any artifact of this project: they are
downloaded at first use by `@huggingface/transformers` (Apache-2.0) into the local cache
(`~/.cache/encode-ui-rag/models` by default) on the consumer's own machine. Nothing here
redistributes the model; this section exists for disclosure. The Apache-2.0 text is
reproduced in the annex below.

## The `encode-ui` npm package

The MCP server publishes as `encode-ui`. Its tarball ships a prebuilt index that carries
**component source**, including the items adapted from the MIT sources listed above — so this
NOTICE and the MIT LICENSE are shipped inside the package alongside it, which is what keeps
those permission notices travelling with the code they cover.

## Annex: Apache License 2.0

The full text of the Apache License, Version 2.0, as carried by the tweakcn repository,
covering the vendored palette data credited above:

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
