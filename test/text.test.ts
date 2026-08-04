import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHARS_PER_TOKEN, approxTokens, compareStrings, fitsContext } from '../src/text.ts'
import { planBatches } from '../src/embed.ts'

test('approxTokens rounds up and handles the empty string', () => {
  assert.equal(approxTokens(''), 0)
  assert.equal(approxTokens('abc'), 1, '3 / 3.5 rounds up to 1')
  assert.equal(approxTokens('a'.repeat(35)), 10)
  assert.equal(approxTokens('a'.repeat(36)), 11, 'never rounds down')
  assert.equal(CHARS_PER_TOKEN, 3.5)
})

test('fitsContext includes the exact boundary', () => {
  // build.ts threw only ABOVE the limit while verify.ts passed only BELOW it, so
  // a chunk at exactly the limit passed the build and failed verify. One shared
  // predicate ends that class of disagreement.
  assert.equal(fitsContext(32768, 32768), true)
  assert.equal(fitsContext(32769, 32768), false)
  assert.equal(fitsContext(0, 32768), true)
})

// planBatches is what makes a build 3.5x faster; its invariants are cheap to
// state and expensive to lose. Property-style over random lengths.
const lengths = (seed: number, n: number): string[] => {
  let x = seed
  return Array.from({ length: n }, () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return 'a'.repeat(1 + (x % 4000))
  })
}

test('planBatches is a permutation of the input indices', () => {
  for (const seed of [1, 7, 42, 9001]) {
    const texts = lengths(seed, 120)
    const flat = planBatches(texts).flat()
    assert.equal(flat.length, texts.length, `seed ${seed}: every index appears`)
    assert.equal(new Set(flat).size, texts.length, `seed ${seed}: exactly once`)
    assert.deepEqual(
      [...flat].sort((a, b) => a - b),
      texts.map((_, i) => i),
      `seed ${seed}: indices are the original ones`,
    )
  }
})

test('planBatches keeps padded width within budget unless one item exceeds it', () => {
  const budget = 8192
  const texts = lengths(3, 200)
  for (const batch of planBatches(texts, budget)) {
    const widest = Math.max(...batch.map((i) => approxTokens(texts[i]!)))
    const padded = widest * batch.length
    assert.ok(
      padded <= budget || batch.length === 1,
      `padded width ${padded} exceeds ${budget} with ${batch.length} items`,
    )
  }
})

test('planBatches groups by length and executes widest-first', () => {
  // The composition regression it guards: batching in registry order padded
  // 60-token cards out to the 6,732-token sidebar — 3.6x wasted compute and
  // ~8 GB RSS. Inside a batch, members are length-neighbors (ascending).
  const texts = ['a'.repeat(20000), 'b', 'c'.repeat(10000), 'd']
  const batches = planBatches(texts)
  for (const batch of batches) {
    const sizes = batch.map((i) => approxTokens(texts[i]!))
    assert.deepEqual(
      sizes,
      [...sizes].sort((a, b) => a - b),
    )
  }
  // The execution regression it guards: the single-longest batch is the
  // peak-memory step; running it first (process youngest) is what keeps a big
  // corpus from being OOM-killed at chunk N-1 of N.
  const widths = batches.map((batch) => Math.max(...batch.map((i) => approxTokens(texts[i]!))))
  assert.deepEqual(
    widths,
    [...widths].sort((a, b) => b - a),
  )
})

test('planBatches isolates an oversize item in its own batch', () => {
  const texts = ['x'.repeat(100_000), 'y', 'z']
  const batches = planBatches(texts, 8192)
  const big = batches.find((b) => b.includes(0))
  assert.deepEqual(big, [0], 'a single item wider than the budget still gets embedded, alone')
})

test('planBatches handles the empty input', () => {
  assert.deepEqual(planBatches([]), [])
})

test('compareStrings orders by code point, not by the host locale', () => {
  // The concrete pair from the shipped corpus: Czech collates "ch" as one
  // letter AFTER "h", so a cs host would sort chart-area after hero-video and
  // cut a different k out of the same ranked list. Both are real item names.
  assert.ok(compareStrings('chart-area', 'hero-video') < 0)
  assert.ok(new Intl.Collator('cs').compare('chart-area', 'hero-video') > 0)
})

test('compareStrings is a total order', () => {
  assert.equal(compareStrings('button', 'button'), 0)
  assert.equal(compareStrings('a', 'b'), -1)
  assert.equal(compareStrings('b', 'a'), 1)
  assert.ok(compareStrings('dialog', 'dialog-2') < 0, 'a prefix precedes its extension')

  const names = ['dialog', 'Dialog', 'alert-dialog', 'alert', 'dialog-2', 'Ábaco']
  const sorted = [...names].sort(compareStrings)
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(compareStrings(sorted[i - 1]!, sorted[i]!) <= 0, `${sorted[i - 1]!} <= ${sorted[i]!}`)
  }
  assert.deepEqual([...sorted].sort(compareStrings), sorted, 'sorting twice is a fixed point')
})
