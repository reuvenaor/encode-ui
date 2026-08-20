// The theme tool: the registry's OWN brand-theme pipeline, run over a candidate.
//
// Everything else here answers "what component should I install?". This one
// answers "is this brand theme shippable?", and it is the only tool whose input
// is authored rather than looked up. It exists because design advice without
// enforcement is just prose: the registry's 48 themes each passed a WCAG-AA
// clamp and a uniqueness check before shipping, and a consumer theming their own
// app deserves the same two instruments rather than an eyeballed guess.
//
// It computes and returns. Nothing is written, nothing is fetched — the whole
// pipeline is the vendored engine core, which is pure math (see
// ../theme-engine-core.ts). The agent takes the returned cssVars block and
// writes it into the consumer's own globals.css.
import {
  AA_TARGET,
  CONTRAST_PAIRS,
  clampPresets,
  parseOklch,
  ratio,
  themePayloadVars,
  validatePresets,
} from '../theme-engine-core.ts'
import { nearestAnchors, verdictFor, DEFAULT_BLUE_BAND, DEDUPE_FLOOR } from '../theme-anchors.ts'
import { ToolError, annotations, guarded, ok } from './result.ts'
import { renderThemeReport } from './render.ts'
import { ValidateThemeInput, ValidateThemeOutput } from './schemas.ts'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ModeVars } from '../theme-engine-core.ts'
import type { RegistryContext } from './context.ts'

const FONT_KEYS = ['font-sans', 'font-serif', 'font-mono'] as const

interface Pair {
  mode: string
  foreground: string
  surface: string
  ratio: number
  passes: boolean
}

/** Every CONTRAST_PAIRS combination that could be measured in one mode. */
function measurePairs(mode: string, vars: ModeVars): Pair[] {
  const pairs: Pair[] = []
  for (const [fgTok, surfaces] of CONTRAST_PAIRS) {
    const fg = parseOklch(vars[fgTok])
    if (!fg) continue
    for (const surface of surfaces) {
      const bg = parseOklch(vars[surface])
      if (!bg) continue
      const r = Math.round(ratio(fg, bg) * 100) / 100
      pairs.push({ mode, foreground: fgTok, surface, ratio: r, passes: r >= AA_TARGET })
    }
  }
  return pairs
}

export function registerThemeTools(server: McpServer, ctx: RegistryContext): void {
  server.registerTool(
    'validate_theme',
    {
      title: 'Validate a brand theme against the registry engine',
      description:
        'Run a candidate brand theme through the SAME engine every theme in this registry ' +
        'passed before shipping, and get back a report plus paste-ready CSS variables. ' +
        'Checks three things: SCHEMA (all 32 colour tokens present in both modes, no unknown ' +
        'keys), CONTRAST (every foreground/surface pair against WCAG AA 4.5:1, with the ' +
        'clamp showing exactly which tokens it would have to move — a clamp that fires ' +
        'beyond noise means redesign, not accept), and UNIQUENESS (OKLab ΔE and hue distance ' +
        `from all ${ctx.anchors.palettes.length} shipped palettes, so a brand does not land ` +
        'on a stock theme). Returns the `cssVars` block in the exact shape a registry:theme ' +
        'payload ships, ready for a consumer\'s globals.css. Pure computation: nothing is ' +
        'written, nothing is fetched. Font keys must be FULL CSS stacks with fallbacks ' +
        '("Inter, ui-sans-serif, system-ui, sans-serif"), since this server cannot host ' +
        'font files for you.',
      inputSchema: ValidateThemeInput,
      outputSchema: ValidateThemeOutput.shape,
      annotations: annotations(ctx.engine.kind),
    },
    async ({ slug, light, dark, character }): Promise<CallToolResult> =>
      guarded('validate_theme', ctx.engine.kind, () => {
        // A bare family name would resolve against the registry's own font
        // manifest, which a consumer does not have — catch it here so the
        // engine's repo-specific message never reaches the model.
        for (const key of FONT_KEYS) {
          const value = light[key]
          if (value !== undefined && !value.includes(',')) {
            throw new ToolError(
              `${key} is "${value}", a bare family name. Pass a full CSS stack with ` +
                `fallbacks instead, e.g. "${value}, ui-sans-serif, system-ui, sans-serif" — ` +
                'this server cannot host font files, so the stack is what the consumer ships.',
            )
          }
        }

        const entry = { character: character ?? slug, light, dark }
        const { errors, warnings } = validatePresets({ [slug]: entry })

        // Uniqueness is measurable from `primary` alone, so it is reported even
        // for an entry too incomplete to resolve — that is the number a designer
        // wants EARLY, while the palette can still move.
        const primary = parseOklch(light.primary)
        const nearest = primary ? nearestAnchors(ctx.anchors, primary, 3, slug) : []
        const closest = nearest[0]
        const notes: string[] = []
        if (!primary) {
          notes.push('`primary` is missing or not an oklch() value, so uniqueness is unmeasured.')
        }
        const defaultBlue =
          primary !== null &&
          primary.C >= 0.03 &&
          primary.H >= DEFAULT_BLUE_BAND[0] &&
          primary.H <= DEFAULT_BLUE_BAND[1]
        if (defaultBlue) {
          notes.push(
            `The anchor sits at ${primary?.H.toFixed(1)}°, inside the ${DEFAULT_BLUE_BAND[0]}–` +
              `${DEFAULT_BLUE_BAND[1]}° default-blue band. Entering it is a decision to record ` +
              'in the brand guide, not a default to drift into.',
          )
        }
        if (closest && closest.dEok <= DEDUPE_FLOOR) {
          notes.push(
            `ΔEok ${closest.dEok} from ${closest.label} is at or under the ${DEDUPE_FLOOR} ` +
              'dedupe floor — this reads as the same colour. Re-anchor the hue.',
          )
        } else if (closest && closest.dHue !== null && closest.dHue < 30) {
          notes.push(
            `Only ${closest.dHue}° of hue separates this from ${closest.label}. That is ` +
              'shippable, but the other levers — radius, shadows, type, tracking, motion — ' +
              'have to carry the difference.',
          )
        }

        const uniqueness = {
          anchor: primary ? { l: primary.L, c: primary.C, h: primary.H } : null,
          nearest,
          verdict: verdictFor(closest),
          defaultBlue,
          notes,
        }

        if (errors.length > 0) {
          // A schema failure is a REPORT, not a tool error: the caller asked what
          // is wrong, and half an answer plus the uniqueness reading beats a throw.
          const out: ValidateThemeOutput = {
            slug,
            valid: false,
            errors,
            warnings,
            contrast: { target: AA_TARGET, residuals: [], clampLog: [], skips: [], pairs: [] },
            uniqueness,
            cssVars: null,
            css: null,
          }
          return ok(renderThemeReport(out), out)
        }

        // Clamp the RAW entry, exactly as the registry's own build does, then
        // split the clamped result — so what the report blesses is what ships.
        const { presets, report } = clampPresets({ [slug]: entry })
        const clamped = presets[slug]
        if (!clamped) throw new ToolError('The clamp returned no entry for this slug.')

        // Sorted across BOTH modes: the tightest pair in the whole theme is the
        // one a designer needs first, whichever mode it lives in.
        const pairs = [
          ...measurePairs('light', clamped.light),
          ...measurePairs('dark', clamped.dark),
        ].sort((a, b) => a.ratio - b.ratio)
        const { cssVars, css } = themePayloadVars(clamped)

        const out: ValidateThemeOutput = {
          slug,
          valid: report.residuals.length === 0,
          errors,
          warnings,
          contrast: {
            target: AA_TARGET,
            residuals: report.residuals,
            clampLog: report.log,
            skips: report.skips,
            pairs,
          },
          uniqueness,
          cssVars,
          css: css ?? null,
        }
        return ok(renderThemeReport(out), out)
      }),
  )
}
