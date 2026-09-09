import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadPublicReservationsConfiguration, loadTenantReservationsSettings } from '../src/reservation-settings-access.js'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('settings migration combines explicit grants with tenant RLS and a narrow public RPC', async () => {
  const sql = await read('supabase/migrations/20260908100000_reservation_configuration_contract.sql')
  assert.match(sql, /revoke all on table public\.reservation_business_settings from public, anon, authenticated/i)
  assert.match(sql, /grant select, insert, update on table public\.reservation_business_settings to authenticated/i)
  assert.match(sql, /for select to authenticated[\s\S]*private\.has_business_role\(business_id\)/i)
  assert.match(sql, /get_public_reservations_configuration/)
  assert.match(sql, /on conflict \(business_id\) do update[\s\S]*where public\.reservation_business_settings\.template_key is null/i)
  assert.match(sql, /business\.business_type = 'restaurant'[\s\S]*then profile\.industry_template/i)
  assert.match(sql, /else 'general'/i)
})

test('old and custom-data booking RPC signatures remain uniquely resolvable', async () => {
  const oldSql = await read('supabase/migrations/20260814065046_public_booking_api.sql')
  const newSql = await read('supabase/migrations/20260908103000_customer_form_booking_contract.sql')
  assert.match(oldSql, /create or replace function public\.create_public_booking\([\s\S]*?p_notes text[\s\S]*?\)/i)
  const customBooking = newSql.match(/create or replace function public\.create_public_booking\(([\s\S]*?)\)\s*returns table/i)?.[1] || ''
  const customSession = newSql.match(/create or replace function public\.create_public_session_booking\(([\s\S]*?)\)\s*returns table/i)?.[1] || ''
  assert.match(customBooking, /p_custom_data jsonb/)
  assert.match(customSession, /p_custom_data jsonb/)
  assert.doesNotMatch(customBooking, /default/i)
  assert.doesNotMatch(customSession, /default/i)
})

test('database owns field types and historical label snapshots', async () => {
  const sql = await read('supabase/migrations/20260908103000_customer_form_booking_contract.sql')
  for (const type of ['text', 'textarea', 'dropdown', 'checkbox', 'email', 'phone', 'number', 'date']) assert.match(sql, new RegExp(`'${type}'`))
  assert.match(sql, /p_fields is null or jsonb_typeof\(p_fields\) <> 'array'/)
  assert.match(sql, /labels := labels \|\| jsonb_build_object\(field\.id::text, field\.field_label\)/)
  assert.match(sql, /> \(case when field\.field_type = 'textarea' then 2000 else 500 end\) then/)
  assert.doesNotMatch(sql, /> case when field\.field_type = 'textarea' then 2000 else 500 end then/)
  assert.doesNotMatch(sql, /p_custom_data->'_field_labels'/)
  assert.match(sql, /create or replace function public\.create_public_restaurant_reservation[\s\S]*normalize_public_customer_form_data/)
  assert.match(sql, /create or replace function public\.create_public_class_enquiry[\s\S]*array\['student name'\]::text\[\]/)
})

test('internal services stay published but are excluded from public and management lists', async () => {
  const sql = await read('supabase/migrations/20260908110000_internal_service_capability_support.sql')
  const publicBooking = await read('src/public-booking.js')
  const management = await read('src/universal-booking-admin.js')
  assert.doesNotMatch(sql, /set is_internal = true, is_published = false/i)
  assert.match(sql, /is_active and is_published and not is_internal/i)
  assert.match(sql, /service\.is_internal/)
  assert.match(publicBooking, /eq\('is_internal',false\)/)
  assert.match(management, /eq\('is_internal', false\)/)
})

test('zero-legacy activation precedes timezone and internal-service requirements', async () => {
  const sql = await read('supabase/migrations/20260908140000_transaction_safe_reservation_migration.sql')
  const legacyCount = sql.indexOf('select count(*)::integer into v_legacy_count')
  const guardedValidation = sql.indexOf('if v_legacy_count > 0 then')
  const serviceRequirement = sql.indexOf('An active published canonical internal service is required')
  assert.ok(legacyCount > 0 && guardedValidation > legacyCount && serviceRequirement > guardedValidation)
  assert.match(sql, /pg_advisory_xact_lock\(p_business_id\)/)
})

test('mapping metadata is explicitly service-role only', async () => {
  const sql = await read('supabase/migrations/20260908120000_reservation_booking_migration_map.sql')
  assert.match(sql, /revoke all on table public\.reservation_booking_migrations from public, anon, authenticated/i)
  assert.match(sql, /grant select, insert, update[\s\S]*to service_role/i)
})

test('mapping privilege hardening overrides broad service-role default grants', async () => {
  const sql = await read('supabase/migrations/20260908130000_reservation_booking_migration_map_privilege_hardening.sql')
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    assert.match(sql, new RegExp(`revoke all privileges on table public\\.reservation_booking_migrations from ${role}`, 'i'))
  }
  assert.match(sql, /grant select, insert, update on table public\.reservation_booking_migrations to service_role/i)
  assert.doesNotMatch(sql, /grant[^;]*(delete|truncate|references|trigger)[^;]*service_role/i)
})

test('page modules no longer generate competing management navigation', async () => {
  const customerForm = await read('src/customer-form-admin.js')
  const settings = await read('src/restaurant-settings.js')
  assert.doesNotMatch(customerForm, /function nav\(/)
  assert.doesNotMatch(settings, /function nav\(/)
  assert.doesNotMatch(customerForm, /<nav class="admin-nav"/)
  assert.doesNotMatch(settings, /<nav class="admin-nav"/)
})

test('settings loaders surface Data API errors instead of returning defaults', async () => {
  const failingQuery = {
    select() { return this }, eq() { return this },
    async maybeSingle() { return { data: null, error: { message: 'permission denied' } } },
  }
  const client = {
    from() { return failingQuery },
    async rpc() { return { data: null, error: { message: 'rpc unavailable' } } },
  }
  await assert.rejects(() => loadTenantReservationsSettings(client, 10), /permission denied/)
  await assert.rejects(() => loadPublicReservationsConfiguration(client, 'terrapeak'), /rpc unavailable/)
})
