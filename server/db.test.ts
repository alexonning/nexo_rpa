import assert from 'node:assert/strict'
import test from 'node:test'
import { quoteIdentifier } from './db.js'

test('escapes embedded quotes in SQL identifiers', () => {
  assert.equal(quoteIdentifier('routine"table'), '"routine""table"')
})

test('rejects empty identifiers and null bytes', () => {
  assert.throws(() => quoteIdentifier(''))
  assert.throws(() => quoteIdentifier('unsafe\0name'))
})
