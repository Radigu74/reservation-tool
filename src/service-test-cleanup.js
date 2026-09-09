import { supabase } from './supabaseclient.js'

const runtime = window.__TERRAPEAK_RESERVATIONS_RUNTIME__
const businessId = Number(runtime?.businessId)
let pendingTestService = null
let enhancing = false

function message(text, type = 'success') {
  const el = document.getElementById('universalBookingMessage')
  if (!el) return
  el.className = `universal-message ${type}`
  el.textContent = text
}

function testBadge() {
  const badge = document.createElement('small')
  badge.className = 'test-service-badge'
  badge.textContent = 'Test service'
  return badge
}

async function syncPendingTestFlag() {
  if (!pendingTestService) return
  const pending = pendingTestService
  const { data } = await supabase.from('services').select('id,is_test').eq('business_id', businessId).eq('name', pending.name).eq('is_active', true).eq('is_internal', false).maybeSingle()
  if (!data) return
  pendingTestService = null
  if (Boolean(data.is_test) === pending.isTest) return
  const { error } = await supabase.rpc('set_service_test_flag', { p_service_id: data.id, p_is_test: pending.isTest })
  if (error) message(`Service created, but its test flag could not be saved: ${error.message}`, 'error')
}

async function enhanceCreateForm() {
  const form = document.getElementById('serviceForm')
  if (!form || form.dataset.testCleanupReady) return
  form.dataset.testCleanupReady = '1'
  const publishLabel = document.getElementById('servicePublished')?.closest('label')
  const label = document.createElement('label')
  label.className = 'check-label test-service-control'
  label.innerHTML = '<input id="serviceIsTest" type="checkbox"> Test service <small>Use for trial bookings. Test services can later be deleted together with their test history.</small>'
  publishLabel?.before(label)
  form.addEventListener('submit', () => {
    pendingTestService = {
      name: document.getElementById('serviceName')?.value.trim(),
      isTest: Boolean(document.getElementById('serviceIsTest')?.checked)
    }
  }, true)
}

async function enhanceActiveServices() {
  const { data: services, error } = await supabase.from('services').select('id,name,is_test').eq('business_id', businessId).eq('is_active', true).eq('is_internal', false)
  if (error) return
  const byName = new Map((services || []).map(service => [service.name, service]))
  document.querySelectorAll('.entity-card').forEach(card => {
    const edit = card.querySelector('.edit-service')
    if (!edit) return
    const service = byName.get(card.querySelector('h3')?.textContent?.trim())
    if (service?.is_test && !card.querySelector('.test-service-badge')) card.querySelector('h3')?.after(testBadge())
  })
}

async function enhanceEditForm() {
  const form = document.getElementById('editServiceForm')
  if (!form || form.dataset.testCleanupReady) return
  const serviceId = Number(document.querySelector('.edit-service:focus')?.dataset.id || 0)
  const serviceName = form.querySelector('#editServiceName')?.value
  const { data } = await supabase.from('services').select('id,is_test').eq('business_id', businessId).eq('name', serviceName).eq('is_internal', false).maybeSingle()
  if (!data) return
  form.dataset.testCleanupReady = '1'
  const publishLabel = document.getElementById('editServicePublished')?.closest('label')
  const label = document.createElement('label')
  label.className = 'check-label test-service-control'
  label.innerHTML = `<input id="editServiceIsTest" type="checkbox" ${data.is_test ? 'checked' : ''}> Test service <small>Marks this service as disposable test data.</small>`
  publishLabel?.before(label)
  label.querySelector('input').addEventListener('change', async event => {
    const { error } = await supabase.rpc('set_service_test_flag', { p_service_id: serviceId || data.id, p_is_test: event.target.checked })
    if (error) {
      event.target.checked = !event.target.checked
      message(error.message, 'error')
    } else {
      message(event.target.checked ? 'Service marked as a test service.' : 'Test-service flag removed.')
    }
  })
}

async function replaceArchivedDeleteButtons() {
  const buttons = [...document.querySelectorAll('.permanently-delete-service:not([data-cleanup-replaced])')]
  for (const oldButton of buttons) {
    oldButton.dataset.cleanupReplaced = '1'
    const button = oldButton.cloneNode(true)
    button.dataset.cleanupReplaced = '1'
    oldButton.replaceWith(button)
    const serviceId = Number(button.dataset.id)
    const { data: summary, error } = await supabase.rpc('archived_service_delete_summary', { p_service_id: serviceId })
    if (error || !summary) {
      button.disabled = true
      button.title = error?.message || 'Deletion details unavailable'
      continue
    }
    const card = button.closest('.entity-card')
    if (summary.is_test && !card.querySelector('.test-service-badge')) card.querySelector('h3')?.after(testBadge())
    const details = document.createElement('small')
    details.className = 'service-delete-summary'
    details.textContent = summary.has_history
      ? `${summary.bookings} booking(s), ${summary.enrollments} enrolment(s), ${summary.sessions} scheduled session(s)`
      : 'No linked booking, enrolment, or session history'
    card.querySelector('div')?.append(details)
    button.textContent = summary.has_history ? 'Delete service and all related data' : 'Delete permanently'
    button.addEventListener('click', async () => {
      const name = summary.service_name
      const warning = summary.has_history
        ? `Permanently delete ${name} AND all related data? This will delete ${summary.bookings} booking(s), ${summary.enrollments} enrolment(s), and ${summary.sessions} scheduled session(s). This cannot be undone.\n\nType the exact service name to continue:`
        : `Permanently delete ${name}? This cannot be undone.\n\nType the exact service name to continue:`
      if (window.prompt(warning) !== name) return
      button.disabled = true
      const result = summary.has_history
        ? await supabase.rpc('force_delete_archived_service', { p_service_id: serviceId, p_expected_name: name })
        : await supabase.rpc('permanently_delete_archived_service', { p_service_id: serviceId })
      if (result.error) {
        button.disabled = false
        return message(result.error.message, 'error')
      }
      message(summary.has_history ? `${name} and all related data were permanently deleted.` : `${name} was permanently deleted.`)
      card.remove()
    })
  }
}

async function enhance() {
  if (enhancing || !businessId || !window.location.pathname.includes('/dashboard/services')) return
  enhancing = true
  try {
    await syncPendingTestFlag()
    await enhanceCreateForm()
    await enhanceActiveServices()
    await enhanceEditForm()
    await replaceArchivedDeleteButtons()
  } finally {
    enhancing = false
  }
}

const observer = new MutationObserver(() => { void enhance() })
observer.observe(document.documentElement, { childList: true, subtree: true })
void enhance()
