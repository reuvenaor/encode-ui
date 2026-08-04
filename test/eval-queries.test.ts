import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadQueries } from '../eval/queries.ts'
import { buildFixtureIndex } from './fixtures/index-fixture.ts'

const write = (queries: unknown): string => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'rag-eval-')), 'queries.json')
  writeFileSync(file, JSON.stringify({ queries }))
  return file
}

test('loadQueries validates every label against the index', () => {
  const db = buildFixtureIndex([{ name: 'alpha-button' }])

  const good = write([{ q: 'a button', expect: ['alpha-button'], kind: 'intent' }])
  assert.equal(loadQueries(db, good).length, 1)

  // The file promises "every expect name is a real item" — a rename must fail
  // the eval loudly instead of rotting it into permanent misses.
  const bad = write([{ q: 'a button', expect: ['ghost-item'], kind: 'intent' }])
  assert.throws(() => loadQueries(db, bad), /ghost-item/)

  const badForbid = write([
    { q: 'x', expect: ['alpha-button'], forbid: ['ghost-item'], kind: 'negation' },
  ])
  assert.throws(() => loadQueries(db, badForbid), /ghost-item/)

  db.close()
})

test('loadQueries enforces the kind invariants', () => {
  const db = buildFixtureIndex([{ name: 'alpha-button' }, { name: 'beta-input' }])

  // Valid: a negation query with a true answer + a forbid, and a bare absence.
  const good = write([
    { q: 'x', expect: ['alpha-button'], forbid: ['beta-input'], kind: 'negation' },
    { q: 'y', expect: [], kind: 'absence' },
    { q: 'z', expect: [], forbid: ['beta-input'], kind: 'absence' },
  ])
  assert.equal(loadQueries(db, good).length, 3)

  // An absence query claiming the registry has something contradicts itself.
  assert.throws(
    () => loadQueries(db, write([{ q: 'y', expect: ['alpha-button'], kind: 'absence' }])),
    /kind:absence but carries expect/,
  )
  // Every other kind is meaningless without a relevant set.
  assert.throws(
    () => loadQueries(db, write([{ q: 'y', expect: [], kind: 'intent' }])),
    /no expect labels/,
  )
  // A negation query IS its forbid list.
  assert.throws(
    () => loadQueries(db, write([{ q: 'y', expect: ['alpha-button'], kind: 'negation' }])),
    /no forbid labels/,
  )

  db.close()
})
