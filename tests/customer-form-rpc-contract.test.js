import assert from 'node:assert/strict'
import test from 'node:test'
import { augmentCustomerFormRpcArgs } from '../src/customer-form-rpc-contract.js'

const identity = { name: 'Guest', email: 'guest@example.test', phone: '+6500000040' }
const customData = { 44: 'Window' }

test('Customer Form augmentation emits the exact deployed appointment payload', () => {
  const payload = augmentCustomerFormRpcArgs('create_public_booking', {
    p_business_slug: 'general', p_service_slug: 'consultation', p_staff_slug: 'provider',
    p_starts_at: '2026-09-10T09:00:00Z', p_notes: null,
  }, identity, customData)
  assert.deepEqual(Object.keys(payload).sort(), [
    'p_business_slug', 'p_custom_data', 'p_customer_email', 'p_customer_name',
    'p_customer_phone', 'p_notes', 'p_service_slug', 'p_staff_slug', 'p_starts_at',
  ].sort())
  assert.deepEqual(payload.p_custom_data, customData)
})

test('Customer Form augmentation emits the exact deployed scheduled-session payload', () => {
  const payload = augmentCustomerFormRpcArgs('create_public_session_booking', {
    p_business_slug: 'learning', p_service_slug: 'class', p_session_id: 252,
    p_notes: null, p_quantity: 1,
  }, identity, customData)
  assert.deepEqual(Object.keys(payload).sort(), [
    'p_business_slug', 'p_custom_data', 'p_customer_email', 'p_customer_name',
    'p_customer_phone', 'p_notes', 'p_quantity', 'p_service_slug', 'p_session_id',
  ].sort())
  assert.deepEqual(payload.p_custom_data, customData)
})

test('Customer Form augmentation emits the exact deployed Restaurant payload', () => {
  const payload = augmentCustomerFormRpcArgs('create_public_restaurant_reservation', {
    p_business_slug: 'restaurant', p_reservation_date: '2026-09-10',
    p_reservation_time: '09:00', p_party_size: 1, p_special_request: null,
  }, identity, customData)
  assert.deepEqual(Object.keys(payload).sort(), [
    'p_business_slug', 'p_custom_data', 'p_customer_name', 'p_party_size', 'p_phone',
    'p_reservation_date', 'p_reservation_time', 'p_special_request',
  ].sort())
  assert.equal(payload.p_phone, identity.phone)
  assert.equal(payload.p_custom_data.customer_email, identity.email)
  assert.equal(payload.p_custom_data[44], 'Window')
  assert.equal('p_customer_email' in payload, false)
  assert.equal('p_customer_phone' in payload, false)
})

test('Customer Form contract preserves the exact deployed class-enquiry payload', () => {
  const payload = augmentCustomerFormRpcArgs('create_public_class_enquiry', {
    p_business_slug: 'learning', p_service_slug: 'cohort', p_student_name: 'Student',
    p_student_date_of_birth: null, p_school_grade: null, p_joins_on: '2026-09-10',
    p_notes: null, p_consent_to_contact: true,
  }, identity, customData)
  assert.deepEqual(Object.keys(payload).sort(), [
    'p_business_slug', 'p_consent_to_contact', 'p_custom_data', 'p_customer_email',
    'p_customer_phone', 'p_guardian_name', 'p_joins_on', 'p_notes', 'p_school_grade',
    'p_service_slug', 'p_student_date_of_birth', 'p_student_name',
  ].sort())
  assert.equal(payload.p_guardian_name, identity.name)
  assert.deepEqual(payload.p_custom_data, customData)
})
