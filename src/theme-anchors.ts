// The catalogue's palette anchors — every shipped theme's light-mode primary in
// OKLCH, so `validate_theme` can tell a consumer whether their brand colour is
// distinguishable from the 48 themes this registry already ships.
//
// The artifact lives at the PACKAGE ROOT (rag/theme-anchors.json, like
// agent-index.json) so src/ (strip-types) and dist/ resolve the same file with
// no cp step. It is generated upstream by scripts/build-rag-theme-assets.mjs and
// never hand-edited; test/theme-core.test.ts pins it against its own digest and,
// when a registry checkout is present, against the engine core it was cut from.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dEok, dHue } from './theme-engine-core.ts'
import type { Oklch } from './theme-engine-core.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export interface PaletteAnchor {
  name: string
  label: string
  /** Light-mode `primary`, the colour a brand is recognised by. */
  anchor: { l: number; c: number; h: number }
}

export interface AnchorCatalog {
  readonly palettes: readonly PaletteAnchor[]
}

/** Resolved next to the package root — identical from src/ and dist/. */
export const defaultAnchorsPath = (): string => path.resolve(HERE, '..', 'theme-anchors.json')

/**
 * Fail-loud: the artifact ships inside the package, so a miss or a malformed
 * record is a PACKAGING bug, not a user error (the icons-catalog doctrine).
 */
export function loadAnchors(file: string = defaultAnchorsPath()): AnchorCatalog {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const palettes = (raw as { palettes?: unknown }).palettes
  if (!Array.isArray(palettes) || palettes.length === 0) {
    throw new Error(`theme-anchors.json is malformed or empty (${file})`)
  }
  for (const p of palettes as PaletteAnchor[]) {
    if (typeof p?.name !== 'string' || typeof p?.anchor?.l !== 'number') {
      throw new Error(`theme-anchors.json holds a malformed record (${file})`)
    }
  }
  return { palettes: palettes as PaletteAnchor[] }
}

const toOklch = (a: PaletteAnchor['anchor']): Oklch => ({ L: a.l, C: a.c, H: a.h })

export interface AnchorDistance {
  name: string
  label: string
  /** OKLab ΔE — the catalogue's dedupe floor is 0.02. */
  dEok: number
  /** Degrees; null when either anchor is near-achromatic (hue is noise there). */
  dHue: number | null
}

/**
 * The nearest shipped palettes to a candidate anchor, closest first.
 *
 * Uses the SAME dEok/dHue the registry's own uniqueness report runs, so a
 * consumer's number is comparable with the numbers in the brand guides.
 *
 * `exclude` drops one palette by name: re-validating a theme this registry
 * already ships would otherwise match itself at ΔE 0 and read as a duplicate.
 */
export function nearestAnchors(
  catalog: AnchorCatalog,
  candidate: Oklch,
  limit = 3,
  exclude?: string,
): AnchorDistance[] {
  return catalog.palettes
    .filter((p) => p.name !== exclude)
    .map((p) => ({
      name: p.name,
      label: p.label,
      dEok: dEok(candidate, toOklch(p.anchor)),
      dHue: dHue(candidate, toOklch(p.anchor)),
    }))
    .sort((a, b) => a.dEok - b.dEok)
    .slice(0, limit)
}

/** The catalogue's own floors, applied to a candidate's nearest neighbour. */
export const DEDUPE_FLOOR = 0.02
export const HUE_FLOOR = 30
/** shadcn/Tailwind's default blue sits here; entering it needs a stated reason. */
export const DEFAULT_BLUE_BAND: readonly [number, number] = [250, 265]

export type UniquenessVerdict = 'distinct' | 'crowded' | 'duplicate'

export function verdictFor(nearest: AnchorDistance | undefined): UniquenessVerdict {
  if (!nearest) return 'distinct'
  if (nearest.dEok <= DEDUPE_FLOOR) return 'duplicate'
  if (nearest.dHue !== null && nearest.dHue < HUE_FLOOR) return 'crowded'
  return 'distinct'
}
