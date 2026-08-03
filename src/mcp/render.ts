// Human-readable rendering of every tool result.
//
// Separated from the handlers so the formatters are pure — (data, identity) in,
// string out — and can be asserted against directly. Each takes only the data
// its tool returns, so a formatter physically cannot read a field the tool does
// not produce.
import { qualifiedName } from '../registry-id.ts'
import type { RegistryIdentity } from '../registry-id.ts'
import type {
  FindIconsOutput,
  FindSimilarOutput,
  GetComponentOutput,
  GetInstallCommandOutput,
  Hit,
  ListComponentsOutput,
  ListGroupsOutput,
  SearchComponentsOutput,
} from './schemas.ts'

const DEGRADED_NOTE = '\n\n(degraded: embedding model unavailable — lexical results only)'

const CATALOG_NOTE =
  '\n\n(catalog engine: lexical ranking over curated metadata — no semantic ' +
  'similarity; build rag/index.db for semantic search)'

// find_similar's framing ("Nearest to …") reads as embedding neighbours; on
// the catalog engine the scores are structural overlap, and a host that
// renders only the text channel would never see the structuredContent fields
// that say so — the whole reason the prose channel discloses the engine.
const SIMILAR_CATALOG_NOTE =
  '\n\n(catalog engine: structural overlap — shared group, categories, ' +
  'composition, description words — not embedding similarity; build ' +
  'rag/index.db for semantic neighbours)'

const WEB_NOTE =
  '\n\n(web engine: plain filter over the fetched registry index — no relevance ' +
  'ranking; for discovery read the catalog resource encode-ui://catalog and ' +
  'judge the descriptions yourself)'

const SIMILAR_WEB_NOTE =
  '\n\n(web engine: structural overlap — shared group, categories, composition — ' +
  'not embedding similarity)'

export const listOrNone = (values: readonly string[]): string =>
  values.length > 0 ? values.join(', ') : 'none'

const hitLines = (id: RegistryIdentity, hits: readonly Hit[]): string =>
  hits
    .map((h, i) =>
      [
        `${i + 1}. ${h.title} — ${qualifiedName(id, h.name)}`,
        `   ${h.description}`,
        `   group: ${h.group ?? '—'} | matched: ${h.matchedOn.join(', ')} | score: ${h.score.toFixed(4)}` +
          // For similar-hits cosine IS the score; repeating it would just be noise.
          (h.scoreKind === 'rrf' && h.cosine !== null ? ` | cosine: ${h.cosine.toFixed(4)}` : '') +
          (h.pure ? ' | dependency-free' : '') +
          (h.gated ? ' | gated (source needs a registry account)' : ''),
        `   install: ${h.installCmd}`,
        `   docs: ${h.docUrl}`,
      ].join('\n'),
    )
    .join('\n\n')

/**
 * Each renderer takes ONLY its tool's output type, so it physically cannot
 * describe a field the tool does not return — the two channels stay in step by
 * construction rather than by discipline.
 */
export function renderSearch(id: RegistryIdentity, out: SearchComponentsOutput): string {
  if (out.hits.length === 0) return `No components match "${out.query}".`
  const note = out.degraded
    ? DEGRADED_NOTE
    : out.engine === 'catalog'
      ? CATALOG_NOTE
      : out.engine === 'web'
        ? WEB_NOTE
        : ''
  return hitLines(id, out.hits) + note
}

export function renderSimilar(id: RegistryIdentity, out: FindSimilarOutput): string {
  if (out.neighbours.length === 0) return `Nothing in the registry is close to "${out.seed}".`
  const note =
    out.engine === 'catalog'
      ? SIMILAR_CATALOG_NOTE
      : out.engine === 'web'
        ? SIMILAR_WEB_NOTE
        : ''
  return `Nearest to ${qualifiedName(id, out.seed)}:\n\n${hitLines(id, out.neighbours)}${note}`
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

export function renderComponent(out: GetComponentOutput): string {
  // partsFilePath is the comma-joined sibling list — count from it, since a
  // multi-file block ships more than the classic two-file parts pair.
  const siblingCount = out.partsFilePath === null ? 0 : out.partsFilePath.split(', ').length
  const payloads = [
    out.sourceBytes === null
      ? null
      : `source (${kb(out.sourceBytes)}${
          siblingCount > 0
            ? `, ${siblingCount + 1} files — the public module plus the sibling${
                siblingCount > 1 ? 's' : ''
              } it imports`
            : ''
        })`,
    out.demoBytes === null ? null : `demo (${kb(out.demoBytes)})`,
  ].filter((p): p is string => p !== null)

  return [
    `# ${out.title} (${out.qualifiedName})`,
    '',
    out.description,
    '',
    `- type: ${out.type}`,
    `- group: ${out.group ? `${out.group.label} (${out.group.slug})` : '—'}`,
    `- npm dependencies: ${listOrNone(out.dependencies)}`,
    `- registry dependencies: ${listOrNone(out.registryDependencies)}`,
    out.pureReact
      ? '- install weight: dependency-free — nothing beyond the shadcn baseline ' +
        '(the cn() pair, class-variance-authority, radix-ui)'
      : `- install weight: adds ${listOrNone(out.transitiveDependencies)} (transitive, whole install tree)`,
    `- provenance: ${out.provenance ?? '—'}${out.license ? ` (${out.license})` : ''}`,
    out.sourceUrl ? `- upstream: ${out.sourceUrl}` : null,
    `- animated: ${out.motion ? 'yes (honours prefers-reduced-motion)' : 'no'}`,
    out.gated ? '- gated: the published source payload requires a registry account' : null,
    `- install: ${out.installCmd}`,
    `- docs: ${out.docUrl}`,
    // A required step, not a reference — kept on its own line, unabbreviated, because
    // skipping it leaves a component that installs cleanly and then does not work.
    out.setup ? `- setup after install: ${out.setup.replace(/\s+/g, ' ').trim()}` : null,
    payloads.length > 0
      ? `\nAvailable via get_component_source: ${payloads.join(', ')}.`
      : '\nNo source or demo is stored for this item.',
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
}

/**
 * The one payload deliberately returned as prose — see the tool's description.
 *
 * Takes a LIST: a split item's public module imports its `.parts.tsx` sibling,
 * so returning files[0] alone hands back a file with a dangling import and no
 * hint that a second one exists. Each file gets its own heading and fence.
 */
export const renderSource = (
  qualified: string,
  part: 'source' | 'demo',
  files: readonly { path: string | null; code: string }[],
): string =>
  files
    .map(({ path, code }) =>
      [
        part === 'source'
          ? `## ${qualified} — ${path ?? 'source'}`
          : `## ${qualified} — demo usage`,
        '```tsx',
        code,
        '```',
      ].join('\n'),
    )
    .join('\n\n')

export const renderGroups = (out: ListGroupsOutput): string =>
  [
    ...out.groups.map((g) => `${g.slug.padEnd(14)} ${String(g.count).padStart(3)}  ${g.label}`),
    '',
    `${out.groups.length} groups · ${out.totalItems} components`,
  ].join('\n')

export const renderComponents = (out: ListComponentsOutput): string =>
  [
    `${out.group.label} (${out.group.slug}) — ${out.count} components, full membership:`,
    '',
    ...out.components.map(
      (c) => `- ${c.name}${c.pure ? ' (dependency-free)' : ''} — ${c.description}`,
    ),
  ].join('\n')

export const renderInstall = (out: GetInstallCommandOutput): string =>
  out.unknown.length > 0 ? `${out.command}\n\nUnknown: ${out.unknown.join(', ')}` : out.command

export const renderIcons = (out: FindIconsOutput): string => {
  const lines: string[] = []
  if (out.icons.length > 0) {
    lines.push(
      ...out.icons.map((icon, i) => {
        const note =
          icon.resolvedFrom !== null
            ? `\n   note: "${icon.resolvedFrom}" is a${
                icon.deprecatedAliases.includes(icon.resolvedFrom) ? ' deprecated' : 'n'
              } alias — import ${icon.component}`
            : ''
        return (
          `${i + 1}. ${icon.name} (${icon.component}) — tags: ${listOrNone(icon.tags)}` +
          ` · categories: ${listOrNone(icon.categories)}${note}`
        )
      }),
      '',
      out.usage ?? '',
      `(every icon also exports an Icon-suffixed spelling, e.g. ${out.icons[0]!.component}Icon)`,
    )
  } else {
    lines.push('No icons matched.')
  }
  if (out.unknown.length > 0) {
    lines.push(
      '',
      ...out.unknown.map(
        (u) =>
          `unknown: "${u.name}"` +
          (u.suggestions.length > 0 ? ` — closest: ${u.suggestions.join(', ')}` : ''),
      ),
    )
  }
  lines.push('', `lucide-react ${out.lucideVersion} · ${out.install}`)
  return lines.join('\n')
}
