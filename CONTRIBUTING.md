# Contributing

Thanks for looking. This is the MCP server for the
[encode-ui component registry](https://encode-ui.com) — issues and pull requests are welcome.

## What lives here

This repository is the server only. The registry it serves — the components, their source,
and the site — is maintained separately, which has one consequence worth knowing up front:

**`agent-index.json` is generated from the registry, not from this repository.** It ships
committed so the package works offline, but a clone cannot regenerate it, and neither can it
rebuild `index.db` (that needs the registry's payloads plus an embedding model). So:

- Changes to the **server** — tools, engines, flags, error handling, tests — are entirely at
  home here and easy to review.
- Changes that would need a **different catalog** (new components, changed descriptions or
  keywords) belong upstream in the registry. Open an issue and we'll route it.

## Getting set up

```bash
npm install
npm test          # the full node:test suite, no runner dependency
npm run typecheck
npm run check     # both of the above — the gate for any change
```

The suite runs standalone with no registry checkout. A handful of integration tests skip
themselves when there is no registry alongside; that is expected and they stay green.

## House rules

- **Plain TypeScript.** No build-step magic, no syntax a stock `tsc` cannot parse.
- **Tools stay read-only.** A tool that mutates a user's project does not belong in this
  server, however convenient.
- **Errors distinguish no-answer from wrong-question.** An empty search result is valid; a
  misspelt component name is an error carrying the closest matches, so an agent
  self-corrects in one turn. Please preserve that distinction.
- **Nothing internal reaches the model.** Stack traces and filesystem paths go to stderr for
  the operator; the model gets one clear sentence. `guarded()` enforces this — don't route
  around it.
- Conventional commits (`feat:`, `fix:`, `docs:`, …), imperative and lowercase.

## Tests are the specification

Most non-obvious behaviour here exists because something broke once, and the test that
pins it says so in a comment. If a test looks arbitrary, read the comment before changing
it — and if you do change behaviour deliberately, retarget the test at the intent rather
than deleting it.
