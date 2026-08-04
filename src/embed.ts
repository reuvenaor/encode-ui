// transformers.js wrapper. The ONLY place the model is invoked, so the pooling /
// normalize / prefix rules in config.ts cannot be bypassed by a second call site.
import { env, pipeline } from '@huggingface/transformers'
import {
  DIMS,
  MODEL_DTYPE,
  MODEL_ID,
  NORMALIZE,
  POOLING,
  asDocument,
  asQuery,
  modelCacheDir,
} from './config.ts'
import { approxTokens } from './text.ts'

type Extractor = ((
  texts: string[],
  opts: { pooling: string; normalize: boolean },
) => Promise<{ tolist(): number[][] }>) & {
  /** The pipeline's own tokenizer — encode() applies the model's real rules. */
  tokenizer: { encode(text: string): number[] }
}

let extractor: Extractor | null = null

/**
 * Load once per process. The MCP server is long-lived, so this is paid on the
 * first tool call only (~1s warm from cache; the first ever run downloads ~1.2 GB).
 */
export async function getExtractor(): Promise<Extractor> {
  if (extractor) return extractor
  // transformers.js v4 otherwise caches into node_modules/, which would make every
  // `npx` invocation re-download the weights.
  env.cacheDir = modelCacheDir()
  const pipe = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE })
  extractor = pipe as unknown as Extractor
  return extractor
}

/**
 * REAL token counts from the model's own tokenizer, over the exact document form
 * that gets embedded. approxTokens is an estimate the tokenizer can disagree
 * with (numeric-dense text runs well under 3.5 chars/token), and an
 * estimate-based truncation gate could pass a chunk the model then silently
 * truncates — the vectors would describe a prefix of the stored text.
 */
export async function countTokens(texts: readonly string[]): Promise<number[]> {
  const extract = await getExtractor()
  return texts.map((t) => extract.tokenizer.encode(asDocument(t)).length)
}

async function encode(texts: string[]): Promise<number[][]> {
  const extract = await getExtractor()
  const out = await extract(texts, { pooling: POOLING, normalize: NORMALIZE })
  const vectors = out.tolist()
  const width = vectors[0]?.length
  if (width !== DIMS) {
    throw new Error(
      `embedding width ${width} != configured DIMS ${DIMS} — config.ts and the model disagree`,
    )
  }
  return vectors
}

/**
 * Peak padded width of one batch, in tokens. A transformer pads every sequence in a
 * batch to the longest one, so cost is `max(len) × count`, not `sum(len)`. Budgeting
 * on that product bounds both compute and peak memory per step.
 */
const BATCH_TOKEN_BUDGET = 8192

/**
 * Length-sorted, token-budgeted batches over the ORIGINAL indices.
 *
 * This corpus mixes ~60-token doc cards with a 6,732-token component (`sidebar`).
 * Batching those together in registry order pads every short chunk out to the
 * longest in its batch: measured 676k padded token-slots for 185k real tokens
 * (3.6x waste), which is what made a naive build take 17+ minutes and 7.9 GB RSS.
 * Sorting by length first collapses that to ~1.0x — a 3.5x speedup — and caps the
 * widest step at one long sequence instead of eight.
 */
export function planBatches(texts: readonly string[], budget = BATCH_TOKEN_BUDGET): number[][] {
  const order = texts.map((t, i) => ({ i, n: approxTokens(t) })).sort((a, b) => a.n - b.n)
  const batches: number[][] = []
  let cur: number[] = []
  let widest = 0
  for (const { i, n } of order) {
    const nextWidest = Math.max(widest, n)
    if (cur.length > 0 && nextWidest * (cur.length + 1) > budget) {
      batches.push(cur)
      cur = [i]
      widest = n
    } else {
      cur.push(i)
      widest = nextWidest
    }
  }
  if (cur.length > 0) batches.push(cur)
  // Execute widest-first: the single-longest-sequence batch is the peak-memory step
  // (attention scales with length², far past the padding budget's linear model), and
  // running it while the process is youngest/smallest is the difference between
  // finishing and being OOM-killed at chunk N-1 of N — which is exactly how two
  // 317-item builds died before this line existed. The partition is unchanged;
  // only the execution order flips.
  return batches.reverse()
}

/**
 * Documents: plain text, never instruction-wrapped. Results are scattered back into
 * input order, so `result[i]` always corresponds to `texts[i]` despite the reordering.
 */
export async function embedDocuments(
  texts: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out = new Array<number[]>(texts.length)
  let done = 0
  for (const batch of planBatches(texts)) {
    const vectors = await encode(batch.map((i) => asDocument(texts[i]!)))
    batch.forEach((srcIndex, k) => {
      out[srcIndex] = vectors[k]!
    })
    done += batch.length
    onProgress?.(done, texts.length)
  }
  return out
}

/** Queries: instruction-wrapped. Asymmetric by design — see config.ts. */
export async function embedQuery(query: string, task?: string): Promise<number[]> {
  const [vec] = await encode([asQuery(query, task)])
  if (!vec) throw new Error('embedQuery produced no vector')
  return vec
}
