// The embedding contract — THE single source of truth.
//
// Every value here is written into the index's `meta` table at build time and
// re-asserted at query time (see assertModelContract). This exists because the
// reference implementation (shadcn-ui-rag) drifted three ways at once: the README,
// the TS service, and the Python handler each declared a different search function
// and a different prefix convention, so documents and queries were encoded
// incompatibly and nobody noticed — the symptom was a silent threshold drop from
// 0.6 to 0.3 to keep results flowing.
//
// If you change ANY value below, the index must be rebuilt. The assertion makes
// that a loud failure instead of a quiet quality regression.
import os from 'node:os'
import path from 'node:path'
import { envText } from './engine.ts'

/** Model + runtime. */
export const MODEL_ID = 'onnx-community/Qwen3-Embedding-0.6B-ONNX'

/**
 * fp16, not q8. Measured on the real 52-query eval set over all 133 code items:
 *
 *   dtype   recall@1   recall@5   MRR@10   ms/doc   ms/query
 *   q8      0.692      0.846      0.754     94       35
 *   fp16    0.712      0.923      0.808    293      110
 *
 * int8 quantization cost 8 points of recall@5 and produced visible hubness
 * (`hover-card` / `avatar` surfacing on semantically unrelated queries). Document
 * embedding is a build-time one-off, and 110 ms/query is imperceptible inside an
 * agent tool call, so quality wins.
 */
export const MODEL_DTYPE = 'fp16'

/** Qwen3-Embedding-0.6B native width. MRL truncation is supported down to 32. */
export const DIMS = 1024

/**
 * The model's context window. Anything longer is silently TRUNCATED, which would
 * mean an item whose stored text and stored vector describe different things — so
 * build.ts refuses to finish and verify.ts refuses to pass when a chunk exceeds it.
 *
 * Not part of ModelContract: it is a property of the model, not a choice we make,
 * and a chunk that fits one build fits every build of the same model.
 */
export const CONTEXT_TOKENS = 32768

/**
 * Mandatory for this model. Qwen3-Embedding is a decoder — the sentence
 * representation lives in the FINAL token, not the mean of all of them.
 * Mean-pooling this model produces near-garbage.
 */
export const POOLING = 'last_token'
export const NORMALIZE = true

/**
 * The asymmetric prefix contract.
 *
 * Qwen3-Embedding is instruction-aware and asymmetric: DOCUMENTS are embedded as
 * plain text with no instruction, QUERIES are wrapped. Verified live — cos(doc(x),
 * query(x)) = 0.723, i.e. the same string encodes to measurably different vectors.
 * Getting this backwards (or applying the instruction to both sides) is the single
 * highest-impact way to silently ruin retrieval.
 */
export const QUERY_TASK = 'Given a UI need, retrieve the React component that satisfies it'

/** Documents: verbatim, never wrapped. */
export const asDocument = (text: string): string => text

/** Queries: instruction-wrapped. */
export const asQuery = (query: string, task: string = QUERY_TASK): string =>
  `Instruct: ${task}\nQuery: ${query}`

/**
 * A user-level cache path under `encode-ui-rag`, resolved the way every OS
 * expects. Two holes this closes, both from the bare `??` it replaces: an env
 * var set to `''` is UNSET (systemd units, minimal containers and CI runners
 * export empty values routinely, and `''` yielded a path at the FILESYSTEM
 * ROOT), and Windows sets neither `XDG_CACHE_HOME` nor `HOME` — where a `'.'`
 * fallback wrote the cache into whatever directory the MCP host launched from,
 * i.e. the user's project. `os.tmpdir()` is the last resort, so a relative path
 * is unreachable by construction.
 */
export const userCacheDir = (...segments: string[]): string => {
  const xdg = envText(process.env.XDG_CACHE_HOME)
  if (xdg !== undefined) return path.join(xdg, 'encode-ui-rag', ...segments)
  const home = envText(process.env.HOME) ?? envText(os.homedir()) ?? os.tmpdir()
  return path.join(home, '.cache', 'encode-ui-rag', ...segments)
}

/**
 * A PATH-shaped env value: `''` is unset, but the value is NOT trimmed — a
 * trailing space is a legal path character. This is the same rule
 * resolvePathValue follows, and the reason it is spelled out separately from
 * envText: envText's trim is right for a token or URL and silently wrong for
 * a directory.
 */
const envPath = (raw: string | undefined): string | undefined =>
  raw === undefined || raw === '' ? undefined : raw

/**
 * The server's resolved --model-dir / --lexical-only, set ONCE at startup.
 *
 * These used to round-trip through `process.env`, which re-applied envText's
 * trim to a path resolvePathValue had deliberately left untrimmed (so
 * `--model-dir '/vol/models '` silently downloaded 1.2 GB to a different
 * directory), and forced the stale-env sweep in mcp.ts to delete variables the
 * same run then re-set. The env reads below stay the build CLIs' and tests'
 * seam — the server no longer writes to them at all.
 */
export interface ServerOverrides {
  /** Absolutized --model-dir; undefined falls through to the env seam. */
  modelDir?: string | undefined
  /** --lexical-only. `false` is meaningful — it BEATS a stale env var. */
  lexicalOnly?: boolean | undefined
}

let serverOverrides: ServerOverrides = {}

export const setServerOverrides = (overrides: ServerOverrides): void => {
  serverOverrides = overrides
}

/**
 * Where model weights live. transformers.js v4 defaults to
 * `node_modules/@huggingface/transformers/.cache/`, which means every `npx`
 * invocation of this package would re-download ~1.2 GB. Pinning a stable
 * user-level directory makes the download a genuine one-off.
 */
export const modelCacheDir = (): string =>
  serverOverrides.modelDir ?? envPath(process.env.ENCODE_UI_RAG_MODEL_DIR) ?? userCacheDir('models')

/** Skip the model entirely and run lexical-only (FTS5 + BM25). Set by the
 *  server's --lexical-only flag; also the test harnesses' switch. */
export const lexicalOnly = (): boolean =>
  serverOverrides.lexicalOnly ?? process.env.ENCODE_UI_RAG_LEXICAL_ONLY === '1'

/** Bumped whenever schema.sql changes shape. Rebuild required on mismatch. */
export const SCHEMA_VERSION = '1'

/** The exact key/value set persisted to `meta` and re-checked on open. */
export interface ModelContract {
  model_id: string
  model_dtype: string
  dims: string
  pooling: string
  normalize: string
  query_task: string
  schema_version: string
}

export function modelContract(): ModelContract {
  return {
    model_id: MODEL_ID,
    model_dtype: MODEL_DTYPE,
    dims: String(DIMS),
    pooling: POOLING,
    normalize: String(NORMALIZE),
    query_task: QUERY_TASK,
    schema_version: SCHEMA_VERSION,
  }
}

/**
 * Fail loudly when the index on disk was built with a different contract than the
 * code about to query it. A mismatched index does not error — it just returns
 * quietly wrong neighbours, which is far worse.
 */
export function assertModelContract(stored: Readonly<Record<string, string>>): void {
  const want = modelContract()
  const drift = (Object.keys(want) as (keyof ModelContract)[])
    .filter((k) => stored[k] !== want[k])
    .map((k) => `  ${k}: index=${stored[k] ?? '(missing)'} code=${want[k]}`)

  if (drift.length > 0) {
    throw new Error(
      `RAG index was built with a different embedding contract:\n${drift.join('\n')}\n` +
        `Rebuild it with \`npm run build:index\` inside registry/rag.`,
    )
  }
}
