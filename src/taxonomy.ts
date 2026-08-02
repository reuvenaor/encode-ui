// Group labels, read from the site's own site-data/groups.ts so the taxonomy has
// one home rather than two.
//
// Parsing beats importing here: groups.ts pulls in registry.json and the whole
// manifest layer, and this package deliberately shares nothing with the site's
// module graph. The regex is narrow and its failure is loud.
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Matches a `{ slug: 'x', label: 'Y', … }` entry in GROUPS or AUXILIARY_GROUPS,
 * on one line or several. The previous form required a newline between the two
 * keys, so a short entry prettier chose to keep inline would have parsed as
 * absent — silently, before assertLabelsCover existed to catch it.
 */
const ENTRY = /slug:\s*'([a-z-]+)',\s*label:\s*'([^']+)'/g

/** Pure half — testable against a fixture string, no filesystem. */
export function parseGroupLabels(source: string): Map<string, string> {
  const labels = new Map<string, string>()
  for (const m of source.matchAll(ENTRY)) labels.set(m[1]!, m[2]!)
  if (labels.size === 0) {
    throw new Error(
      'parsed no groups from site-data/groups.ts — the GROUPS literal shape changed; fix parseGroupLabels()',
    )
  }
  return labels
}

export const readGroupLabels = (root: string): Map<string, string> =>
  parseGroupLabels(readFileSync(path.join(root, 'src', 'site-data', 'groups.ts'), 'utf8'))

/**
 * Every slug the registry actually uses must have a label.
 *
 * This replaces a `labels.size < 15` floor, which was the wrong shape twice
 * over: it rots (GROUPS held 17 then, 19 now — the floor never moved), and it cannot catch
 * the failure that mattered — a slug the registry uses but the taxonomy never
 * names. That one is invisible to a count, and it is exactly what left 40 theme
 * items labelled "themes" instead of "OKLCH palettes".
 *
 * With this assertion in place, the `?? slug` fallback that hid it is
 * unreachable, so it is gone.
 */
export function assertLabelsCover(
  slugs: Iterable<string | null>,
  labels: ReadonlyMap<string, string>,
): void {
  const missing = [...new Set(slugs)]
    .filter((s): s is string => s !== null && !labels.has(s))
    .sort()
  if (missing.length > 0) {
    throw new Error(
      `no group label for ${missing.join(', ')} — add them to GROUPS or AUXILIARY_GROUPS ` +
        'in src/site-data/groups.ts',
    )
  }
}
