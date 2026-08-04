-- The encode-ui registry RAG index. THE schema — there is no second copy of this
-- DDL in prose, in a README, or in a service file. (The reference implementation
-- kept three divergent copies of its search function and shipped a
-- `createSchemaManually()` that built DDL and never executed it; both classes of
-- drift are structurally impossible here because build.ts applies this file and
-- nothing else.)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── items: one row per registry item (173) ──────────────────────────────────
CREATE TABLE items (
  name          TEXT PRIMARY KEY,
  type          TEXT NOT NULL,          -- registry:ui | registry:hook | registry:lib | registry:theme
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  group_slug    TEXT,                   -- first non-'base' category
  group_label   TEXT,                   -- human label from site-data/groups.ts
  categories    TEXT NOT NULL,          -- JSON array
  dependencies  TEXT NOT NULL,          -- JSON array — npm packages
  registry_deps TEXT NOT NULL,          -- JSON array — @encode-ui/* composition edges
  docs          TEXT,                   -- post-install setup the payload cannot perform
                                        -- itself (shadcn's `docs`), e.g. a stylesheet
                                        -- @import a shipped source file may not carry
  provenance    TEXT,                   -- shadcn | adapted:<src> | original | vendored
  source_url    TEXT,
  license       TEXT,
  motion        INTEGER NOT NULL DEFAULT 0,
  file_path     TEXT,
  source        TEXT,                   -- public component source (files[0].content)
  parts_file_path  TEXT,                   -- the .parts.tsx sibling path, or NULL
  parts_source     TEXT,                   -- its content — files[0] IMPORTS it, so both
                                        -- ship together or the item does not compile
  demo_source   TEXT,                   -- src/demos/<group>/<name>.tsx
  install_cmd   TEXT NOT NULL,
  doc_url       TEXT NOT NULL
) STRICT;

CREATE INDEX items_group ON items (group_slug);
CREATE INDEX items_type  ON items (type);

-- ── chunks: one row per (item, facet) ───────────────────────────────────────
-- `text` is stored VERBATIM as embedded. The reference implementation embedded a
-- 500-char code snippet but fed 6000 chars to the LLM, so retrieval and generation
-- were reasoning over different documents. Keeping the embedded string means an
-- index can always be audited against what it actually indexed.
CREATE TABLE chunks (
  id        INTEGER PRIMARY KEY,
  item_name TEXT NOT NULL REFERENCES items (name) ON DELETE CASCADE,
  facet     TEXT NOT NULL CHECK (facet IN ('doc', 'code', 'demo')),
  text      TEXT NOT NULL,
  n_tokens  INTEGER NOT NULL
) STRICT;

CREATE INDEX chunks_item ON chunks (item_name);
CREATE UNIQUE INDEX chunks_item_facet ON chunks (item_name, facet);

-- ── lexical: standalone FTS5 ────────────────────────────────────────────────
-- Standalone, NOT `content=''` external-content: at ~438 rows the duplicated text
-- costs nothing and it removes the 'rebuild' sync step (one less way to drift).
--
-- `name` is a SEPARATE INDEXED column (both the slug and its de-hyphenated form, so
-- "magnetic button" matches `magnetic-button`). Marking it UNINDEXED — the
-- obvious-looking choice, since it looks like a key rather than content — makes the
-- query "sonner" return nothing at all from this arm.
--
-- Its bm25 weight is 1.0, NOT boosted. A 3x boost was the original design, on the
-- theory that lexical must carry exact names; measurement disagreed once the code and
-- demo facets landed (they already contain the literal tokens), and the boost then
-- only pulled name-collisions up — `reveal-text`/`toggle` over `password-input` for
-- "obscured text entry with a reveal toggle". See the sweep in rag/src/search.ts.
CREATE VIRTUAL TABLE chunks_fts USING fts5 (
  name,
  text,
  chunk_id UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- ── dense: sqlite-vec exact KNN ─────────────────────────────────────────────
-- vec0 is EXACT (brute force), which is correct here: ~438 vectors × 1024 dims is
-- ~1.8 MB and scans in well under a millisecond. An ANN index at this scale is
-- pure recall loss — the reference implementation built ivfflat with lists=100
-- over 704 rows (~7 rows per list, against a rows/1000 rule of thumb) and never
-- tuned probes.
--
-- NOTE: vec0 requires SQLITE_INTEGER for its primary key, and better-sqlite3 v13
-- binds plain JS numbers as SQLITE_FLOAT. Bind chunk_id as a BigInt or the insert
-- fails with "Only integers are allows for primary key values".
CREATE VIRTUAL TABLE chunks_vec USING vec0 (
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[1024]
);

-- ── meta: index provenance ──────────────────────────────────────────────────
-- Holds the full embedding contract (see config.ts). Queried on every open and
-- compared against the running code; a mismatch throws instead of quietly
-- returning wrong neighbours.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
