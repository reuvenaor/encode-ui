/**
 * Codegen: vendor the Lucide icon metadata into the committed search artifact.
 *
 * Reads the lucide monorepo's per-icon `icons/<name>.json` files (tags, categories,
 * aliases + deprecation flags — metadata that ships in NO npm package) at the exact
 * tag the registry pins for `lucide-react`, cross-checks every icon against the
 * INSTALLED package (canonical module exists + its PascalCase export is declared),
 * and emits:
 *
 *   rag/src/lucide-icons.json   — { version, source, license, count, icons[] }
 *                                 one icon per line (diffable), sorted by name.
 *
 * The artifact is COMMITTED: `build`/`prepack` stay offline/hermetic and only `cp`
 * it into dist/. This script is the single network step, run manually.
 *
 * Lucide is ISC (portions Feather, MIT © 2013-2022 Cole Bemis) — see the
 * "Icon metadata (Lucide)" section of registry/NOTICE.md.
 *
 * Re-sync (after bumping `lucide-react` in registry/package.json):
 *   npm --prefix rag run vendor:icons     # or: node rag/scripts/vendor-icons.mjs [tag]
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ragRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registryRoot = path.resolve(ragRoot, '..')
const outFile = path.join(ragRoot, 'src', 'lucide-icons.json')

// ── 1 · resolve the tag from the registry's lucide-react pin ────────────────
//
// The pin is read from the REGISTRY, not from this package, deliberately: the
// vendored metadata has to describe the same lucide-react a consumer installs,
// and that version comes from the registry items' dependencies. A second pin
// here would be a second source of truth, free to drift from the one that
// actually ships. So this is a maintenance task for the superproject checkout,
// not something a standalone clone can run — say so instead of crashing.
const registryPkgPath = path.join(registryRoot, 'package.json')
if (!existsSync(registryPkgPath) && !process.argv[2]) {
  console.error(
    'vendor:icons needs the registry checkout to read its lucide-react pin, and none\n' +
      `was found at ${registryPkgPath}. Run it from the superproject, or pass an\n` +
      'explicit tag: npm run vendor:icons -- 0.511.0',
  )
  process.exit(1)
}
const pin = existsSync(registryPkgPath)
  ? JSON.parse(readFileSync(registryPkgPath, 'utf8')).dependencies?.['lucide-react']
  : undefined
const tag = process.argv[2] ?? pin?.replace(/^[~^]/, '')
if (!tag) {
  console.error('No tag argument and no lucide-react pin in the registry package.json')
  process.exit(1)
}
console.error(`vendoring lucide metadata at tag ${tag} (pin: ${pin ?? 'n/a'})`)

// ── 2 · fetch + extract the repo tarball at that tag ────────────────────────
const work = mkdtempSync(path.join(tmpdir(), 'lucide-vendor-'))
try {
  let archive = null
  for (const ref of [tag, `v${tag}`]) {
    const url = `https://github.com/lucide-icons/lucide/archive/refs/tags/${ref}.tar.gz`
    const res = await fetch(url, { redirect: 'follow' })
    if (res.ok) {
      archive = path.join(work, 'lucide.tar.gz')
      writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
      console.error(`fetched ${url}`)
      break
    }
    console.error(`no tarball at ${url} (${res.status})`)
  }
  if (!archive) {
    console.error('Could not download the lucide tarball for either tag form.')
    process.exit(1)
  }
  const tar = spawnSync('tar', ['-xzf', archive, '-C', work], { stdio: 'inherit' })
  if (tar.status !== 0) process.exit(tar.status ?? 1)

  const repoDir = readdirSync(work).find((d) => d.startsWith('lucide-') && !d.endsWith('.tar.gz'))
  const iconsDir = path.join(work, repoDir, 'icons')

  // ── 3 · parse per-icon metadata ────────────────────────────────────────────
  const toPascal = (kebab) =>
    kebab
      .split(/[-_]/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')

  const icons = []
  for (const file of readdirSync(iconsDir).filter((f) => f.endsWith('.json'))) {
    const name = file.slice(0, -'.json'.length)
    const meta = JSON.parse(readFileSync(path.join(iconsDir, file), 'utf8'))
    const aliases = (meta.aliases ?? []).map((a) =>
      typeof a === 'string'
        ? { name: a, deprecated: false }
        : { name: a.name, deprecated: !!a.deprecated },
    )
    icons.push({
      name,
      pascal: toPascal(name),
      tags: meta.tags ?? [],
      categories: meta.categories ?? [],
      aliases,
    })
  }
  // Sort by NAME, not filename — "x-dash.json" sorts before "x.json" ('-' < '.'),
  // which would leave the artifact un-alphabetical for consumers.
  icons.sort((a, b) => (a.name < b.name ? -1 : 1))

  // ── 4 · cross-check against the INSTALLED lucide-react ──────────────────────
  const pkgDir = path.join(registryRoot, 'node_modules', 'lucide-react')
  const modDir = path.join(pkgDir, 'dist', 'esm', 'icons')
  const canonical = new Set(
    readdirSync(modDir)
      .filter((f) => f.endsWith('.js') && f !== 'index.js')
      .filter((f) => readFileSync(path.join(modDir, f), 'utf8').includes('createLucideIcon'))
      .map((f) => f.slice(0, -'.js'.length)),
  )
  const dts = readFileSync(path.join(pkgDir, 'dist', 'lucide-react.d.ts'), 'utf8')
  const declared = new Set([...dts.matchAll(/^declare const (\w+):/gm)].map((m) => m[1]))

  const missingModule = icons.filter((i) => !canonical.has(i.name)).map((i) => i.name)
  const missingExport = icons
    .filter((i) => !declared.has(i.pascal))
    .map((i) => `${i.name} → ${i.pascal}`)
  const extraModules = [...canonical].filter((n) => !icons.some((i) => i.name === n))
  if (missingModule.length || missingExport.length || extraModules.length) {
    if (missingModule.length)
      console.error(`repo icons with no installed module: ${missingModule.join(', ')}`)
    if (missingExport.length)
      console.error(`pascal names not declared in d.ts: ${missingExport.join(', ')}`)
    if (extraModules.length)
      console.error(
        `installed canonical modules missing from repo metadata: ${extraModules.join(', ')}`,
      )
    process.exit(1)
  }
  console.error(
    `cross-check ok: ${icons.length} icons match the installed lucide-react (${canonical.size} canonical modules)`,
  )

  // ── 5 · emit, one icon per line ─────────────────────────────────────────────
  const head = {
    version: tag,
    source: `github.com/lucide-icons/lucide@${tag} icons/*.json`,
    license:
      'ISC (Lucide, © Lucide Contributors); ~110 Feather-derived icons MIT (© 2013-2022 Cole Bemis)',
    count: icons.length,
  }
  const body = icons.map((i) => `    ${JSON.stringify(i)}`).join(',\n')
  const json = `{\n  "version": ${JSON.stringify(head.version)},\n  "source": ${JSON.stringify(head.source)},\n  "license": ${JSON.stringify(head.license)},\n  "count": ${head.count},\n  "icons": [\n${body}\n  ]\n}\n`
  JSON.parse(json) // self-check before writing
  writeFileSync(outFile, json)
  console.error(
    `wrote ${path.relative(process.cwd(), outFile)} (${icons.length} icons, ${(json.length / 1024).toFixed(0)} KB)`,
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
