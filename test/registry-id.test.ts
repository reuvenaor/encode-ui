import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INSTALL_CLI,
  docUrl,
  installCommand,
  qualifiedName,
  stripScope,
} from '../src/registry-id.ts'
import type { RegistryIdentity } from '../src/registry-id.ts'

const ID: RegistryIdentity = { scope: 'encode-ui', homepage: 'https://encode-ui.com' }
const OTHER: RegistryIdentity = { scope: 'acme', homepage: 'https://acme.test' }

test('qualifiedName prefixes the scope', () => {
  assert.equal(qualifiedName(ID, 'button'), '@encode-ui/button')
  assert.equal(qualifiedName(OTHER, 'button'), '@acme/button')
})

test('stripScope removes only its OWN scope', () => {
  assert.equal(stripScope(ID, '@encode-ui/button'), 'button')
  assert.equal(stripScope(ID, 'button'), 'button', 'bare name is untouched')
  assert.equal(
    stripScope(ID, '@acme/button'),
    '@acme/button',
    'a foreign scope is data, not a prefix to peel',
  )
  // `@` inside the name must not confuse a prefix test the way a loose regex would.
  assert.equal(stripScope(ID, 'button@2'), 'button@2')
  assert.equal(stripScope(ID, '@encode-ui/@weird'), '@weird')
  assert.equal(stripScope(ID, ''), '')
})

test('installCommand dedupes, keeping first occurrence', () => {
  assert.equal(
    installCommand(ID, ['button', 'button', 'card']),
    'npx shadcn@latest add @encode-ui/button @encode-ui/card',
  )
  assert.equal(
    installCommand(ID, ['card', 'button', 'card']),
    'npx shadcn@latest add @encode-ui/card @encode-ui/button',
    'order follows first appearance, not the dedupe pass',
  )
})

test('installCommand with one name is what ingest stores in install_cmd', () => {
  // The MCP tool used to rebuild this string by hand next to a SELECT of the
  // stored column. Both sides now call this, so they cannot diverge — but pin
  // the literal so a change to INSTALL_CLI is a deliberate, visible edit.
  assert.equal(
    installCommand(ID, ['magnetic-button']),
    'npx shadcn@latest add @encode-ui/magnetic-button',
  )
  assert.equal(INSTALL_CLI, 'npx shadcn@latest add')
})

test('docUrl branches on whether the item has a group', () => {
  assert.equal(
    docUrl(ID, 'buttons', 'magnetic-button', 'registry:component'),
    'https://encode-ui.com/view/buttons/magnetic-button',
  )
  assert.equal(
    docUrl(ID, null, 'use-mobile', 'registry:hook'),
    'https://encode-ui.com/view/use-mobile',
  )
  // Themes point at the palette GALLERY: the site's view route excludes
  // registry:theme, so /view/themes/<name> would render "Not found".
  assert.equal(
    docUrl(ID, 'themes', 'theme-amber-minimal', 'registry:theme'),
    'https://encode-ui.com/themes',
  )
})
