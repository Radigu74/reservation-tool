import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  RESERVATIONS_MANAGEMENT_ROUTES,
  RESERVATIONS_MANAGEMENT_ROUTE_SET,
  RESERVATIONS_NAVIGATION,
} from '../src/reservations-routes.js'

const indexUrl = new URL('../index.html', import.meta.url)
const entryUrl = new URL('../src/management-entry.js', import.meta.url)
const formUrl = new URL('../src/customer-form-admin.js', import.meta.url)
const runtimeUrl = new URL('../src/trusted-management-runtime.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260821183000_customer_form_atomic_save.sql', import.meta.url)

test('all declared Reservations management routes are bootstrapped from the shared registry', async () => {
  const index = await readFile(indexUrl, 'utf8')
  const entry = await readFile(entryUrl, 'utf8')
  assert.equal(RESERVATIONS_MANAGEMENT_ROUTES.customerForm, 'admin/customer-form')
  assert.equal(RESERVATIONS_MANAGEMENT_ROUTE_SET.size, 8)
  assert.match(index, /RESERVATIONS_MANAGEMENT_ROUTE_SET/)
  assert.doesNotMatch(index, /new Set\(\['admin'/)
  assert.match(entry, /RESERVATIONS_MANAGEMENT_ROUTE_SET/)
  assert.match(entry, /RESERVATIONS_ROUTE_GROUPS\.customerForm/)
})

test('the unified shell owns exactly the canonical navigation', async () => {
  const shell = await readFile(new URL('../src/reservations-management-shell.js', import.meta.url), 'utf8')
  const enhancer = await readFile(new URL('../src/admin-enhancements.js', import.meta.url), 'utf8')
  const labels = RESERVATIONS_NAVIGATION.map(({ label }) => label)

  assert.deepEqual(labels, [
    'Bookings',
    'Services',
    'Team & Resources',
    'Scheduled',
    'Availability',
    'Analytics',
    'Customer Form',
    'Settings',
  ])
  assert.equal(new Set(labels).size, 8)
  assert.doesNotMatch(labels.join('|'), /Overview/)
  assert.match(shell, /RESERVATIONS_NAVIGATION/)
  assert.match(shell, /reservations-shell-nav/)
  assert.doesNotMatch(enhancer, /installUnifiedReservationsNavigation/)
  assert.doesNotMatch(enhancer, /\['Overview',/)
})

test('legacy dashboard and admin routes resolve to the Bookings landing route', async () => {
  const shell = await readFile(new URL('../src/reservations-management-shell.js', import.meta.url), 'utf8')
  assert.match(shell, /'admin'/)
  assert.match(shell, /'dashboard'/)
  assert.match(shell, /return 'Bookings'/)
  assert.equal(RESERVATIONS_MANAGEMENT_ROUTES.bookings, 'admin')
})

test('all canonical feature routes use the same shell navigation', async () => {
  const entry = await readFile(entryUrl, 'utf8')
  const shell = await readFile(new URL('../src/reservations-management-shell.js', import.meta.url), 'utf8')

  for (const route of [
    'services',
    'staff',
    'schedule',
    'availability',
    'analytics',
    'customerForm',
    'settings',
  ]) {
    assert.ok(RESERVATIONS_MANAGEMENT_ROUTE_SET.has(RESERVATIONS_MANAGEMENT_ROUTES[route]))
  }
  assert.match(entry, /reservations-management-shell\.js/)
  assert.match(shell, /RESERVATIONS_NAVIGATION\.map/)
})

test('Customer Form uses canonical dropdown fields with editable options and atomic persistence', async () => {
  const form = await readFile(formUrl, 'utf8')
  const runtime = await readFile(runtimeUrl, 'utf8')
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(form, /CUSTOMER_FIELD_TYPES/)
  assert.match(form, /draft-options/)
  assert.match(form, /save_booking_customer_form/)
  assert.doesNotMatch(form, /\.from\('booking_custom_fields'\)\.update\(payload\)/)
  assert.match(runtime, /save_booking_customer_form:'manageSettings'/)
  assert.match(runtime, /p_business_id:trustedBusinessId/)
  assert.match(migration, /security definer/)
  assert.match(migration, /private\.has_business_role/)
  assert.match(migration, /is_locked/)
})
