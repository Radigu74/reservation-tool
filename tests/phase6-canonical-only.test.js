import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('management store has canonical writes plus explicit legacy compatibility reads', async () => {
  const source = await readFile(new URL('../src/booking-management-store.js', import.meta.url), 'utf8')
  assert.match(source, /from\(['"]bookings['"]\)/)
  assert.match(source, /from\(['"]reservations['"]\)/)
  assert.match(source, /reservation_booking_migrations/)
  assert.match(source, /Legacy records must be reconciled/)
  assert.doesNotMatch(source, /booking_model_version/)
})

test('legacy table finalization blocks every mutation and preserves the table', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260818140000_freeze_legacy_reservations.sql', import.meta.url), 'utf8')
  assert.match(sql, /before insert or update or delete/i)
  assert.match(sql, /revoke insert, update, delete/i)
  assert.doesNotMatch(sql, /drop table/i)
  assert.doesNotMatch(sql, /delete from public\.reservations/i)
})
