export const CUSTOMER_FIELD_TYPES = Object.freeze(['text', 'textarea', 'dropdown', 'checkbox', 'email', 'phone', 'number', 'date'])

export const SYSTEM_FIELD_KEYS = Object.freeze({
  name: 'customer_name',
  phone: 'customer_phone',
  email: 'customer_email',
})

export const CUSTOMER_FORM_DEFAULTS = Object.freeze({
  general: [],
  dental: [['Reason for visit', 'textarea', [], true], ['Procedure', 'dropdown', ['Check-up', 'Cleaning', 'Filling', 'Extraction', 'Emergency', 'Other'], false], ['First visit?', 'dropdown', ['Yes', 'No'], false], ['Preferred dentist', 'text', [], false]],
  physiotherapy: [['Main concern', 'textarea', [], true], ['Affected region', 'text', [], false], ['First visit?', 'dropdown', ['Yes', 'No'], false], ['Preferred therapist', 'text', [], false], ['Pain level', 'dropdown', ['1','2','3','4','5','6','7','8','9','10'], false]],
  learning_centre: [['Student name', 'text', [], true], ['Age / year level', 'text', [], false], ['Subject or programme', 'text', [], true], ['First visit?', 'dropdown', ['Yes', 'No'], false]],
  salon: [['Requested service', 'text', [], true], ['Preferred stylist', 'text', [], false], ['First visit?', 'dropdown', ['Yes', 'No'], false]],
  restaurant: [['Special requests', 'textarea', [], false]],
})

export function normalizeCustomerFormField(field = {}) {
  const type = field.field_type === 'select' ? 'dropdown' : String(field.field_type || 'text').toLowerCase()
  const options = type === 'dropdown'
    ? (Array.isArray(field.options) ? field.options : String(field.field_options || '').split(/\r?\n|,/)).map(value => String(value).trim()).filter(Boolean)
    : []
  const id = field.id == null ? null : String(field.id)
  return {
    id,
    key: String(field.key || field.system_key || id || ''),
    field_label: String(field.field_label || field.label || '').trim(),
    field_type: type,
    options: [...new Set(options)],
    is_required: Boolean(field.is_required ?? field.required),
    is_active: field.is_active !== false,
    display_order: Number(field.display_order || 0),
    system_key: field.system_key || null,
    is_locked: Boolean(field.is_locked),
    placeholder: String(field.placeholder || ''),
    value: field.value ?? '',
  }
}

export function normalizeCustomerForm(fields = [], { activeOnly = false } = {}) {
  return fields.map(normalizeCustomerFormField)
    .filter(field => !activeOnly || field.is_active)
    .sort((a, b) => a.display_order - b.display_order || String(a.id).localeCompare(String(b.id)))
}

export function validateCustomerFormValue(field, value) {
  const normalized = normalizeCustomerFormField(field)
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0)
  if (normalized.is_required && (normalized.field_type === 'checkbox' ? value !== true : empty)) return `${normalized.field_label} is required.`
  if (empty) return ''
  if (normalized.field_type === 'dropdown' && !normalized.options.includes(String(value))) return `${normalized.field_label} has an invalid option.`
  if (normalized.field_type === 'number' && !Number.isFinite(Number(value))) return `${normalized.field_label} must be a number.`
  if (normalized.field_type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return `${normalized.field_label} must be a valid email address.`
  if (normalized.field_type === 'phone' && (String(value).trim().length < 3 || String(value).length > 50)) return `${normalized.field_label} must be a valid phone number.`
  if (normalized.field_type === 'date' && !isValidIsoDate(value)) return `${normalized.field_label} must be a valid date.`
  return ''
}

export function validateCustomerForm(fields, values = {}) {
  for (const field of normalizeCustomerForm(fields, { activeOnly: true })) {
    const error = validateCustomerFormValue(field, values[field.key] ?? values[field.id])
    if (error) return error
  }
  return ''
}

export function serializeCustomerFormAnswers(fields, values = {}) {
  const normalized = normalizeCustomerForm(fields, { activeOnly: true })
  const answers = {}
  for (const field of normalized) {
    const value = values[field.key] ?? values[field.id]
    if (field.system_key) continue
    if (value !== undefined && value !== null && value !== '') {
      answers[field.key] = field.field_type === 'checkbox' ? Boolean(value) : String(value)
    }
  }
  return answers
}

export function formValues(form, fields) {
  const values = {}
  for (const field of normalizeCustomerForm(fields, { activeOnly: true })) {
    const identityName = field.system_key === 'name' || field.system_key === 'customer_name' ? 'name' : field.system_key === 'phone' || field.system_key === 'customer_phone' ? 'phone' : field.system_key === 'email' || field.system_key === 'customer_email' ? 'email' : null
    const input = form.elements[field.key] || (identityName && form.elements[identityName]) || form.elements[`custom_${field.id}`]
    if (!input) continue
    values[field.key] = field.field_type === 'checkbox' ? input.checked : input.value
  }
  return values
}

export function renderCustomerFormField(field, name = field.key) {
  const normalized = normalizeCustomerFormField(field)
  const required = normalized.is_required ? ' required' : ''
  const label = `${escapeHtml(normalized.field_label)}${normalized.is_required ? ' *' : ''}`
  const safeName = escapeHtml(name)
  const safeId = escapeHtml(`customer-field-${name}`)
  const placeholder = normalized.placeholder ? ` placeholder="${escapeHtml(normalized.placeholder)}"` : ''
  const safeValue = escapeHtml(normalized.value)
  if (normalized.field_type === 'textarea') return `<label for="${safeId}">${label}<textarea id="${safeId}" name="${safeName}" maxlength="2000"${placeholder}${required}>${safeValue}</textarea></label>`
  if (normalized.field_type === 'dropdown') return `<label for="${safeId}">${label}<select id="${safeId}" name="${safeName}"${required}><option value="">Select</option>${normalized.options.map(value => `<option value="${escapeHtml(value)}"${String(normalized.value) === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>`
  if (normalized.field_type === 'checkbox') return `<label class="check-label" for="${safeId}"><input id="${safeId}" name="${safeName}" type="checkbox"${normalized.value === true ? ' checked' : ''}${required}> ${label}</label>`
  const inputType = ['email', 'number', 'date', 'phone'].includes(normalized.field_type) ? (normalized.field_type === 'phone' ? 'tel' : normalized.field_type) : 'text'
  return `<label for="${safeId}">${label}<input id="${safeId}" name="${safeName}" type="${inputType}" value="${safeValue}" maxlength="500"${placeholder}${required}></label>`
}

function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character])) }

function isValidIsoDate(value) {
  const text = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [year, month, day] = text.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
