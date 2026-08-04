// The registry-source freshness digests — ONE TypeScript definition shared by
// `build:index` (persisted into index.db's meta), the startup drift check
// (mcp.ts, via engine.ts's catalogSyncStatus), and the artifact drift test.
// scripts/build-agent-index.mjs keeps its documented .mjs port (it cannot be
// imported across the package boundary); the drift test's comparison of a
// fresh recompute against the committed artifact is what pins the two
// implementations together.
//
// Node builtins only — this module sits on the zero-setup path (no natives).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const sha256 = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex')

/** The triple the committed artifact stores under `sources` (catalog.ts). */
export interface SourceDigests {
  registryJsonSha256: string
  groupsSha256: string
  demosDigest: string
}

/**
 * Digest of `src/demos/<group>/*.tsx` as `group/file\tbytes` lines — path +
 * byte size, exactly the demo signal the item records derive (demoBytes IS
 * the size), so a same-size edit cannot stale it. Directories only at the top
 * level: a stray file (.DS_Store — gitignored, so invisible to git while
 * present on disk) must not ENOTDIR the walk.
 */
export function demosDigestOf(demosDir: string): string {
  const entries: string[] = []
  if (existsSync(demosDir)) {
    const dirs = readdirSync(demosDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    for (const dir of dirs) {
      const dirAbs = path.join(demosDir, dir)
      for (const f of readdirSync(dirAbs).sort()) {
        if (!f.endsWith('.tsx')) continue
        entries.push(
          `${dir}/${f}\t${Buffer.byteLength(readFileSync(path.join(dirAbs, f), 'utf8'), 'utf8')}`,
        )
      }
    }
  }
  return sha256(entries.join('\n'))
}

/** All three freshness digests from a registry checkout root. */
export function sourceDigestsOf(registryRoot: string): SourceDigests {
  return {
    registryJsonSha256: sha256(readFileSync(path.join(registryRoot, 'registry.json'))),
    groupsSha256: sha256(
      readFileSync(path.join(registryRoot, 'src', 'site-data', 'groups.ts'), 'utf8'),
    ),
    demosDigest: demosDigestOf(path.join(registryRoot, 'src', 'demos')),
  }
}
