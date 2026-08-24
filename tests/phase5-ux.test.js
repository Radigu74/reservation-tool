import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('management UI does not expose migration-era booking labels', async () => {
  const source = await read('../src/unified-bookings-admin.js')
  assert.doesNotMatch(source, /Unified booking|Unified Model|Legacy Records|Legacy reservation/)
})

test('unified shell retains management styling after removing internal navigation', async () => {
  const source = await read('../src/reservations-management-shell.js')
  const styles = await read('../src/reservations-management-shell.css')
  assert.match(source, /reservations-admin-style-marker/)
  assert.match(styles, /reservations-admin-style-marker[\s\S]*display:\s*none\s*!important/)
})

test('booking controls remain capability-aware and analytics fails closed', async () => {
  const bookings = await read('../src/unified-bookings-admin.js')
  const capabilities = await read('../src/management-capability-ui.js')
  assert.match(bookings, /hasCapability\('manageBookings'\)/)
  assert.match(bookings, /hasCapability\('viewAnalytics'\)/)
  assert.match(capabilities, /manageSettings/)
  assert.match(capabilities, /manageServices/)
  assert.match(capabilities, /manageTeam/)
  assert.match(capabilities, /viewOwnAvailability/)
  assert.doesNotMatch(capabilities, /canManageOwnAvailability/)
})

test('staff availability is view-only while planners retain management controls', async () => {
  const source = await read('../src/universal-booking-admin.js')
  const runtime = await read('../src/trusted-management-runtime.js')
  const migration = await read('../supabase/migrations/20260819033000_restrict_availability_writes_to_planners.sql')

  assert.match(source, /canViewOwnAvailability/)
  assert.match(source, /View only\. Contact your administrator or planner/)
  assert.doesNotMatch(runtime, /manageOwnAvailability/)
  assert.match(migration, /array\['owner', 'manager'\]/)
  assert.doesNotMatch(migration, /staff\.user_id\s*=\s*\(select auth\.uid\(\)\)/)
})

test('restaurant-only settings are rendered only when a restaurant service exists', async () => {
  const source = await read('../src/restaurant-settings.js')
  assert.match(source, /\$\{isRestaurant&&restaurant\?`<section class="panel">/)
  assert.match(source, /if\(isRestaurant&&restaurant\)\$\('#restaurantForm'\)/)
})

test('cohort service editing includes the complete future timetable', async () => {
  const source = await read('../src/universal-booking-admin.js')
  const runtime = await read('../src/trusted-management-runtime.js')
  const migration = await read('../supabase/migrations/20260819050441_full_cohort_service_editing.sql')

  assert.match(source, /edit-class-day-enabled/)
  assert.match(source, /editScheduleApplyFrom/)
  assert.match(source, /update_class_service_setup_v2/)
  assert.match(runtime, /update_class_service_setup_v2:\s*'manageServices'/)
  assert.match(migration, /future class already has bookings/i)
  assert.match(migration, /private\.materialize_cohort_sessions/)
})

test('published class timetables require visible and available teachers', async () => {
  const source = await read('../src/universal-booking-admin.js')
  const migration = await read('../supabase/migrations/20260819061000_class_publication_and_availability_guards.sql')
  assert.match(source, /Not ready for customers/)
  assert.match(source, /Outside weekly availability/)
  assert.match(migration, /Publish every selected teacher profile/)
  assert.match(migration, /outside the teacher''s weekly availability/)
})

test('centre holidays block teacher calendars and protect registered classes', async () => {
  const source = await read('../src/universal-booking-admin.js')
  const migration = await read('../supabase/migrations/20260819070000_centre_holidays.sql')
  assert.match(source, /Holidays and closures/)
  assert.match(source, /create_centre_holiday/)
  assert.match(migration, /Centre holiday:/)
  assert.match(migration, /active registrations/)
  assert.match(migration, /status='cancelled',is_published=false/)
})

test('staff profiles can be pre-linked to verified TerraPeak logins', async () => {
  const source = await read('../src/universal-booking-admin.js')
  const migration = await read('../supabase/migrations/20260819073000_staff_account_linking.sql')
  assert.match(source, /TerraPeak login email/)
  assert.match(source, /set_staff_login_email/)
  assert.match(migration, /business_login_email_idx/)
  assert.match(source, /toggle-staff-published/)
  assert.match(source, /Publish profile/)
})

test('class signup is an enquiry with parent self-service', async () => {
  const source = await read('../src/public-booking.js')
  const admin = await read('../src/universal-booking-admin.js')
  const migration = await read('../supabase/migrations/20260819080000_learning_centre_enquiries.sql')
  assert.match(source, /Final enrolment happens only after that conversation/)
  assert.match(source, /create_public_class_enquiry/)
  assert.match(source, /manage_public_class_enquiry/)
  assert.match(admin, /Manage enquiries/)
  assert.match(migration, /contact_requested/)
})

test('learning centre enquiries render and retain saved Customer Form fields', async () => {
  const source = await read('../src/public-booking.js')
  const admin = await read('../src/universal-booking-admin.js')
  const migration = await read('../supabase/migrations/20260824042453_learning_centre_customer_form_fields.sql')
  assert.match(source, /get_public_booking_custom_fields/)
  assert.match(source, /customFieldMarkup/)
  assert.match(source, /p_custom_data:customFieldAnswers/)
  assert.match(admin, /customAnswersMarkup/)
  assert.match(migration, /add column if not exists custom_data jsonb/)
  assert.match(migration, /Complete all required customer form fields/)
})

test('archived services remain discoverable and can be restored', async () => {
  const source = await read('../src/universal-booking-admin.js')
  const migration = await read('../supabase/migrations/20260819093000_restore_archived_services.sql')
  assert.match(source, /Archived services/)
  assert.match(source, /Restore as draft/)
  assert.match(source, /restore_archived_service/)
  assert.match(migration, /is_active=true,is_published=false/)
})

test('unused archived services can be permanently deleted without erasing history', async () => {
  const source = await read('../src/universal-booking-admin.js')
  const migration = await read('../supabase/migrations/20260819101500_permanently_delete_unused_archived_services.sql')
  assert.match(source, /Delete permanently/)
  assert.match(source, /Type DELETE to continue/)
  assert.match(source, /permanently_delete_archived_service/)
  assert.match(migration, /must remain archived/)
  assert.match(migration, /public\.scheduled_sessions/)
})
