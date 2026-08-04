// Fetching source bodies from a registry origin — one implementation, shared.
//
// The web engine always fetches (it holds no bodies at all); the catalog engine
// falls back to it when no registry checkout surrounds the package; the db
// engine uses it when --registry-url asks for live bodies rather than the
// snapshot its index was built from. Keeping ONE copy is what makes the
// null / 'gated' / 'drifted' answers identical whichever engine the operator
// selected — those states are part of the tool contract (mcp/tools-catalog.ts
// renders a different remedy for each), so a second implementation would be a
// second set of remedies to keep in step.
//
// No native imports: this module sits on the zero-setup path.
import { payloadFiles } from './engine-shared.ts'
import type { ComponentSourcePart, SourceResult } from './engine.ts'

export interface RemoteSourceOptions {
  /** Registry origin, normalized to origin + path — e.g. https://encode-ui.com */
  baseUrl: string
  /** ENCODE_UI_TOKEN, when the operator set one (gated payloads). */
  token?: string | undefined
  /** Injectable for tests; global fetch otherwise. */
  fetchImpl?: typeof fetch | undefined
  timeoutMs?: number | undefined
}

/** Fetch one item's source or demo payload from the registry origin. */
export type RemoteSource = (name: string, part: ComponentSourcePart) => Promise<SourceResult>

export function createRemoteSource(opts: RemoteSourceOptions): RemoteSource {
  const fetchImpl = opts.fetchImpl ?? fetch
  const base = opts.baseUrl

  return async (name, part) => {
    const url = part === 'source' ? `${base}/r/${name}.json` : `${base}/r/${name}.demo.json`
    const res = await fetchImpl(url, {
      headers: opts.token !== undefined ? { authorization: `Bearer ${opts.token}` } : {},
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    })
    if (res.status === 401 || res.status === 403) return 'gated'
    // The corpus promises this part and the origin has no file — corpus and
    // deployment out of step (or demo payloads not published there yet).
    if (res.status === 404) return 'drifted'
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching the ${part} for "${name}"`)
    const text = await res.text()
    // A 2xx that is not JSON means the origin served something ELSE for a path
    // it has no payload at. Our own deploy answers a real 404 now, but a host
    // whose SPA fallback swallows it (any static host over build/client), a CDN
    // interstitial and a captive portal all reach here with 200 + HTML. Same
    // MEANING as the 404 above, so the same answer: without this the parse
    // throws a SyntaxError that guarded() rewrites into "check network access
    // to the registry origin", sending the operator to debug a network that is
    // working fine. Parse, not content-type: the header is advisory, and a body
    // that parses but carries no files[0] already answers 'drifted' below.
    let payload: { files?: { path?: string; content?: string }[] }
    try {
      payload = JSON.parse(text) as { files?: { path?: string; content?: string }[] }
    } catch {
      return 'drifted'
    }
    return payloadFiles(payload)
  }
}
