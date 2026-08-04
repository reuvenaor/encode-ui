// The labeled query set: ONE loader, ONE shape, validated against the index.
//
// run-eval.ts and sweep.ts each declared their own EvalQuery and read the JSON
// themselves, and nothing checked the file's promise that "every `expect` name
// is a real item" — a component rename would have rotted the eval silently.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { knownNames } from '../src/items.ts'
import type { DB } from '../src/db.ts'

export interface EvalQuery {
  q: string
  /**
   * The RELEVANT SET — a hit is any expected item appearing in the top-k.
   * Empty ONLY for kind:absence (the registry genuinely has nothing).
   */
  expect: string[]
  /**
   * Hard negatives: items that must NOT appear in the top-5, scored as
   * violation@5. Required for kind:negation; allowed on any kind.
   */
  forbid?: string[]
  kind: string
}

const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * Load queries.json and validate every label against the index. Throws (rather
 * than warns) on an unknown name: an eval scored against labels the corpus does
 * not contain is measuring nothing.
 */
export function loadQueries(db: DB, file = path.join(HERE, 'queries.json')): EvalQuery[] {
  const { queries } = JSON.parse(readFileSync(file, 'utf8')) as { queries: EvalQuery[] }
  const known = knownNames(db)
  const bad: string[] = []
  for (const q of queries) {
    for (const name of [...q.expect, ...(q.forbid ?? [])]) {
      if (!known.has(name)) bad.push(`"${q.q}" labels unknown item ${name}`)
    }
    // The kind invariants: an absence query claims the registry has NOTHING, so
    // an expect label contradicts it; every other kind is meaningless without
    // one; a negation query IS its forbid list.
    if (q.kind === 'absence' && q.expect.length > 0) {
      bad.push(`"${q.q}" is kind:absence but carries expect labels`)
    }
    if (q.kind !== 'absence' && q.expect.length === 0) {
      bad.push(`"${q.q}" has no expect labels (only kind:absence may)`)
    }
    if (q.kind === 'negation' && (q.forbid?.length ?? 0) === 0) {
      bad.push(`"${q.q}" is kind:negation but has no forbid labels`)
    }
  }
  if (bad.length > 0) {
    throw new Error(`eval labels are invalid:\n  ${bad.join('\n  ')}`)
  }
  return queries
}
