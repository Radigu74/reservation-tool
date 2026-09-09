import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveReservationsConfiguration } from '../src/reservation-configuration.js'

test('template terminology resolves for supported business types', () => {
  assert.equal(resolveReservationsConfiguration({ templateKey: 'dental' }).terminology.teamMemberSingular, 'Dentist')
  assert.equal(resolveReservationsConfiguration({ businessType: 'physiotherapy' }).terminology.customerSingular, 'Patient')
  assert.equal(resolveReservationsConfiguration({ templateKey: 'learning_centre' }).terminology.servicePlural, 'Classes')
  assert.equal(resolveReservationsConfiguration({ templateKey: 'restaurant' }).terminology.bookingSingular, 'Reservation')
})

test('tenant terminology overrides template defaults', () => {
  const resolved = resolveReservationsConfiguration({ templateKey: 'dental', terminology: { teamMemberSingular: 'Clinician' } })
  assert.equal(resolved.terminology.teamMemberSingular, 'Clinician')
  assert.equal(resolved.terminology.customerSingular, 'Patient')
})

test('unknown templates use neutral defaults rather than restaurant wording', () => {
  const resolved = resolveReservationsConfiguration({ templateKey: 'unknown' })
  assert.equal(resolved.templateKey, 'general')
  assert.equal(resolved.terminology.customerSingular, 'Customer')
  assert.equal(resolved.terminology.bookingSingular, 'Booking')
})
