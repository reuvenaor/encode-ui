// Token estimation for batch planning, and the one context-window boundary rule.
//
// The estimate used to feed the truncation guard too; build.ts now counts REAL
// tokens with the model's own tokenizer (countTokens in embed.ts), because a
// guard and a budget need different accuracy — an estimate-based gate could pass
// a chunk the tokenizer would then silently truncate.

/**
 * Characters per token for TSX, measured against this corpus. Deliberately an
 * ESTIMATE — its one remaining consumer is batch planning (planBatches), which
 * only needs a bound. Erring low would silently under-budget, so this errs high.
 */
export const CHARS_PER_TOKEN = 3.5

export const approxTokens = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN)

/**
 * The boundary rule build.ts (gate) and verify.ts (audit) must share: a chunk
 * fits iff `n <= limit`. They used to disagree at exactly the limit — build
 * threw only above it, verify passed only below it.
 */
export const fitsContext = (nTokens: number, limit: number): boolean => nTokens <= limit

/**
 * Deterministic string order — the tie-break every ranked list ends on.
 *
 * `localeCompare` reads the HOST's collation, so the same query returns a
 * different k-cutoff on a different machine: under `LANG=cs_CZ` Czech collates
 * "ch" as one letter after "h", which reorders 98 of the 349 registry names
 * (`Intl.Collator('cs').compare('chart-area', 'hero-video')` is +1 where code
 * point order says -1). Server output must not depend on the operator's locale.
 */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Levenshtein distance, bounded by the shorter string. Shared by the component
 * "did you mean" (items.ts) and the icon catalog (icons.ts) — a few thousand
 * short names: microseconds.
 */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[b.length]!
}
