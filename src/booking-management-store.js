import { supabase } from './supabaseclient.js'
import { bookingDateTimeParts } from './booking-timezone.js'

const FINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show'])

function normalizeCanonicalBooking(row, context) {
  const displayZone = context.restaurantServiceIds.has(Number(row.service_id)) ? context.restaurantTimezone : 'UTC'
  const display = bookingDateTimeParts(row.starts_at, displayZone)
  const customData = row.custom_data && typeof row.custom_data === 'object' ? row.custom_data : {}
  const historicalLabels = customData._field_labels && typeof customData._field_labels === 'object' ? customData._field_labels : {}
  const customFields = Object.entries(customData)
    .filter(([key]) => !['_field_labels', 'customer_email'].includes(key))
    .map(([key, value]) => ({
      key,
      label: historicalLabels[key] || context.customFieldLabels.get(String(key)) || key,
      value
    }))
  return {
    source: 'bookings', id: row.id, businessId: Number(row.business_id), reference: row.reference || '',
    customerName: row.customer_name || '', customerPhone: row.customer_phone || '',
    customerEmail: row.customer_email || customData.customer_email || '',
    bookingDate: display.bookingDate, bookingTime: display.bookingTime,
    startsAt: row.starts_at || null, endsAt: row.ends_at || null, quantity: Number(row.quantity || 1),
    status: row.status || 'pending', notes: row.notes || '', archived: FINAL_STATUSES.has(row.status),
    archiveSupported: false, serviceId: row.service_id ?? null,
    serviceName: context.serviceNames.get(Number(row.service_id)) || '',
    staffId: row.staff_id ?? null, scheduledSessionId: row.scheduled_session_id ?? null,
    customFields, createdAt: row.created_at || null, raw: row
  }
}

function nextDate(dateValue) {
  const value = new Date(`${dateValue}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

async function getCanonicalDisplayContext(businessId) {
  const [servicesResult, settingsResult, fieldsResult] = await Promise.all([
    supabase.from('services').select('id,name,booking_type,is_internal').eq('business_id', businessId),
    supabase.from('restaurant_settings').select('timezone').eq('business_id', businessId).maybeSingle(),
    supabase.from('booking_custom_fields').select('id,field_label,is_active').eq('business_id', businessId)
  ])
  if (servicesResult.error) throw servicesResult.error
  if (settingsResult.error) throw settingsResult.error
  if (fieldsResult.error) throw fieldsResult.error
  const services = servicesResult.data || []
  return {
    restaurantServiceIds: new Set(services.filter(service => service.booking_type === 'restaurant').map(service => Number(service.id))),
    restaurantTimezone: settingsResult.data?.timezone || 'UTC',
    serviceNames: new Map(services.map(service => [Number(service.id), service.is_internal ? '' : (service.name || '')])),
    customFieldLabels: new Map((fieldsResult.data || []).map(field => [String(field.id), field.field_label || String(field.id)]))
  }
}

function buildCanonicalQuery({ businessId, startDate, endDate, reference }) {
  let query = supabase.from('bookings').select('*').eq('business_id', businessId).order('starts_at', { ascending: true })
  if (reference) return query.eq('reference', reference)
  return query.gte('starts_at', `${startDate}T00:00:00.000Z`).lt('starts_at', `${nextDate(endDate)}T00:00:00.000Z`)
}

export async function listManagedBookings({ businessId, startDate, endDate, reference = '', viewMode = 'active' }) {
  const [canonicalResult, displayContext] = await Promise.all([
    buildCanonicalQuery({ businessId, startDate, endDate, reference }), getCanonicalDisplayContext(businessId)
  ])
  if (canonicalResult.error) throw canonicalResult.error
  let rows = (canonicalResult.data || []).map(row => normalizeCanonicalBooking(row, displayContext))
  const legacyRows = await loadUnmigratedLegacyBookings({ businessId, startDate, endDate, reference })
  rows = [...rows, ...legacyRows]
  if (!reference && viewMode === 'active') rows = rows.filter(row => !row.archived)
  if (!reference && viewMode === 'archived') rows = rows.filter(row => row.archived)
  rows.sort((a, b) => `${a.bookingDate}T${a.bookingTime}`.localeCompare(`${b.bookingDate}T${b.bookingTime}`))
  return rows
}

export async function updateManagedBookingStatus(booking, status) {
  if (booking?.source !== 'bookings') return { error: new Error('Legacy records must be reconciled before they can be changed.') }
  return supabase.from('bookings').update({ status }).eq('id', booking.id)
}

async function loadUnmigratedLegacyBookings({ businessId, startDate, endDate, reference }) {
  let legacyQuery = supabase.from('reservations').select('*').eq('business_id', businessId)
  if (reference) legacyQuery = legacyQuery.eq('reservation_reference', reference)
  else legacyQuery = legacyQuery.gte('reservation_date', startDate).lte('reservation_date', endDate)
  const [legacyResult, mappingResult] = await Promise.all([
    legacyQuery.order('reservation_date', { ascending: true }).order('reservation_time', { ascending: true }),
    supabase.from('reservation_booking_migrations').select('legacy_reservation_id').eq('business_id', businessId)
  ])
  if (legacyResult.error || mappingResult.error) return []
  const mapped = new Set((mappingResult.data || []).map(row => String(row.legacy_reservation_id)))
  return (legacyResult.data || []).filter(row => !mapped.has(String(row.id))).map(row => ({
    source: 'legacy', id: row.id, businessId: Number(row.business_id), reference: row.reservation_reference || '',
    customerName: row.customer_name || '', customerPhone: row.phone || '', customerEmail: row.customer_email || '',
    bookingDate: row.reservation_date || '', bookingTime: String(row.reservation_time || '').slice(0, 5),
    startsAt: null, endsAt: null, quantity: Number(row.party_size || 1), status: row.status || 'pending',
    notes: row.special_request || '', archived: Boolean(row.is_archived) || FINAL_STATUSES.has(row.status),
    archiveSupported: false, serviceId: null, serviceName: '', staffId: null, scheduledSessionId: null,
    customFields: Object.entries(row.custom_data && typeof row.custom_data === 'object' ? row.custom_data : {}).map(([key, value]) => ({ key, label: key, value })),
    createdAt: row.created_at || null, raw: row, legacyCompatibility: true
  }))
}
