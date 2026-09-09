import assert from 'node:assert/strict'
import test from 'node:test'
import { usesUniversalBookingStagingProject } from '../src/supabase-environment.js'

test('production Reservations hostname cannot activate the universal-booking staging override', () => {
  assert.equal(usesUniversalBookingStagingProject('reservations.terrapeakgroup.com'), false)
  assert.equal(usesUniversalBookingStagingProject('RESERVATIONS.TERRAPEAKGROUP.COM'), false)
})

test('the existing universal-booking preview hostname behavior remains supported', () => {
  assert.equal(usesUniversalBookingStagingProject('reservation-tool-git-feature-univers-example.vercel.app'), true)
})
