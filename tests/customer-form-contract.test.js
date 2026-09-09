import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUSTOMER_FORM_DEFAULTS,
  CUSTOMER_FIELD_TYPES,
  normalizeCustomerForm,
  normalizeCustomerFormField,
  renderCustomerFormField,
  serializeCustomerFormAnswers,
  validateCustomerForm,
} from '../src/customer-form-contract.js'

const fields = [
  { id: 10, field_label: 'Short', field_type: 'text', display_order: 20, is_active: true },
  { id: 11, field_label: 'Details', field_type: 'textarea', display_order: 30, is_active: true },
  { id: 12, field_label: 'First visit?', field_type: 'select', field_options: 'Yes\nNo', display_order: 10, is_required: true, is_active: true },
]

test('normalizes supported fields, options and ordering into one contract', () => {
  const result = normalizeCustomerForm(fields)
  assert.deepEqual(result.map(field => field.id), ['12', '10', '11'])
  assert.deepEqual(normalizeCustomerFormField(fields[2]).options, ['Yes', 'No'])
  assert.equal(result[0].field_type, 'dropdown')
})

test('validates required and select semantics', () => {
  assert.match(validateCustomerForm(fields, { '12': '' }), /First visit\? is required/)
  assert.match(validateCustomerForm(fields, { '12': 'Maybe' }), /invalid option/)
  assert.equal(validateCustomerForm(fields, { '12': 'Yes' }), '')
})

test('serializes custom answers by stable id without trusting client label snapshots', () => {
  const result = serializeCustomerFormAnswers(fields, { '10': 'Back pain', '11': 'Details', '12': 'Yes' })
  assert.equal(result['10'], 'Back pain')
  assert.equal(result['12'], 'Yes')
  assert.equal(result._field_labels, undefined)
})

test('supports and validates the authoritative eight Customer Form field types', () => {
  assert.deepEqual(CUSTOMER_FIELD_TYPES, ['text', 'textarea', 'dropdown', 'checkbox', 'email', 'phone', 'number', 'date'])
  assert.match(validateCustomerForm([{ id: 1, field_label: 'Email', field_type: 'email', is_active: true }], { 1: 'bad' }), /valid email/)
  assert.match(validateCustomerForm([{ id: 2, field_label: 'Count', field_type: 'number', is_active: true }], { 2: 'many' }), /number/)
  assert.equal(validateCustomerForm([{ id: 3, field_label: 'Date', field_type: 'date', is_active: true }], { 3: '2026-09-09' }), '')
  assert.match(validateCustomerForm([{ id: 3, field_label: 'Date', field_type: 'date', is_active: true }], { 3: '2026-02-31' }), /valid date/)
})

test('escapes labels, values, placeholders, options, and generated attributes', () => {
  const html = renderCustomerFormField({
    id: '1', field_label: '<script>alert("label")</script>', field_type: 'dropdown',
    field_options: '<img src=x onerror=1>\n"quoted"', placeholder: '" autofocus', value: '"quoted"', is_active: true,
  }, 'x" onfocus="alert(1)')
  assert.doesNotMatch(html, /<script>|<img|onfocus="alert/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /name="x&quot; onfocus=&quot;alert\(1\)"/)
  assert.match(html, /&quot;quoted&quot;/)
})

test('template defaults preserve Phase 2 field semantics', () => {
  assert.equal(CUSTOMER_FORM_DEFAULTS.dental[1][1], 'dropdown')
  assert.deepEqual(CUSTOMER_FORM_DEFAULTS.dental[1][2], ['Check-up', 'Cleaning', 'Filling', 'Extraction', 'Emergency', 'Other'])
  assert.equal(CUSTOMER_FORM_DEFAULTS.physiotherapy[4][2].length, 10)
})
