#!/usr/bin/env node
// encode-ui registry MCP server — component discovery for coding agents.
//
// Three engines, one surface (src/engine.ts). The DEFAULT is the web engine:
// the index fetched live from the deployed registry (falling back to a cached
// copy, then the bundled seed — startup never fails on network absence), with
// a plain filter for search and the catalog resource as the discovery path.
// --registry-engine catalog selects MiniSearch ranking over the bundled
// artifact; db (or --registry-index) selects the semantic SQLite index.
// Configuration is CLI flags alone (parseServerFlags' matrix; the ONLY env
// var read is the ENCODE_UI_TOKEN secret); the db module is imported
// DYNAMICALLY so a machine where better-sqlite3 failed to build still
// serves the others.
//
// All tools are READ-ONLY. Installation deliberately stays on the consumer's
// own `npx shadcn@latest add` path (the advisory-only posture of the upstream
// shadcn MCP): this server tells an agent WHAT to install and hands back the
// command, it never mutates a project.
//
// This file is the ENTRY ONLY — the surface lives under src/mcp/. It keeps its
// name because package.json's `bin`, the README's `claude mcp add` line, and
// every existing user registration all point at dist/mcp.js.
//
// stdout is the JSON-RPC wire. Every diagnostic below goes to stderr — there is
// not one console.log in this file or under src/mcp/, and a test enforces it.
import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadCatalog } from './catalog.ts'
import { setServerOverrides } from './config.ts'
import { createCatalogEngine } from './engine-catalog.ts'
import { createWebEngine } from './engine-web.ts'
import { createRemoteSource } from './remote-source.ts'
import {
  SERVER_USAGE,
  catalogSyncStatus,
  envText,
  packageIndexPath,
  parseServerFlags,
} from './engine.ts'
import { loadIconCatalog } from './icons.ts'
import { loadAnchors } from './theme-anchors.ts'
import { SERVER_NAME, SERVER_VERSION, buildRegistryServer } from './mcp/server.ts'
import { loadWebCatalog } from './web-index.ts'
import type { Catalog } from './catalog.ts'
import type { CatalogSyncStatus, RegistryEngine } from './engine.ts'
import type { IconCatalog } from './icons.ts'
import type { AnchorCatalog } from './theme-anchors.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const isDirectory = (p: string): boolean =>
  statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false

/** The six 0.3.x config env vars this server no longer reads (token excepted). */
const LEGACY_CONFIG_ENV_VARS = [
  'ENCODE_UI_RAG_ENGINE',
  'ENCODE_UI_RAG_INDEX',
  'ENCODE_UI_REGISTRY_URL',
  'ENCODE_UI_REGISTRY_ROOT',
  'ENCODE_UI_RAG_MODEL_DIR',
  'ENCODE_UI_RAG_LEXICAL_ONLY',
] as const

async function main(): Promise<void> {
  // A value the operator passed but we cannot use is a configuration error —
  // usage + exit 2, never warn-and-ignore (dropping a typed flag would
  // silently serve the wrong engine, origin, or root). The pure rules —
  // path/URL resolution, the engine enum, per-engine flag scope — live in
  // engine.ts's parseServerFlags, unit-tested there.
  const parsed = parseServerFlags(process.argv.slice(2), os.homedir(), process.cwd())
  // Help/version go to STDERR deliberately: stdout is the JSON-RPC wire (a
  // test bans stdout writes on this path), and this text is read by a human
  // in a terminal or an MCP log, never piped.
  if (parsed.kind === 'error') {
    process.stderr.write(`[encode-ui-rag] ${parsed.error}\n\n${SERVER_USAGE}\n`)
    process.exit(2)
  }
  if (parsed.kind === 'help') {
    process.stderr.write(`${SERVER_USAGE}\n`)
    process.exit(0)
  }
  if (parsed.kind === 'version') {
    process.stderr.write(`${SERVER_NAME} ${SERVER_VERSION}\n`)
    process.exit(0)
  }
  const { flags } = parsed

  // Since 0.4.0 configuration is flags-only. A 0.3.x registration still
  // exporting config env vars gets ONE warning naming the migration, and the
  // vars are DELETED so nothing downstream can honor them (db.ts's env default
  // is build-CLI-only). ENCODE_UI_TOKEN is exempt — a secret belongs in the env
  // block, not on a command line `ps` can read.
  const staleEnv = LEGACY_CONFIG_ENV_VARS.filter((name) => process.env[name] !== undefined)
  if (staleEnv.length > 0) {
    process.stderr.write(
      `[encode-ui-rag] ignoring ${staleEnv.join(', ')} — since 0.4.0 this server is ` +
        'configured by CLI flags alone (--help lists them; ENCODE_UI_TOKEN stays an env var).\n',
    )
    // One var is worth spelling out: dropping a relocated model cache re-downloads
    // ~1.2 GB on the first query, which on a metered link is a surprise bill and on
    // an air-gapped machine is an outright failure — with the working cache sitting
    // right there on disk. Naming the variable is not the same as naming the cost.
    if (staleEnv.includes('ENCODE_UI_RAG_MODEL_DIR')) {
      process.stderr.write(
        '[encode-ui-rag] ENCODE_UI_RAG_MODEL_DIR pointed the model cache elsewhere; without ' +
          '--model-dir <path> the db engine re-downloads ~1.2 GB of weights on its first query.\n',
      )
    }
    for (const name of staleEnv) delete process.env[name]
  }
  // Handed over as VALUES, never through process.env: the env seam re-applied
  // envText's trim to a path parseServerFlags had deliberately left untrimmed,
  // and made these two settings depend on running after the sweep above.
  setServerOverrides({ modelDir: flags.modelDir, lexicalOnly: flags.lexicalOnly })

  const indexPath = flags.indexPath ?? packageIndexPath()

  // A built index no longer auto-selects — the operator picks the engine. This
  // is the ONLY signal a 0.2.x-era install gets that it dropped from the
  // semantic engine to the web filter, so it names the gap, not just the knob.
  if (flags.engine === 'web' && flags.indexPath === undefined && existsSync(indexPath)) {
    process.stderr.write(
      '[encode-ui-rag] rag/index.db is present but NOT selected: this version asks the ' +
        'operator to choose. Serving the web engine (name/keyword filter, ~14% recall@5); ' +
        "pass --registry-engine db in this server's args for semantic search (~97%).\n",
    )
  }

  // The bundled artifact loads ONCE, whatever the engine: the catalog engine
  // ranks over it, the db engine serves the encode-ui://catalog resource from
  // it, and the web engine uses it as its base-URL default and offline seed.
  // It ships inside the package, so a corrupt/missing file is a packaging bug
  // — fail loud (the icons doctrine).
  let catalog: Catalog
  try {
    catalog = loadCatalog()
  } catch (err) {
    process.stderr.write(`[encode-ui-rag] ${(err as Error).message}\n`)
    process.exit(1)
  }

  let engine: RegistryEngine
  if (flags.engine === 'db') {
    try {
      // Dynamic on purpose: this import is what loads better-sqlite3 +
      // sqlite-vec, and a broken native install must not take down the
      // zero-setup path unless the operator explicitly asked for the db.
      const { createDbEngine } = await import('./engine-db.ts')
      engine = createDbEngine(indexPath)
    } catch (err) {
      // Exit non-zero rather than serving an unusable index: a host reports
      // a server that failed to start, but silently keeps one that answers
      // every call with an error. This message is for the OPERATOR reading
      // the MCP log, so the absolute path belongs here — unlike in a tool
      // result, which the model reads. Every db selection is explicit now
      // (--registry-engine db or --registry-index), so there is no silent
      // downgrade.
      process.stderr.write(
        `[encode-ui-rag] cannot open index at ${indexPath}: ${(err as Error).message}\n` +
          '[encode-ui-rag] build it with `npm run build:index` inside registry/rag.\n',
      )
      process.exit(1)
    }
  } else if (flags.engine === 'catalog') {
    // Where this engine finds source bodies (public/r + src/demos): the
    // checkout this package sits inside, unless the operator points at one.
    // An override must BE a directory — a typo'd root would otherwise demote
    // every get_component_source into a misleading "no checkout" answer.
    // Flag scope (root is catalog-only) was a parse-time error already; what
    // stays here is the FILESYSTEM check — state, not argv shape, so it is
    // exit 1, not usage.
    if (flags.registryRoot !== undefined && !isDirectory(flags.registryRoot)) {
      process.stderr.write(
        `[encode-ui-rag] --registry-root resolves to ${flags.registryRoot}, which is not ` +
          'an existing directory; refusing to start rather than ignore it.\n',
      )
      process.exit(1)
    }
    // DETECT the surrounding checkout rather than assume it. `../..` from
    // dist/ is the registry root in a monorepo checkout, but in a detached
    // `npm i` it is `node_modules/@encode-ui/` — a directory that exists and
    // holds no registry, so the engine answered every source request with
    // 'drifted' and advised running `registry:build` in a checkout the
    // operator did not have. public/r is what it actually reads, so that is
    // what makes a root real.
    const assumedRoot = flags.registryRoot ?? path.resolve(HERE, '..', '..')
    const registryRoot = isDirectory(path.join(assumedRoot, 'public', 'r')) ? assumedRoot : null
    // With no checkout — or an explicitly named origin — bodies come from the
    // registry over HTTP, so a detached install still serves source instead of
    // declining every request.
    const baseUrl = flags.registryUrl ?? catalog.identity.homepage
    engine = createCatalogEngine(catalog, {
      registryRoot,
      remote: createRemoteSource({ baseUrl, token: envText(process.env.ENCODE_UI_TOKEN) }),
      preferRemote: flags.registryUrl !== undefined,
    })
  } else {
    // The default: index fetched from the deployed registry (or the cache /
    // the bundled seed when offline), bodies fetched from the same origin.
    const baseUrl = flags.registryUrl ?? catalog.identity.homepage
    const { catalog: webCatalog, source } = await loadWebCatalog({ baseUrl })
    // The resource must describe the corpus the tools answer from — the
    // FETCHED catalog, whichever rung of the chain it came off.
    catalog = webCatalog
    engine = createWebEngine(webCatalog, {
      baseUrl,
      indexSource: source,
      token: envText(process.env.ENCODE_UI_TOKEN),
    })
  }

  let icons: IconCatalog
  let anchors: AnchorCatalog
  try {
    // Fail loud like the catalog load: the artifact ships inside dist/, so a
    // miss is a packaging bug — a degraded icon path would only hide it.
    icons = loadIconCatalog()
    anchors = loadAnchors()
  } catch (err) {
    process.stderr.write(`[encode-ui-rag] ${(err as Error).message}\n`)
    engine.close()
    process.exit(1)
  }

  // The resource always renders the committed artifact; under the db engine
  // the two corpora can drift apart (index built, registry:build rerun, index
  // never rebuilt). Compare the freshness digests build:index persists and
  // SAY so — silence here is how a model reads an item in the resource and
  // then gets "No component named" from the tools.
  const catalogSync: CatalogSyncStatus =
    engine.kind === 'db' ? catalogSyncStatus(catalog.sources, engine.meta.sourceDigests) : 'in-sync'
  if (catalogSync === 'drift') {
    process.stderr.write(
      '[encode-ui-rag] rag/index.db and the committed agent-index.json were built from ' +
        'DIFFERENT registry sources — tools answer from the db while the catalog resource ' +
        '(encode-ui://catalog) describes the artifact. Rebuild with `npm run build:index` ' +
        'inside registry/rag to realign.\n',
    )
  } else if (catalogSync === 'unverifiable') {
    process.stderr.write(
      '[encode-ui-rag] rag/index.db predates the source-freshness digests — cannot verify ' +
        'it matches the committed agent-index.json; rebuild with `npm run build:index` ' +
        'inside registry/rag to enable the check.\n',
    )
  }

  process.stderr.write(
    `[encode-ui-rag] engine: ${engine.kind} · ${engine.meta.itemCount} items · ` +
      `${engine.meta.detail} · ${icons.icons.length} lucide icons · ` +
      `hash ${engine.meta.registryHash}` +
      (engine.kind === 'catalog' ? ' (lexical — build index.db for semantic search)' : '') +
      (catalogSync === 'drift'
        ? ' · catalog drift'
        : catalogSync === 'unverifiable'
          ? ' · catalog unverified'
          : '') +
      '\n',
  )

  const server = buildRegistryServer({
    engine,
    identity: engine.identity,
    icons,
    anchors,
    catalog,
    catalogSync,
  })
  const transport = new StdioServerTransport()
  // Awaited, not `void`-ed: a connect rejection used to be an unhandled promise.
  await server.connect(transport)

  // Idempotent shutdown. Triggers:
  //   SIGINT  — Ctrl-C from a parent terminal
  //   SIGTERM — `kill <pid>`, or a supervisor stopping the server
  //   SIGHUP  — parent terminal hangup
  //   stdin 'end' — the MCP host closed its end of the pipe. The ONLY signal we
  //     get when the host dies without sending SIGTERM (e.g. it was SIGKILLed).
  //
  // Closing the engine matters most for the db: a WAL SQLite file with a live
  // -shm mapping. The 2s unref'd hard exit bounds a signal that lands mid-embed
  // — better-sqlite3 is synchronous so no query is ever half-done, but a
  // resumed handler would hit a closed database, and an ONNX session can
  // otherwise keep the process alive indefinitely.
  let shuttingDown = false
  const shutdown = (reason: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    process.stderr.write(`[encode-ui-rag] shutting down (${reason})\n`)
    const hardExit = setTimeout(() => {
      process.stderr.write('[encode-ui-rag] shutdown took >2s, forcing exit\n')
      process.exit(1)
    }, 2_000)
    hardExit.unref()
    void (async () => {
      try {
        await server.close()
        engine.close()
      } catch (err) {
        process.stderr.write(`[encode-ui-rag] shutdown error: ${String(err)}\n`)
      } finally {
        clearTimeout(hardExit)
        process.exit(0)
      }
    })()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGHUP', () => shutdown('SIGHUP'))
  process.stdin.on('end', () => shutdown('stdin EOF (host closed the pipe)'))
  // StdioServerTransport.start() already attaches a 'data' listener, which
  // resumes the stream — but an 'end' listener alone never would, so this keeps
  // the handler correct if it is ever registered before connect().
  process.stdin.resume()

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[encode-ui-rag] unhandled rejection: ${String(reason)}\n`)
    shutdown('unhandledRejection')
  })
}

main().catch((err: unknown) => {
  process.stderr.write(`[encode-ui-rag] failed to start: ${String(err)}\n`)
  process.exit(1)
})
