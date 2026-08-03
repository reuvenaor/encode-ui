// THE I/O contract for every tool.
//
// Each schema is exported once and its inferred type shares the identifier
// (declaration merging), so a handler that builds its payload as
// `const out: SearchComponentsOutput = {…}` is checked at COMPILE time against
// the exact schema the SDK validates at RUNTIME — the runtime check can only
// fire if the compile-time one was bypassed.
//
// Strict on INPUT, tolerant on OUTPUT VALUES:
//
//   inputs  — passed as the whole .strict() object. Verified against SDK 1.29.0:
//             this emits `additionalProperties: false` into the JSON Schema AND
//             rejects an unknown argument at runtime. Passing `.shape` instead
//             lets Zod 4's default strip silently swallow a typo'd argument.
//   outputs — passed as `.shape`, and value types stay permissive (`type` is a
//             plain string, not an enum). A registry that grows a new
//             `registry:*` kind must never turn a successful read into an error.
import { z } from 'zod'
import { DEFAULT_K, MAX_K } from '../engine.ts'

export const ComponentName = z
  .string()
  .min(1)
  .max(128)
  .describe('Component slug, e.g. magnetic-button. A leading scope prefix is accepted and ignored.')

/**
 * Declared ONCE. The SDK emits `default: 8` into the JSON Schema, so no
 * description has to restate it and the handler receives a plain number —
 * replacing two `?? 8` fallbacks and three prose mentions.
 */
export const K = z
  .number()
  .int()
  .min(1)
  .max(MAX_K)
  .default(DEFAULT_K)
  .describe('How many results to return.')

export const Hit = z
  .object({
    name: z.string(),
    title: z.string(),
    description: z.string(),
    group: z.string().nullable(),
    type: z.string(),
    installCmd: z.string(),
    docUrl: z.string(),
    score: z.number(),
    /**
     * Disambiguates a real hazard: the same `score` key meant two different
     * things. 'rrf' is a fusion score, comparable only WITHIN one result set;
     * 'cosine' is a true cosine similarity (−1..1, in practice positive between
     * related doc-cards), comparable across calls; 'lexical' is the catalog
     * engine — rank-derived on search (1/(60+rank): monotonic with the hit
     * order by construction), structural-overlap on find_similar — like 'rrf',
     * never comparable across calls.
     */
    scoreKind: z.enum(['rrf', 'cosine', 'lexical']),
    /**
     * Best dense-arm cosine similarity behind this hit. Unlike `score`, an
     * ABSOLUTE number comparable ACROSS searches — a low top-hit cosine means
     * nothing genuinely matched the query. Null = no dense evidence (degraded
     * mode, a lexical-only match, or outside the dense candidate pool).
     */
    cosine: z.number().nullable(),
    matchedOn: z.array(z.string()),
    provenance: z.string().nullable(),
    motion: z.boolean(),
    /** Transitively dependency-free — pure React + Tailwind tokens. */
    pure: z.boolean(),
    /**
     * The published payload requires a registry account. Metadata, search and
     * install commands stay open; only the SOURCE is behind the wall, and only
     * where it is fetched from the deployed registry — a checkout-backed or
     * db-backed install serves the body regardless. Read from the catalog
     * snapshot, so on the db engine it is as fresh as that artifact (the same
     * caveat the drift note in encode-ui://catalog already carries).
     */
    gated: z.boolean(),
  })
  .strict()
export type Hit = z.infer<typeof Hit>

// ── search_components ────────────────────────────────────────────────────────

export const SearchComponentsInput = z
  .object({
    query: z.string().min(1).describe('What the component should do, in natural language.'),
    k: K,
    group: z
      .string()
      .optional()
      .describe('Restrict to a group slug, e.g. buttons, forms, charts, overlays.'),
    type: z
      .string()
      .optional()
      .describe('Restrict to a registry type: registry:ui, registry:hook, registry:lib.'),
    motion: z
      .boolean()
      .optional()
      .describe('Only animated (true) or only static (false) components.'),
    dependencyFree: z
      .boolean()
      .optional()
      .describe(
        'true = only items whose whole install tree adds zero npm packages ' +
          '(pure React + Tailwind); false = only dep-carrying items.',
      ),
  })
  .strict()
export type SearchComponentsInput = z.infer<typeof SearchComponentsInput>

/**
 * Which engine answered: 'db' is the semantic index (rag/index.db), 'catalog'
 * the lexical engine over the committed agent index, 'web' the plain filter
 * over the index fetched from the deployed registry. Stamped on every
 * search/list output so a caller can calibrate its trust in the scores.
 */
export const Engine = z.enum(['db', 'catalog', 'web'])
export type Engine = z.infer<typeof Engine>

export const SearchComponentsOutput = z.object({
  query: z.string(),
  hits: z.array(Hit),
  count: z.number().int(),
  /** db engine only: the embedding model was unavailable and lexical FTS ran alone. */
  degraded: z.boolean(),
  engine: Engine,
})
export type SearchComponentsOutput = z.infer<typeof SearchComponentsOutput>

// ── find_similar ─────────────────────────────────────────────────────────────

export const FindSimilarInput = z
  .object({
    name: ComponentName.describe('Component to find neighbours of.'),
    k: K,
  })
  .strict()
export type FindSimilarInput = z.infer<typeof FindSimilarInput>

export const FindSimilarOutput = z.object({
  /** Echoed back scope-stripped, so the caller sees the name that was resolved. */
  seed: z.string(),
  neighbours: z.array(Hit),
  count: z.number().int(),
  engine: Engine,
})
export type FindSimilarOutput = z.infer<typeof FindSimilarOutput>

// ── list_groups ──────────────────────────────────────────────────────────────

export const Group = z
  .object({
    slug: z.string(),
    label: z.string(),
    count: z.number().int(),
  })
  .strict()
export type Group = z.infer<typeof Group>

export const ListGroupsOutput = z.object({
  groups: z.array(Group),
  totalItems: z.number().int(),
  engine: Engine,
})
export type ListGroupsOutput = z.infer<typeof ListGroupsOutput>

// ── list_components ──────────────────────────────────────────────────────────

export const ListComponentsInput = z
  .object({
    group: z
      .string()
      .min(1)
      .describe('Group slug to enumerate, e.g. forms. Call list_groups for the taxonomy.'),
    dependencyFree: z
      .boolean()
      .optional()
      .describe('true = only pure React + Tailwind members; false = only dep-carrying ones.'),
  })
  .strict()
export type ListComponentsInput = z.infer<typeof ListComponentsInput>

export const ListComponentsOutput = z.object({
  group: z.object({ slug: z.string(), label: z.string() }).strict(),
  /** FULL membership, alphabetical — an enumeration, not a ranked sample. */
  components: z.array(
    z
      .object({
        name: z.string(),
        title: z.string(),
        description: z.string(),
        /** Transitively dependency-free — pure React + Tailwind tokens. */
        pure: z.boolean(),
      })
      .strict(),
  ),
  count: z.number().int(),
  engine: Engine,
})
export type ListComponentsOutput = z.infer<typeof ListComponentsOutput>

// ── get_component / get_component_source ─────────────────────────────────────

export const GetComponentInput = z.object({ name: ComponentName }).strict()
export type GetComponentInput = z.infer<typeof GetComponentInput>

export const GetComponentOutput = z.object({
  name: z.string(),
  qualifiedName: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.string(),
  /** Both halves. get_component used to print the slug where list_groups printed
   *  the label, leaving no way to join the two. */
  group: z.object({ slug: z.string(), label: z.string() }).strict().nullable(),
  categories: z.array(z.string()),
  dependencies: z.array(z.string()),
  registryDependencies: z.array(z.string()),
  /** npm closure over the whole composition tree — what an install REALLY adds. */
  transitiveDependencies: z.array(z.string()),
  /** Transitively dependency-free — pure React + Tailwind tokens. */
  pureReact: z.boolean(),
  provenance: z.string().nullable(),
  license: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  motion: z.boolean(),
  filePath: z.string().nullable(),
  /**
   * The `.parts.tsx` sibling `filePath` imports, when the item ships one.
   * Both files are required for the item to compile, and
   * `get_component_source` with `part:"source"` returns BOTH.
   */
  partsFilePath: z.string().nullable(),
  installCmd: z.string(),
  docUrl: z.string(),
  /**
   * Cost signals, so a caller can decide whether to fetch the payload before it
   * arrives — `sidebar` is ~27 KB. Null when that part does not exist.
   * `sourceBytes` is the TOTAL for `part:"source"`, parts file included.
   */
  sourceBytes: z.number().int().nullable(),
  demoBytes: z.number().int().nullable(),
  /**
   * The published payload requires a registry account — a pre-flight signal
   * beside the byte counts, so a caller learns it here rather than from a
   * failed get_component_source. See the same field on Hit.
   */
  gated: z.boolean(),
  /**
   * Post-install setup the installed files cannot perform themselves — shadcn's `docs`,
   * which its CLI prints after an install. Distinct from `docUrl` (the web page): this
   * is a required step. The flows items need React Flow's stylesheet imported into the
   * consumer's Tailwind entry, and a shipped source file may not carry a CSS import, so
   * without this an agent installs a graph that positions nothing and draws no edges.
   */
  setup: z.string().nullable(),
})
export type GetComponentOutput = z.infer<typeof GetComponentOutput>

export const ComponentPart = z
  .enum(['source', 'demo'])
  .default('source')
  .describe('Which payload: the component source, or its demo usage example.')

export const GetComponentSourceInput = z
  .object({ name: ComponentName, part: ComponentPart })
  .strict()
export type GetComponentSourceInput = z.infer<typeof GetComponentSourceInput>

// ── find_icons ───────────────────────────────────────────────────────────────

export const FindIconsInput = z
  .object({
    query: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('What the icon should depict, e.g. "shopping cart" or "warning about danger".'),
    names: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(50)
      .optional()
      .describe(
        'Exact names to VERIFY — kebab (house), PascalCase (House), an Icon suffix ' +
          '(HouseIcon), or a legacy alias (Home). Wins over query/category.',
      ),
    category: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('Restrict to one lucide category (e.g. navigation). Alone = browse it.'),
    limit: K,
  })
  .strict()
  .refine((v) => v.query !== undefined || v.names !== undefined || v.category !== undefined, {
    message: 'Provide at least one of query, names, or category.',
  })
export type FindIconsInput = z.infer<typeof FindIconsInput>

export const IconHit = z
  .object({
    /** Canonical kebab name, e.g. "house". */
    name: z.string(),
    /** The import identifier, e.g. "House". */
    component: z.string(),
    /** Short context — curated lucide tags, capped in the builder. */
    tags: z.array(z.string()),
    categories: z.array(z.string()),
    /** Legacy spellings that still resolve but should not be used in new code. */
    deprecatedAliases: z.array(z.string()),
    /** Set when the caller asked via a deprecated alias — e.g. "home" for house. */
    resolvedFrom: z.string().nullable(),
  })
  .strict()
export type IconHit = z.infer<typeof IconHit>

export const FindIconsOutput = z.object({
  /** The lucide-react version the catalog is pinned to. */
  lucideVersion: z.string(),
  icons: z.array(IconHit),
  count: z.number().int(),
  /** Names that resolved to nothing, each with closest-name suggestions. */
  unknown: z.array(z.object({ name: z.string(), suggestions: z.array(z.string()) }).strict()),
  /** One combined import line for every returned icon; null when none. */
  usage: z.string().nullable(),
  /** How the dependency arrives — static, no project probing. */
  install: z.string(),
})
export type FindIconsOutput = z.infer<typeof FindIconsOutput>

// ── get_install_command ──────────────────────────────────────────────────────

export const GetInstallCommandInput = z
  .object({
    names: z.array(ComponentName).min(1).max(50).describe('Component names to install.'),
  })
  .strict()
export type GetInstallCommandInput = z.infer<typeof GetInstallCommandInput>

export const GetInstallCommandOutput = z.object({
  /** One line installing every KNOWN name. Absent when none were recognised. */
  command: z.string(),
  components: z.array(z.object({ name: z.string(), qualifiedName: z.string() }).strict()),
  /** Names with no such component. Partial success is still success. */
  unknown: z.array(z.string()),
})
export type GetInstallCommandOutput = z.infer<typeof GetInstallCommandOutput>
