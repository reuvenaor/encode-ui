// Server-level guidance, sent once at initialize. Tells a model what this
// registry is and which tool to reach for, so it does not have to infer the
// shape of the surface from five tool descriptions.
//
// Built per ENGINE: the db text can promise semantic search and a calibrated
// cosine; the catalog text must promise neither, and instead teaches the
// rank-only score discipline plus the upgrade path; the web text steers
// discovery to the catalog resource — its search is a plain filter over the
// index fetched from the deployed registry.
import type { EngineKind } from '../engine.ts'

const COMMON_MIDDLE = [
  '',
  'Every result carries the exact `npx shadcn@latest add` command for that',
  'component. get_install_command batches several into one line.',
  '',
  'All tools are READ-ONLY. This server tells you WHAT to install and hands back',
  'the command; installation stays on your own shadcn path and nothing here',
  'mutates a project.',
  '',
]

const COMMON_TAIL = [
  '',
  'For a one-shot full-catalog view (browse, planning, "what exists?"), read the',
  'catalog resource (encode-ui://catalog, ≈20k tokens) — prefer search for',
  'targeted lookups.',
  '',
  'Icons: the registry ships NO icon components — lucide-react is the icon layer.',
  'Call find_icons for verified names instead of guessing imports; it resolves',
  'legacy aliases (Home → House) and searches by concept over curated tags.',
  '',
  'Theming: validate_theme is the one tool that answers about the CONSUMER\'s own',
  'design, not about this catalog. Give it a candidate brand — the 32 colour',
  'tokens in both modes, plus radius, fonts, shadows, tracking and motion — and it',
  'returns the WCAG-AA clamp report, every foreground/surface ratio, the OKLab',
  'distance from every shipped palette, and a paste-ready cssVars block. It is',
  'pure math over vendored data: no network, and it writes nothing.',
  '',
  'Two prompts package the longer guidance on demand: use-registry (the full',
  'workflow + dependency census) and setup-project (first-time consumer setup).',
]

const DB_INSTRUCTIONS = [
  'encode-ui registry — semantic search over a shadcn component registry.',
  '',
  'Start with search_components and describe the BEHAVIOUR you need in plain',
  'language ("something that shows a loading placeholder", "a input that masks',
  'what you type"). It searches each component\'s description, its full source,',
  'and its demo, so it does not need keywords or exact names. find_similar takes',
  'a component you already know and returns its neighbours.',
  ...COMMON_MIDDLE,
  'Two limits worth knowing. search_components is a ranked retriever, not an',
  'oracle of absence: it always returns the k nearest items, and rrf scores are',
  'rank-derived — their size cannot say "nothing here matches" (the absolute',
  '`cosine` on each hit can). For "does the registry have X?" or "list everything',
  'in Y", enumerate instead: list_groups, then list_components, and judge the',
  'descriptions yourself. And lexical matching ignores negation: a component',
  'described as "with no image asset" still matches the query "image". The',
  'description is the truth; matchedOn is the evidence trail, not a truth signal.',
  '',
  'If a result set is marked `degraded`, the embedding model was unavailable and',
  'only lexical matching ran — say so rather than presenting it as a full search.',
  ...COMMON_TAIL,
].join('\n')

const WEB_INSTRUCTIONS = [
  'encode-ui registry — component lookup over the deployed shadcn registry',
  '(web engine: index fetched live from the registry origin, zero-setup).',
  '',
  'Discovery works best in two steps: read the catalog resource',
  '(encode-ui://catalog, ≈20k tokens — every item with description and flags)',
  'ONCE and judge the descriptions yourself; use search_components as a fast',
  'plain filter for names, curated aliases ("modal", "toast"), and keywords —',
  'it is substring matching, not semantic search, so loose behaviour phrasing',
  'may miss. find_similar lists structurally related items (same group, shared',
  'categories and composition).',
  ...COMMON_MIDDLE,
  'Two limits worth knowing. search_components is a plain filter, never an',
  'oracle of absence: scores are rank-derived and `cosine` is always null on',
  'this engine — never read a score as calibrated. For "does the registry have',
  'X?" or "list everything in Y", enumerate instead: list_groups, then',
  'list_components, and judge the descriptions yourself. And source bodies are',
  'fetched from the registry origin: gated items need ENCODE_UI_TOKEN in the',
  'server environment (sign in at the registry site to copy one).',
  '',
  'Other engines the operator can select: --registry-engine catalog',
  '(bundled-index MiniSearch ranking, fully offline) or --registry-engine db',
  '(semantic hybrid search over full source and demos, served from the index',
  'that ships with the package when one is present).',
  ...COMMON_TAIL,
].join('\n')

const CATALOG_INSTRUCTIONS = [
  'encode-ui registry — component lookup over a shadcn component registry',
  '(catalog engine: lexical ranking, zero-setup).',
  '',
  'Start with search_components — component names, curated aliases ("modal",',
  '"toast"), or behaviour language all work; it ranks each component\'s name,',
  'title, description, and curated keywords. find_similar takes a component you',
  'already know and returns related ones (same group, shared composition,',
  'description overlap).',
  ...COMMON_MIDDLE,
  'Two limits worth knowing. search_components is a ranked retriever, not an',
  'oracle of absence: it always returns the k nearest items, and lexical scores',
  'are rank-derived with NO absolute similarity beside them (`cosine` is always',
  'null on this engine) — never read a score as calibrated. For "does the',
  'registry have X?" or "list everything in Y", enumerate instead: list_groups,',
  'then list_components, and judge the descriptions yourself. And lexical',
  'matching ignores negation: a component described as "with no image asset"',
  'still matches the query "image". The description is the truth; matchedOn is',
  'the evidence trail, not a truth signal.',
  '',
  'This install runs the zero-setup catalog engine. For semantic search over',
  'full source + demos (and embedding-space neighbours), the operator can',
  'relaunch with `--registry-engine db`, which needs a built index — one ships',
  'with the package, or `npm run build:index` produces it.',
  ...COMMON_TAIL,
].join('\n')

export function buildInstructions(kind: EngineKind): string {
  return kind === 'db'
    ? DB_INSTRUCTIONS
    : kind === 'catalog'
      ? CATALOG_INSTRUCTIONS
      : WEB_INSTRUCTIONS
}
