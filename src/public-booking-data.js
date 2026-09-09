export const PUBLIC_SERVICE_PROJECTION = [
  'id', 'business_id', 'name', 'slug', 'description', 'booking_type',
  'duration_minutes', 'slot_interval_minutes', 'buffer_before_minutes',
  'buffer_after_minutes', 'capacity', 'price', 'currency', 'is_active',
  'is_published', 'scheduling_mode', 'price_session_count',
  'package_validity_days', 'enrollment_mode', 'cohort_start_date',
  'cohort_end_date', 'schedule_open_ended', 'enrollment_closed', 'subject',
  'is_internal',
].join(',')

export const PUBLIC_STAFF_PROJECTION = [
  'id', 'display_name', 'slug', 'bio', 'photo_url', 'timezone',
  'is_active', 'is_published',
].join(',')

export const PUBLIC_ASSIGNMENT_PROJECTION = [
  'staff_id', 'service_id', 'custom_duration_minutes', 'custom_price',
  'is_active',
].join(',')

export function publicRows(data) {
  return Array.isArray(data) ? data : []
}
