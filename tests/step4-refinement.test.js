import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  bookingConfirmationPresentation,
  buildCustomerJourney,
  filterRestaurantSlotsForPartySize,
  restaurantPartySizeRange,
  scheduledRegistrationPresentation,
} from '../src/reservation-journey.js'
import { resolveReservationsConfiguration } from '../src/reservation-configuration.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('Learning Centre scheduled registrations use Student, Teacher, Class, Registration and package metadata', () => {
  const configuration = resolveReservationsConfiguration({ templateKey: 'learning_centre' })
  const presentation = scheduledRegistrationPresentation(configuration, { price_session_count: 4, package_validity_days: 30 })
  assert.equal(configuration.terminology.customerSingular, 'Student')
  assert.equal(configuration.terminology.teamMemberSingular, 'Teacher')
  assert.equal(configuration.terminology.serviceSingular, 'Class')
  assert.equal(configuration.terminology.bookingSingular, 'Registration')
  assert.deepEqual(presentation, {
    formHeading: 'Student details',
    confirmationKicker: 'Registration confirmed',
    confirmLabel: 'Confirm registration',
    packageSessions: 4,
    packageValidityDays: 30,
  })
})

test('confirmation CTA and success copy use resolved booking terminology for every supported template', () => {
  const expected = {
    general: ['Confirm booking', 'Booking confirmed'],
    dental: ['Confirm appointment', 'Appointment confirmed'],
    physiotherapy: ['Confirm appointment', 'Appointment confirmed'],
    salon: ['Confirm appointment', 'Appointment confirmed'],
    learning_centre: ['Confirm registration', 'Registration confirmed'],
    restaurant: ['Confirm reservation', 'Reservation confirmed'],
  }
  for (const [templateKey, [confirmLabel, confirmationKicker]] of Object.entries(expected)) {
    const presentation = bookingConfirmationPresentation(resolveReservationsConfiguration({ templateKey }))
    assert.equal(presentation.confirmLabel, confirmLabel)
    assert.equal(presentation.confirmationKicker, confirmationKicker)
  }
})

test('Restaurant journey starts with party size and filters slots by requested guests without changing appointment journeys', () => {
  assert.deepEqual(buildCustomerJourney({ capabilities: { guestCount: true, services: false } }), ['party-size', 'date-time', 'customer-form', 'confirmation'])
  assert.deepEqual(buildCustomerJourney({ capabilities: { services: false, teamResources: false } }), ['date-time', 'customer-form', 'confirmation'])
  assert.deepEqual(restaurantPartySizeRange(12), { min: 1, max: 12 })
  assert.deepEqual(filterRestaurantSlotsForPartySize([{ remaining_capacity: 1 }, { remaining_capacity: 12 }], 2), [{ remaining_capacity: 12 }])
})

test('Restaurant uses configured capacity while retaining the hidden operational service and no Services breadcrumb', async () => {
  const source = await read('../src/public-booking.js')
  const wordingSource = await read('../src/public-booking-flow.js')
  const migration = await read('../supabase/migrations/20260909141658_restaurant_capacity_contract.sql')
  assert.match(source, /restaurant_settings'\)\.select\('max_guests_per_slot'\)/)
  assert.match(source, /party\.onchange=load/)
  assert.match(source, /filterRestaurantSlotsForPartySize/)
  assert.match(source, /capabilities\.services===false\?'':/)
  assert.match(source, /create_public_restaurant_reservation/)
  assert.match(wordingSource, /bookingConfirmationPresentation\(configuration, \{ requestMode \}\)/)
  assert.doesNotMatch(wordingSource, /requestMode \? 'Request appointment' : 'Confirm booking'/)
  assert.match(migration, /settings\.max_guests_per_slot/)
  assert.doesNotMatch(migration, /service\.capacity/)
  assert.match(migration, /service\.is_internal/)
})
