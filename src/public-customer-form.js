import { supabase } from './supabaseclient.js'
import { formValues, normalizeCustomerForm, serializeCustomerFormAnswers, validateCustomerForm, renderCustomerFormField } from './customer-form-contract.js'
import { resolveReservationsConfiguration } from './reservation-configuration.js'
import { loadPublicReservationsConfiguration } from './reservation-settings-access.js'
import { augmentCustomerFormRpcArgs } from './customer-form-rpc-contract.js'

const route = window.location.pathname.split('/').filter(Boolean)
const businessSlug = route[0]?.toLowerCase() === 'book' ? route[1] : null

if (businessSlug) installCustomerForm().catch(showCustomerFormError)

function showCustomerFormError(error) {
  const app = document.querySelector('#app')
  if (!app) return
  const message = document.createElement('p')
  message.className = 'booking-error'
  message.setAttribute('role', 'alert')
  message.textContent = error?.message || 'Customer Form could not be loaded.'
  app.prepend(message)
}

async function installCustomerForm() {
  const [{ data: fields = [], error }, { data: businesses = [], error: businessError }] = await Promise.all([
    supabase.rpc('get_public_booking_custom_fields', { p_business_slug: businessSlug }),
    supabase.rpc('get_public_booking_business', { p_business_slug: businessSlug }),
  ])
  if (error) throw new Error(`Customer Form could not be loaded: ${error.message}`)
  if (businessError) throw new Error(`Booking business could not be loaded: ${businessError.message}`)

  const business = businesses?.[0]
  if (!business?.id) throw new Error('Booking business could not be loaded.')
  const settings = await loadPublicReservationsConfiguration(supabase, businessSlug)
  const normalized = normalizeCustomerForm(fields, { activeOnly: true })
  const configuration = resolveReservationsConfiguration({ templateKey: settings?.template_key, businessType: business?.business_type, terminology: settings?.terminology, capabilities: settings?.capabilities })
  const isRestaurantBusiness = configuration.templateKey === 'restaurant'
  const system = Object.fromEntries(normalized.filter(f => f.system_key).flatMap(f => [[f.system_key, f], [f.system_key === 'name' ? 'customer_name' : f.system_key === 'phone' ? 'customer_phone' : f.system_key === 'email' ? 'customer_email' : f.system_key, f]]))
  const custom = normalized.filter(f => !f.system_key)

  const originalRpc = supabase.rpc.bind(supabase)
  supabase.rpc = (fn, args = {}, options) => {
    if (['create_public_restaurant_reservation', 'create_public_booking', 'create_public_session_booking'].includes(fn)) {
      const form = document.querySelector('#publicBookingForm')
      if (form) {
        const values = formValues(form, normalized)
        const validation = validateCustomerForm(normalized, values)
        if (validation) return { data: null, error: new Error(validation) }
        const customData = serializeCustomerFormAnswers(normalized, values)
        const raw = new FormData(form)
        args = augmentCustomerFormRpcArgs(fn, args, {
          name: system.customer_name ? raw.get('name') || raw.get('customer_name') || null : undefined,
          email: system.customer_email ? raw.get('email') || raw.get('customer_email') || null : undefined,
          phone: system.customer_phone ? raw.get('phone') || raw.get('customer_phone') || null : undefined,
        }, customData)
      }
    }
    return originalRpc(fn, args, options)
  }

  function apply() {
    const form = document.querySelector('#publicBookingForm')
    if (!form || form.dataset.customerFormApplied === '1') return
    form.dataset.customerFormApplied = '1'

    if (!isRestaurantBusiness) {
      const quantity = form.elements?.quantity
      const quantityLabel = quantity?.closest('label')
      if (quantityLabel) {
        const hiddenQuantity = document.createElement('input')
        hiddenQuantity.type = 'hidden'
        hiddenQuantity.name = 'quantity'
        hiddenQuantity.value = '1'
        quantityLabel.replaceWith(hiddenQuantity)
      }
      const notes = form.elements?.notes
      notes?.closest('label')?.remove()
    }

    const name = form.querySelector('input[name="name"]')
    const phone = form.querySelector('input[name="phone"]')
    const email = form.querySelector('input[name="email"]')
    if (name && system.customer_name) {
      name.required = Boolean(system.customer_name.is_required)
      name.closest('label').firstChild.textContent = system.customer_name.field_label
    }
    if (phone && system.customer_phone) {
      phone.required = Boolean(system.customer_phone.is_required)
      phone.closest('label').firstChild.textContent = system.customer_phone.field_label
    }
    if (email && system.customer_email) {
      email.required = Boolean(system.customer_email.is_required)
      email.closest('label').firstChild.textContent = system.customer_email.field_label
    } else if (system.customer_email) {
      const grid = form.querySelector('.form-grid')
      if (grid) grid.insertAdjacentHTML('beforeend', renderCustomerFormField(system.customer_email, 'customer_email'))
    }

    if (custom.length) {
      const anchor = form.querySelector('button.booking-confirm')
      const wrapper = document.createElement('div')
      wrapper.className = 'customer-form-fields'
      wrapper.innerHTML = custom.map(field => renderCustomerFormField(field, `custom_${field.id}`)).join('')
      anchor?.insertAdjacentElement('beforebegin', wrapper)
    }
  }

  apply()
  const observer = new MutationObserver(apply)
  observer.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true })
}
