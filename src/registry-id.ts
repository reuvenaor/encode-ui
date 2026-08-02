// The registry's namespace identity — the scope prefix (`@encode-ui/`) and the
// documentation origin — plus every string derived from them.
//
// Deliberately NOT in config.ts. That file is the EMBEDDING contract: every value
// in it is persisted to `meta` and re-asserted by assertModelContract, so putting
// the homepage there would make a marketing-domain change invalidate a 15-minute
// embedding build. Two contracts with two invalidation costs deserve two modules.
//
// The values are not hardcoded here either — they are READ from the registry's own
// `public/r/registry.json` at ingest and persisted to `meta` (see ingest.readIdentity
// and db.readIdentity). Before that, the literal `@encode-ui/` appeared in seven
// places across ingest.ts and mcp.ts, three of them as a regex.

export interface RegistryIdentity {
  /** npm-style scope without the `@`, e.g. `encode-ui`. */
  readonly scope: string
  /** Origin that serves the docs, e.g. `https://encode-ui.com`. No trailing slash. */
  readonly homepage: string
}

/** The consumer-side installer. Ours is advisory — we never run it. */
export const INSTALL_CLI = 'npx shadcn@latest add'

export const qualifiedName = (id: RegistryIdentity, name: string): string => `@${id.scope}/${name}`

/**
 * Drop a leading `@scope/` if present; leave anything else alone.
 *
 * Not a regex: the scope is data now, and a regex assembled from data needs
 * escaping to stay safe. A prefix test needs none.
 */
export const stripScope = (id: RegistryIdentity, raw: string): string => {
  const prefix = `@${id.scope}/`
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
}

/**
 * THE install-command derivation. Ingest calls it with one name to populate the
 * stored `install_cmd` column; the MCP tool calls it with many. Previously the
 * tool rebuilt the string by hand even though it had just SELECTed the stored one.
 *
 * Duplicate names collapse, first occurrence winning, so `[button, button]` cannot
 * produce `add @encode-ui/button @encode-ui/button`.
 */
export function installCommand(id: RegistryIdentity, names: readonly string[]): string {
  const unique = [...new Set(names)]
  return `${INSTALL_CLI} ${unique.map((n) => qualifiedName(id, n)).join(' ')}`
}

/**
 * Canonical docs URL. Theme items point at the palette gallery `/themes` —
 * the site's view route excludes `registry:theme` (CODE_ITEMS filters it), so
 * a `/view/themes/<name>` link renders "Not found"; build-llms.mjs applies the
 * same rule. Ungrouped items sit at the root.
 */
export const docUrl = (
  id: RegistryIdentity,
  groupSlug: string | null,
  name: string,
  type: string,
): string => {
  if (type === 'registry:theme') return `${id.homepage}/themes`
  return groupSlug ? `${id.homepage}/view/${groupSlug}/${name}` : `${id.homepage}/view/${name}`
}
