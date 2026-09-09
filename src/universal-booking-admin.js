import { supabase } from './supabaseclient.js'

const runtime = window.__TERRAPEAK_RESERVATIONS_RUNTIME__
if (!runtime || runtime.source !== 'terrapeak-dashboard') {
  throw new Error('Trusted TerraPeak Reservations runtime is required.')
}

const pathParts = window.location.pathname.split('/').filter(Boolean)
const businessSlug = String(runtime.businessSlug || '')
const businessId = Number(runtime.businessId)
const route = pathParts.slice(1).join('/')
const supportedRoutes = new Set([
  'admin/services',
  'dashboard/services',
  'admin/staff',
  'dashboard/staff',
  'admin/schedule',
  'dashboard/schedule',
  'admin/availability',
  'dashboard/availability'
])

if (pathParts[0] !== businessSlug) {
  throw new Error('Reservations route does not match the TerraPeak company context.')
}

if (businessSlug && supportedRoutes.has(route)) {
  startUniversalBookingAdmin()
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function toSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function money(value, currency = 'MYR') {
  if (value === null || value === undefined || value === '') return 'Price not set'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value))
}

function servicePrice(service, value = service.price) {
  const formatted = money(value, service.currency)
  return Number(service.price_session_count || 1) > 1
    ? `${formatted} for ${service.price_session_count} sessions`
    : formatted
}

function dateTimeInZone(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value))
  const part = type => parts.find(item => item.type === type)?.value
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

function showMessage(message, type = 'success') {
  const element = document.getElementById('universalBookingMessage')
  if (!element) return
  element.className = `universal-message ${type}`
  element.textContent = message
}

function renderShell(business, activePage) {
  document.querySelector('#app').innerHTML = `
    <main class="universal-admin">
      <header class="universal-header">
        <div>
          <p class="eyebrow">Reservations</p>
          <h1>${escapeHtml(business.business_name)}</h1>
        </div>
      </header>
      <div id="universalBookingMessage" role="status" aria-live="polite"></div>
      <section id="universalBookingContent" class="universal-content" data-active-page="${activePage}"></section>
    </main>
  `
}

async function loadBusiness() {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', businessId)
    .single()

  if (error) throw error
  if (!data) throw new Error('Reservations business not found.')
  if (data.business_slug !== businessSlug) throw new Error('Reservations business does not match the TerraPeak context.')
  return data
}

function getAccess() {
  return Object.freeze({
    role: runtime.companyRole,
    userId: String(window.__TERRAPEAK_RESERVATIONS_CONTEXT__?.supabaseUserId || ''),
    canManageServices: runtime.hasCapability('manageServices'),
    canManageTeam: runtime.hasCapability('manageTeam'),
    canManageAvailability: runtime.hasCapability('manageAvailability'),
    canViewOwnAvailability: runtime.hasCapability('viewOwnAvailability'),
    canManageBookings: runtime.hasCapability('manageBookings'),
    canViewAnalytics: runtime.hasCapability('viewAnalytics')
  })
}

async function startUniversalBookingAdmin() {
  try {
    const business = await loadBusiness()
    const activePage = route.split('/').at(-1)
    const access = getAccess()
    renderShell(business, activePage)

    if (activePage === 'services') await renderServices(business, access)
    if (activePage === 'staff') await renderStaff(business, access)
    if (activePage === 'schedule') await renderSchedule(business, access)
    if (activePage === 'availability') await renderAvailability(business, access)
  } catch (error) {
    console.error(error)
    document.querySelector('#app').innerHTML = `
      <main class="universal-admin">
        <div class="empty-state">
          <h1>Reservations is not ready</h1>
          <p>${escapeHtml(error.message || 'The booking configuration could not be loaded.')}</p>
        </div>
      </main>
    `
  }
}

async function renderServices(business, access) {
  const [{ data: services, error }, { data: archivedServices, error: archivedError }, { data: staff, error: staffError }, { data: enrollments, error: enrollmentError }, { data: customerFields, error: customerFieldsError }, { data: staffSubjects, error: subjectError }, { data: schedulePatterns, error: patternsError }, { data: weeklyRules, error: rulesError }] = await Promise.all([
    supabase.from('services').select('*').eq('business_id', business.id).eq('is_active', true).eq('is_internal', false).order('name'),
    supabase.from('services').select('id, name, slug, booking_type, updated_at').eq('business_id', business.id).eq('is_active', false).eq('is_internal', false).order('name'),
    supabase.from('staff_members').select('id, display_name, timezone, is_published').eq('business_id', business.id).eq('is_active', true).order('display_name'),
    supabase.from('class_enrollments').select('id, service_id, reference, customer_name, guardian_name, customer_email, customer_phone, quantity, joins_on, status, enquiry_status, contact_requested, school_grade, notes, custom_data, created_at').eq('business_id', business.id).order('created_at', { ascending: false }),
    supabase.from('booking_custom_fields').select('id, field_label').eq('business_id', business.id),
    supabase.from('staff_subjects').select('staff_id, subject').eq('business_id', business.id),
    supabase.from('service_schedule_patterns').select('id, service_id, staff_id, day_of_week, starts_at, ends_at').eq('business_id', business.id).eq('is_active', true).order('day_of_week'),
    supabase.from('availability_rules').select('staff_id, service_id, day_of_week, start_time, end_time, is_active').eq('business_id', business.id).eq('is_active', true)
  ])
  if (error) throw error
  if (archivedError) throw archivedError
  if (staffError) throw staffError
  if (enrollmentError) throw enrollmentError
  if (customerFieldsError) throw customerFieldsError
  if (subjectError) throw subjectError
  if (patternsError) throw patternsError
  if (rulesError) throw rulesError
  const enrolledByService = enrollments.filter(item => ['pending', 'confirmed'].includes(item.status)).reduce((totals, item) => ({ ...totals, [item.service_id]: (totals[item.service_id] || 0) + item.quantity }), {})
  const customerFieldLabels = Object.fromEntries(customerFields.map(field => [String(field.id), field.field_label]))
  const customAnswersMarkup = item => { const snapshots = item.custom_data?._field_labels || {}; return Object.entries(item.custom_data || {}).filter(([fieldId]) => fieldId !== '_field_labels').map(([fieldId, value]) => `<small><strong>${escapeHtml(snapshots[fieldId] || customerFieldLabels[fieldId] || 'Custom field')}:</strong> ${escapeHtml(typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value)}</small>`).join('') }
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const subjects = [...new Set([...staffSubjects.map(item => item.subject), ...services.map(item => item.subject).filter(Boolean)])].sort()
  const staffMap = Object.fromEntries(staff.map(person => [person.id, person]))
  function publicationIssues(service) {
    if (service.enrollment_mode !== 'cohort') return []
    const patterns = schedulePatterns.filter(item => item.service_id === service.id)
    const issues = []
    if (!patterns.length) issues.push('No timetable')
    if (patterns.some(pattern => !staffMap[pattern.staff_id]?.is_published)) issues.push('Teacher profile not published')
    if (patterns.some(pattern => !weeklyRules.some(rule => rule.staff_id === pattern.staff_id && rule.day_of_week === pattern.day_of_week && (!rule.service_id || rule.service_id === service.id) && rule.start_time <= pattern.starts_at && rule.end_time >= pattern.ends_at))) issues.push('Outside weekly availability')
    return issues
  }

  document.getElementById('universalBookingContent').innerHTML = `
    <div class="universal-grid">
      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Offerings</p><h2>Services</h2></div><span>${services.length}</span></div>
        <div class="card-list">
          ${services.length ? services.map(service => `
            <article class="entity-card">
              <div>
                <h3>${escapeHtml(service.name)}</h3>
                <p>${escapeHtml(service.booking_type)} · ${service.duration_minutes} minutes · ${servicePrice(service)}</p>
                <small>${service.scheduling_mode === 'scheduled' ? 'Scheduled sessions' : 'Generated from staff availability'}</small>
                ${service.enrollment_mode === 'cohort' ? `<small>${enrolledByService[service.id] || 0} of ${service.capacity} enrolled · ${Math.max(service.capacity - (enrolledByService[service.id] || 0), 0)} places left</small>` : ''}
                ${publicationIssues(service).length ? `<small class="error">Not ready for customers: ${escapeHtml(publicationIssues(service).join(' · '))}</small>` : service.enrollment_mode === 'cohort' ? '<small>Ready for customers</small>' : ''}
                ${access.canManageServices ? `<div class="entity-links"><button type="button" class="link-button edit-service" data-id="${service.id}">Edit</button>${service.enrollment_mode === 'cohort' ? `<button type="button" class="link-button manage-enquiries" data-id="${service.id}">Manage enquiries</button>` : ''}${service.scheduling_mode === 'scheduled' ? `<a href="/${businessSlug}/dashboard/schedule?customerView=1">Manage timetable</a>` : `<a href="/${businessSlug}/dashboard/availability?customerView=1">Set availability</a>`}<button type="button" class="link-button danger-text remove-service" data-id="${service.id}">Remove</button></div>` : ''}
              </div>
              <span class="status ${service.is_published ? 'published' : ''}">${service.is_published ? 'Published' : 'Draft'}</span>
            </article>
          `).join('') : '<p class="empty-copy">No services have been created yet.</p>'}
        </div>
      </section>
      ${archivedServices.length ? `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">Archive</p><h2>Archived services</h2></div><span>${archivedServices.length}</span></div><p class="empty-copy">Restore a service to edit it. Services that were never used can also be permanently deleted.</p><div class="card-list">${archivedServices.map(service => `<article class="entity-card"><div><h3>${escapeHtml(service.name)}</h3><small>${escapeHtml(service.booking_type)} · Hidden from customers</small></div>${access.canManageServices ? `<div class="entity-links"><button type="button" class="secondary-button restore-service" data-id="${service.id}">Restore as draft</button><button type="button" class="danger-text permanently-delete-service" data-id="${service.id}" data-name="${escapeHtml(service.name)}">Delete permanently</button></div>` : '<span class="status">Archived</span>'}</article>`).join('')}</div></section>` : ''}
      <section id="serviceEditPanel" class="panel" hidden></section>
      <section class="panel">
        <p class="eyebrow">New offering</p><h2>Create a service</h2>
        ${access.canManageServices ? `
          <form id="serviceForm" class="stacked-form">
            <label>Service name<input id="serviceName" required placeholder="Sports massage"></label>
            <label>Description<textarea id="serviceDescription" rows="3"></textarea></label>
            <label id="serviceSubjectLabel" hidden>Subject<input id="serviceSubject" list="serviceSubjectOptions" placeholder="English"><datalist id="serviceSubjectOptions">${subjects.map(subject => `<option value="${escapeHtml(subject)}">`).join('')}</datalist></label>
            <div class="form-row">
              <label>Type<select id="serviceType"><option value="appointment">Appointment</option><option value="class">Class</option><option value="course">Course</option><option value="restaurant">Restaurant</option></select></label>
              <label>Duration<input id="serviceDuration" type="number" min="5" value="60" required></label>
            </div>
            <label>Scheduling method<select id="serviceSchedulingMode"><option value="generated">Generate from staff availability</option><option value="scheduled">Use scheduled sessions</option></select></label>
            <div class="form-row"><label>Slot interval<input id="slotInterval" type="number" min="5" value="30" required></label><label>Capacity<input id="serviceCapacity" type="number" min="1" value="1" required></label></div>
            <div class="form-row"><label>Price<input id="servicePrice" type="number" min="0" step="0.01"></label><label>Currency<input id="serviceCurrency" maxlength="3" value="MYR" required></label></div>
            <div class="form-row"><label>Price covers how many sessions<input id="servicePriceSessions" type="number" min="1" value="1" required></label><label>Package validity (days, optional)<input id="servicePackageValidity" type="number" min="1"></label></div>
            <fieldset id="cohortSetup" class="cohort-setup" hidden>
              <legend>Class timetable and enrolment</legend>
              <div class="form-row"><label>Class starts<input id="cohortStartDate" type="date"></label><label>Schedule length<select id="cohortEndMode"><option value="date">End date</option><option value="weeks">Number of weeks</option><option value="open">Open-ended</option></select></label></div>
              <div class="form-row" id="cohortEndDateRow"><label>Class ends<input id="cohortEndDate" type="date"></label></div>
              <div class="form-row" id="cohortWeeksRow" hidden><label>Number of weeks<input id="cohortWeeks" type="number" min="1" max="260" value="12"></label></div>
              <p class="form-help">Each enabled day becomes an individual class occurrence. Teachers are checked for timetable conflicts before anything is saved.</p>
              <div class="class-day-grid">${dayNames.map((day, index) => `<div class="class-day-row"><label class="check-label"><input class="class-day-enabled" type="checkbox" data-day="${index}"> ${day}</label><input class="class-day-start" data-day="${index}" type="time" value="09:00" aria-label="${day} starts"><input class="class-day-end" data-day="${index}" type="time" value="10:00" aria-label="${day} ends"><select class="class-day-staff" data-day="${index}" aria-label="${day} teacher"><option value="">Choose a subject first</option></select></div>`).join('')}</div>
            </fieldset>
            <label class="check-label"><input id="servicePublished" type="checkbox"> Publish on the customer page</label>
            <button type="submit">Create service</button>
          </form>
        ` : '<p>This TerraPeak role has read-only access to services.</p>'}
      </section>
    </div>
  `

  document.querySelectorAll('.restore-service').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true
    const { error } = await supabase.rpc('restore_archived_service', { p_service_id: Number(button.dataset.id) })
    if (error) { button.disabled = false; return showMessage(error.message, 'error') }
    showMessage('Service restored as a draft. You can now edit and publish it.')
    await renderServices(business, access)
  }))
  document.querySelectorAll('.permanently-delete-service').forEach(button => button.addEventListener('click', async () => {
    const serviceName = button.dataset.name
    if (window.prompt(`Permanently delete ${serviceName}? This cannot be undone. Type DELETE to continue.`) !== 'DELETE') return
    button.disabled = true
    const { error } = await supabase.rpc('permanently_delete_archived_service', { p_service_id: Number(button.dataset.id) })
    if (error) { button.disabled = false; return showMessage(error.message, 'error') }
    showMessage(`${serviceName} was permanently deleted.`)
    await renderServices(business, access)
  }))

  document.querySelectorAll('.manage-enquiries').forEach(button => button.addEventListener('click', () => {
    const service = services.find(item => item.id === Number(button.dataset.id))
    const items = enrollments.filter(item => item.service_id === service.id)
    const panel = document.getElementById('serviceEditPanel')
    panel.hidden = false
    panel.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Enrolment enquiries</p><h2>${escapeHtml(service.name)}</h2></div><button type="button" class="secondary-button close-enquiries">Close</button></div><div class="card-list">${items.length ? items.map(item => `<article class="entity-card"><div><h3>${escapeHtml(item.customer_name)}</h3><p>Guardian: ${escapeHtml(item.guardian_name || 'Not provided')} · ${escapeHtml(item.customer_phone)}${item.customer_email ? ` · ${escapeHtml(item.customer_email)}` : ''}</p><small>${escapeHtml(item.reference)} · Preferred start ${item.joins_on}${item.school_grade ? ` · ${escapeHtml(item.school_grade)}` : ''}${item.contact_requested ? ' · Contact requested' : ''}</small>${customAnswersMarkup(item)}${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}</div><label>Status<select class="enquiry-status" data-id="${item.id}">${['new','contacted','accepted','declined','withdrawn'].map(status => `<option value="${status}" ${status === item.enquiry_status ? 'selected' : ''} ${status === 'withdrawn' ? 'disabled' : ''}>${status}</option>`).join('')}</select></label></article>`).join('') : '<p>No enquiries have been received.</p>'}</div>`
    panel.querySelector('.close-enquiries').onclick = () => { panel.hidden = true; panel.innerHTML = '' }
    panel.querySelectorAll('.enquiry-status').forEach(select => select.addEventListener('change', async () => {
      const { error } = await supabase.rpc('set_class_enquiry_status', { p_enquiry_id: select.dataset.id, p_enquiry_status: select.value })
      if (error) return showMessage(error.message, 'error')
      showMessage('Enquiry status updated.'); await renderServices(business, access)
    }))
  }))

  const serviceType = document.getElementById('serviceType')
  const schedulingMode = document.getElementById('serviceSchedulingMode')
  const cohortSetup = document.getElementById('cohortSetup')
  const serviceDraftKey = `terrapeak-service-form-${business.id}`
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(serviceDraftKey) || '{}')
    if (saved.type) serviceType.value = saved.type
    if (saved.schedulingMode) schedulingMode.value = saved.schedulingMode
    if (saved.subject) document.getElementById('serviceSubject').value = saved.subject
  } catch {}
  function refreshCohortSetup() {
    const isClass = ['class', 'course'].includes(serviceType.value)
    if (isClass) schedulingMode.value = 'scheduled'
    cohortSetup.hidden = !(isClass && schedulingMode.value === 'scheduled')
    document.getElementById('serviceSubjectLabel').hidden = cohortSetup.hidden
  }
  function refreshQualifiedTeachers() {
    const subject = document.getElementById('serviceSubject').value.trim().toLowerCase()
    const eligibleIds = new Set(staffSubjects.filter(item => item.subject.trim().toLowerCase() === subject).map(item => item.staff_id))
    const options = staff.filter(person => eligibleIds.has(person.id)).map(person => `<option value="${person.id}">${escapeHtml(person.display_name)} (${escapeHtml(person.timezone)})</option>`).join('')
    document.querySelectorAll('.class-day-staff').forEach(select => {
      const previous = select.value
      select.innerHTML = `<option value="">${subject ? 'Select qualified teacher' : 'Choose a subject first'}</option>${options}`
      if ([...select.options].some(option => option.value === previous)) select.value = previous
    })
  }
  serviceType?.addEventListener('change', refreshCohortSetup)
  schedulingMode?.addEventListener('change', refreshCohortSetup)
  refreshCohortSetup()
  refreshQualifiedTeachers()
  document.getElementById('serviceSubject')?.addEventListener('input', refreshQualifiedTeachers)
  document.getElementById('cohortEndMode')?.addEventListener('change', event => {
    document.getElementById('cohortEndDateRow').hidden = event.target.value !== 'date'
    document.getElementById('cohortWeeksRow').hidden = event.target.value !== 'weeks'
  })

  document.getElementById('serviceForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const name = document.getElementById('serviceName').value.trim()
    const payload = {
      business_id: business.id,
      name,
      slug: toSlug(name),
      description: document.getElementById('serviceDescription').value.trim() || null,
      booking_type: document.getElementById('serviceType').value,
      scheduling_mode: document.getElementById('serviceSchedulingMode').value,
      duration_minutes: Number(document.getElementById('serviceDuration').value),
      slot_interval_minutes: Number(document.getElementById('slotInterval').value),
      capacity: Number(document.getElementById('serviceCapacity').value),
      price: document.getElementById('servicePrice').value || null,
      price_session_count: Number(document.getElementById('servicePriceSessions').value),
      package_validity_days: document.getElementById('servicePackageValidity').value || null,
      currency: document.getElementById('serviceCurrency').value.toUpperCase(),
      is_published: document.getElementById('servicePublished').checked
    }
    let insertError
    if (!cohortSetup.hidden) {
      const subject = document.getElementById('serviceSubject').value.trim()
      if (!subject) return showMessage('Enter a subject before selecting teachers.', 'error')
      const schedule = [...document.querySelectorAll('.class-day-enabled:checked')].map(input => {
        const day = input.dataset.day
        return {
          day_of_week: Number(day),
          starts_at: document.querySelector(`.class-day-start[data-day="${day}"]`).value,
          ends_at: document.querySelector(`.class-day-end[data-day="${day}"]`).value,
          staff_id: Number(document.querySelector(`.class-day-staff[data-day="${day}"]`).value)
        }
      })
      const invalid = schedule.find(item => !item.staff_id || !item.starts_at || !item.ends_at || item.ends_at <= item.starts_at)
      if (!schedule.length) return showMessage('Select at least one class day.', 'error')
      if (invalid) return showMessage(`${dayNames[invalid.day_of_week]} needs a teacher and a valid start/end time.`, 'error')
      const endMode = document.getElementById('cohortEndMode').value
      const { error } = await supabase.rpc('create_class_service_setup_v2', {
        p_business_id: business.id, p_name: name, p_slug: payload.slug,
        p_subject: subject,
        p_description: payload.description, p_booking_type: payload.booking_type,
        p_capacity: payload.capacity, p_price: payload.price, p_currency: payload.currency,
        p_price_session_count: payload.price_session_count, p_package_validity_days: payload.package_validity_days,
        p_start_date: document.getElementById('cohortStartDate').value || null,
        p_end_date: endMode === 'date' ? document.getElementById('cohortEndDate').value || null : null,
        p_number_of_weeks: endMode === 'weeks' ? Number(document.getElementById('cohortWeeks').value) : null,
        p_open_ended: endMode === 'open', p_is_published: payload.is_published, p_schedule: schedule
      })
      insertError = error
    } else {
      const result = await supabase.from('services').insert(payload)
      insertError = result.error
    }
    if (insertError) return showMessage(insertError.code === '23505' || insertError.message.includes('already exists') || insertError.message.includes('duplicate key') ? `A service named "${name}" already exists. Edit the existing service or choose another name.` : insertError.message, 'error')
    window.sessionStorage.setItem(serviceDraftKey, JSON.stringify({ type: payload.booking_type, schedulingMode: payload.scheduling_mode, subject: document.getElementById('serviceSubject').value.trim() }))
    showMessage(`${name} and its complete timetable were created.`)
    await renderServices(business, access)
  })

  document.querySelectorAll('.edit-service').forEach(button => button.addEventListener('click', () => {
    const service = services.find(item => item.id === Number(button.dataset.id))
    const isCohort = service.enrollment_mode === 'cohort'
    const patterns = schedulePatterns.filter(item => item.service_id === service.id)
    const panel = document.getElementById('serviceEditPanel')
    panel.hidden = false
    const endMode = service.schedule_open_ended ? 'open' : 'date'
    panel.innerHTML = `<p class="eyebrow">Edit offering</p><h2>${escapeHtml(service.name)}</h2><form id="editServiceForm" class="stacked-form"><label>Name<input id="editServiceName" value="${escapeHtml(service.name)}" required></label><label>Subject<input id="editServiceSubject" list="editServiceSubjectOptions" value="${escapeHtml(service.subject || '')}" ${isCohort ? 'required' : ''}><datalist id="editServiceSubjectOptions">${subjects.map(subject => `<option value="${escapeHtml(subject)}">`).join('')}</datalist></label><label>Description<textarea id="editServiceDescription" rows="3">${escapeHtml(service.description || '')}</textarea></label><div class="form-row"><label>Capacity<input id="editServiceCapacity" type="number" min="1" value="${service.capacity}" required></label><label>Price<input id="editServicePrice" type="number" min="0" step="0.01" value="${service.price ?? ''}"></label></div><div class="form-row"><label>Price covers sessions<input id="editServicePriceSessions" type="number" min="1" value="${service.price_session_count || 1}"></label><label>Package validity days<input id="editServiceValidity" type="number" min="1" value="${service.package_validity_days || ''}"></label></div>${isCohort ? `<fieldset class="cohort-setup"><legend>Class timetable and enrolment</legend><div class="form-row"><label>Class starts<input id="editCohortStartDate" type="date" value="${service.cohort_start_date || ''}" required></label><label>Schedule length<select id="editCohortEndMode"><option value="date" ${endMode === 'date' ? 'selected' : ''}>End date</option><option value="weeks">Number of weeks</option><option value="open" ${endMode === 'open' ? 'selected' : ''}>Open-ended</option></select></label></div><div class="form-row" id="editCohortEndDateRow" ${endMode === 'date' ? '' : 'hidden'}><label>Class ends<input id="editCohortEndDate" type="date" value="${service.cohort_end_date || ''}"></label></div><div class="form-row" id="editCohortWeeksRow" hidden><label>Number of weeks<input id="editCohortWeeks" type="number" min="1" max="260" value="12"></label></div><label>Apply timetable changes from<input id="editScheduleApplyFrom" type="date" value="${new Date().toISOString().slice(0, 10)}" required><small>Past classes remain unchanged. Future booked sessions must be rescheduled first.</small></label><div class="class-day-grid">${dayNames.map((day, index) => { const pattern = patterns.find(item => item.day_of_week === index); return `<div class="class-day-row"><label class="check-label"><input class="edit-class-day-enabled" type="checkbox" data-day="${index}" ${pattern ? 'checked' : ''}> ${day}</label><input class="edit-class-day-start" data-day="${index}" type="time" value="${(pattern?.starts_at || '09:00').slice(0, 5)}" aria-label="${day} starts"><input class="edit-class-day-end" data-day="${index}" type="time" value="${(pattern?.ends_at || '10:00').slice(0, 5)}" aria-label="${day} ends"><select class="edit-class-day-staff" data-day="${index}" aria-label="${day} teacher" data-selected="${pattern?.staff_id || ''}"><option value="">Select qualified teacher</option></select></div>` }).join('')}</div></fieldset>` : ''}<label class="check-label"><input id="editServicePublished" type="checkbox" ${service.is_published ? 'checked' : ''}> Published</label><div class="form-actions"><button id="editServiceSaveButton" type="submit">Save changes</button><button type="button" class="secondary-button" id="closeServiceEdit">Cancel</button></div></form>`
    function refreshEditTeachers() {
      const subject = document.getElementById('editServiceSubject').value.trim().toLowerCase()
      const eligibleIds = new Set(staffSubjects.filter(item => item.subject.trim().toLowerCase() === subject).map(item => item.staff_id))
      document.querySelectorAll('.edit-class-day-staff').forEach(select => {
        const selected = select.value || select.dataset.selected
        select.innerHTML = `<option value="">${subject ? 'Select qualified teacher' : 'Choose a subject first'}</option>${staff.filter(person => eligibleIds.has(person.id)).map(person => `<option value="${person.id}">${escapeHtml(person.display_name)} (${escapeHtml(person.timezone)})</option>`).join('')}`
        if ([...select.options].some(option => option.value === String(selected))) select.value = String(selected)
        select.dataset.selected = ''
      })
    }
    refreshEditTeachers()
    document.getElementById('editServiceSubject').addEventListener('input', refreshEditTeachers)
    document.getElementById('editCohortEndMode')?.addEventListener('change', event => {
      document.getElementById('editCohortEndDateRow').hidden = event.target.value !== 'date'
      document.getElementById('editCohortWeeksRow').hidden = event.target.value !== 'weeks'
    })
    document.getElementById('closeServiceEdit').onclick = () => { panel.hidden = true }
    document.getElementById('editServiceForm').onsubmit = async event => {
      event.preventDefault()
      const newName = document.getElementById('editServiceName').value.trim()
      const newCapacity = Number(document.getElementById('editServiceCapacity').value)
      if (newCapacity < (enrolledByService[service.id] || 0)) return showMessage(`Capacity cannot be lower than the ${enrolledByService[service.id]} current enrolments.`, 'error')
      let error
      if (isCohort) {
        const schedule = [...document.querySelectorAll('.edit-class-day-enabled:checked')].map(input => {
          const day = input.dataset.day
          return { day_of_week: Number(day), starts_at: document.querySelector(`.edit-class-day-start[data-day="${day}"]`).value, ends_at: document.querySelector(`.edit-class-day-end[data-day="${day}"]`).value, staff_id: Number(document.querySelector(`.edit-class-day-staff[data-day="${day}"]`).value) }
        })
        if (!schedule.length || schedule.some(item => !item.staff_id || !item.starts_at || !item.ends_at || item.ends_at <= item.starts_at)) return showMessage('Select at least one day with a qualified teacher and a valid start/end time.', 'error')
        const mode = document.getElementById('editCohortEndMode').value
        const result = await supabase.rpc('update_class_service_setup_v2', { p_service_id: service.id, p_name: newName, p_slug: toSlug(newName), p_subject: document.getElementById('editServiceSubject').value.trim(), p_description: document.getElementById('editServiceDescription').value.trim() || null, p_capacity: newCapacity, p_price: document.getElementById('editServicePrice').value || null, p_price_session_count: Number(document.getElementById('editServicePriceSessions').value), p_package_validity_days: document.getElementById('editServiceValidity').value || null, p_start_date: document.getElementById('editCohortStartDate').value, p_end_date: mode === 'date' ? document.getElementById('editCohortEndDate').value || null : null, p_number_of_weeks: mode === 'weeks' ? Number(document.getElementById('editCohortWeeks').value) : null, p_open_ended: mode === 'open', p_apply_from: document.getElementById('editScheduleApplyFrom').value, p_is_published: document.getElementById('editServicePublished').checked, p_schedule: schedule })
        error = result.error
      } else {
        const result = await supabase.from('services').update({ name: newName, slug: toSlug(newName), subject: document.getElementById('editServiceSubject').value.trim() || null, description: document.getElementById('editServiceDescription').value.trim() || null, capacity: newCapacity, price: document.getElementById('editServicePrice').value || null, price_session_count: Number(document.getElementById('editServicePriceSessions').value), package_validity_days: document.getElementById('editServiceValidity').value || null, is_published: document.getElementById('editServicePublished').checked }).eq('id', service.id)
        error = result.error
      }
      if (error) return showMessage(error.code === '23505' ? `A service named "${newName}" already exists. Edit the existing service or choose another name.` : error.message, 'error')
      showMessage(`${newName} and its future timetable were updated.`); await renderServices(business, access)
    }
  }))

  document.querySelectorAll('.remove-service').forEach(button => button.addEventListener('click', async () => {
    const service = services.find(item => item.id === Number(button.dataset.id))
    if (!window.confirm(`Remove ${service.name}? Used services are archived so their history remains available.`)) return
    const { data, error } = await supabase.rpc('remove_or_archive_service', { p_service_id: service.id })
    if (error) return showMessage(error.message, 'error')
    showMessage(`${service.name} was ${data}.`); await renderServices(business, access)
  }))
}

async function renderStaff(business, access) {
  const [{ data: staff, error: staffError }, { data: services, error: servicesError }, { data: assignments, error: assignmentsError }, { data: staffSubjects, error: subjectError }] = await Promise.all([
    supabase.from('staff_members').select('*').eq('business_id', business.id).order('display_name'),
    supabase.from('services').select('id, name').eq('business_id', business.id).eq('is_active', true).eq('is_internal', false).order('name'),
    supabase.from('staff_services').select('staff_id, service_id, custom_duration_minutes, custom_price, services(name)').eq('is_active', true),
    supabase.from('staff_subjects').select('staff_id, subject').eq('business_id', business.id).order('subject')
  ])
  if (staffError) throw staffError
  if (servicesError) throw servicesError
  if (assignmentsError) throw assignmentsError
  if (subjectError) throw subjectError

  const activeServiceIds = new Set(services.map(service => service.id))
  const assignmentsByStaff = assignments.filter(assignment => activeServiceIds.has(assignment.service_id)).reduce((grouped, assignment) => {
    grouped[assignment.staff_id] ||= []
    grouped[assignment.staff_id].push(assignment)
    return grouped
  }, {})

  document.getElementById('universalBookingContent').innerHTML = `
    <div class="universal-grid">
      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">People</p><h2>Team & Resources</h2></div><span>${staff.length}</span></div>
        <div class="card-list">
          ${staff.length ? staff.map(person => `
            <article class="entity-card staff-card"><div><h3>${escapeHtml(person.display_name)}</h3><p>${(assignmentsByStaff[person.id] || []).map(item => escapeHtml(item.services?.name)).join(', ') || 'No services assigned'}</p><small>Qualified subjects: ${staffSubjects.filter(item => item.staff_id === person.id).map(item => escapeHtml(item.subject)).join(', ') || 'None'}</small>${access.canManageTeam ? `<form class="staff-login-form" data-id="${person.id}"><label>TerraPeak login email<input type="email" value="${escapeHtml(person.login_email || '')}" placeholder="teacher@example.com"></label><button type="submit" class="secondary-button">Save account link</button></form>` : `<small>${person.user_id ? 'TerraPeak account linked' : 'No TerraPeak account linked'}</small>`}</div><div><span class="status ${person.is_published ? 'published' : ''}">${person.is_published ? 'Published' : 'Draft'}</span><small>${person.user_id ? 'Account linked' : person.login_email ? 'Link pending first sign-in' : 'Not linked'}</small>${access.canManageTeam ? `<button type="button" class="secondary-button toggle-staff-published" data-id="${person.id}" data-published="${person.is_published}">${person.is_published ? 'Unpublish profile' : 'Publish profile'}</button>` : ''}</div></article>
          `).join('') : '<p class="empty-copy">No staff members have been created yet.</p>'}
        </div>
      </section>
      <div class="panel-stack">
        <section class="panel"><p class="eyebrow">New team member</p><h2>Create staff</h2>
          ${access.canManageTeam ? `
            <form id="staffForm" class="stacked-form">
              <label>Display name<input id="staffName" required placeholder="Jane Tan"></label>
              <label>Biography<textarea id="staffBio" rows="3"></textarea></label>
              <label>Timezone<input id="staffTimezone" value="Asia/Kuala_Lumpur" required></label>
              <label>TerraPeak login email<input id="staffLoginEmail" type="email" placeholder="teacher@example.com"><small>The profile links automatically when this team member next opens Reservations.</small></label>
              <label class="check-label"><input id="staffPublished" type="checkbox"> Publish staff profile</label>
              <button type="submit">Create staff member</button>
            </form>` : '<p>This TerraPeak role has read-only team access.</p>'}
        </section>
        <section class="panel"><p class="eyebrow">Capabilities</p><h2>Assign subjects or services</h2>
          ${access.canManageTeam && staff.length ? `
            <form id="assignmentForm" class="stacked-form">
              <label>Staff<select id="assignmentStaff">${staff.map(person => `<option value="${person.id}">${escapeHtml(person.display_name)}</option>`).join('')}</select></label>
              <label>Qualified subjects<input id="assignmentSubjects" placeholder="English, Mathematics"><small>Separate multiple subjects with commas. These control which teachers appear while creating a class.</small></label>
              ${services.length ? `<fieldset class="service-checkboxes"><legend>Active services this person can provide</legend>${services.map(service => `<label class="check-label"><input class="assignment-service" type="checkbox" value="${service.id}"> ${escapeHtml(service.name)}</label>`).join('')}</fieldset>` : '<p class="empty-copy">No active services are available to assign. Teaching subjects can still be saved.</p>'}
              <button type="submit">Save eligibility and assignments</button>
            </form>` : access.canManageTeam ? '<p>Create a staff member before assigning teaching subjects.</p>' : '<p>Teaching eligibility and service assignments require team-management permission.</p>'}
        </section>
      </div>
    </div>
  `

  document.getElementById('staffForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const displayName = document.getElementById('staffName').value.trim()
    const { error } = await supabase.from('staff_members').insert({
      business_id: business.id,
      display_name: displayName,
      slug: toSlug(displayName),
      bio: document.getElementById('staffBio').value.trim() || null,
      timezone: document.getElementById('staffTimezone').value.trim(),
      login_email: document.getElementById('staffLoginEmail').value.trim().toLowerCase() || null,
      is_published: document.getElementById('staffPublished').checked
    })
    if (error) return showMessage(error.message, 'error')
    showMessage(`${displayName} was added.`)
    await renderStaff(business, access)
  })

  document.querySelectorAll('.staff-login-form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault()
    const { error } = await supabase.rpc('set_staff_login_email', { p_staff_id: Number(form.dataset.id), p_login_email: form.querySelector('input').value })
    if (error) return showMessage(error.message, 'error')
    showMessage('Staff account link saved. It will activate at the next Reservations sign-in.')
    await renderStaff(business, access)
  }))

  document.querySelectorAll('.toggle-staff-published').forEach(button => button.addEventListener('click', async () => {
    const publish = button.dataset.published !== 'true'
    button.disabled = true
    const { error } = await supabase.from('staff_members').update({ is_published: publish }).eq('id', Number(button.dataset.id)).eq('business_id', business.id)
    if (error) { button.disabled = false; return showMessage(error.message, 'error') }
    showMessage(`Staff profile ${publish ? 'published' : 'unpublished'}.`)
    await renderStaff(business, access)
  }))

  const assignmentStaff = document.getElementById('assignmentStaff')
  function loadStaffAssignments() {
    if (!assignmentStaff) return
    const staffId = Number(assignmentStaff.value)
    const selected = new Set(assignments.filter(item => item.staff_id === staffId).map(item => item.service_id))
    document.querySelectorAll('.assignment-service').forEach(input => { input.checked = selected.has(Number(input.value)) })
    document.getElementById('assignmentSubjects').value = staffSubjects.filter(item => item.staff_id === staffId).map(item => item.subject).join(', ')
  }
  assignmentStaff?.addEventListener('change', loadStaffAssignments)
  loadStaffAssignments()

  document.getElementById('assignmentForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const staffId = Number(assignmentStaff.value)
    const subjects = document.getElementById('assignmentSubjects').value.split(',').map(item => item.trim()).filter(Boolean)
    const selectedIds = new Set([...document.querySelectorAll('.assignment-service:checked')].map(input => Number(input.value)))
    const payload = services.map(service => {
      const existing = assignments.find(item => item.staff_id === staffId && item.service_id === service.id)
      return {
        staff_id: staffId,
        service_id: service.id,
        custom_duration_minutes: existing?.custom_duration_minutes ?? null,
        custom_price: existing?.custom_price ?? null,
        is_active: selectedIds.has(service.id)
      }
    })
    const [{ error }, { error: subjectSaveError }] = await Promise.all([
      payload.length ? supabase.from('staff_services').upsert(payload) : Promise.resolve({ error: null }),
      supabase.rpc('set_staff_subjects', { p_staff_id: staffId, p_subjects: subjects })
    ])
    if (error || subjectSaveError) return showMessage((error || subjectSaveError).message, 'error')
    showMessage('Staff subjects and service assignments saved.')
    await renderStaff(business, access)
  })
}

async function renderSchedule(business, access) {
  const canManage = access.canManageAvailability
  const [{ data: services, error: servicesError }, { data: staff, error: staffError }, { data: assignments, error: assignmentsError }, { data: patterns, error: patternError }, { data: staffSubjects, error: subjectError }] = await Promise.all([
    supabase.from('services').select('id, name, subject, duration_minutes, capacity, scheduling_mode').eq('business_id', business.id).eq('is_active', true).eq('is_internal', false).eq('scheduling_mode', 'scheduled').order('name'),
    supabase.from('staff_members').select('id, display_name, user_id, timezone').eq('business_id', business.id).eq('is_active', true).order('display_name'),
    supabase.from('staff_services').select('staff_id, service_id').eq('is_active', true),
    supabase.from('service_schedule_patterns').select('id, service_id, staff_id, day_of_week, starts_at, ends_at').eq('business_id', business.id).eq('is_active', true),
    supabase.from('staff_subjects').select('staff_id, subject').eq('business_id', business.id)
  ])
  if (servicesError) throw servicesError
  if (staffError) throw staffError
  if (assignmentsError) throw assignmentsError
  if (patternError) throw patternError
  if (subjectError) throw subjectError

  const ownStaffIds = new Set(staff.filter(person => person.user_id === access.userId).map(person => person.id))
  let sessionQuery = supabase.from('scheduled_sessions').select('id, service_id, staff_id, series_id, starts_at, ends_at, capacity, status, is_published, notes').eq('business_id', business.id).gte('ends_at', new Date().toISOString()).order('starts_at').limit(100)
  if (!canManage && ownStaffIds.size === 1) sessionQuery = sessionQuery.eq('staff_id', [...ownStaffIds][0])
  const { data: sessions, error: sessionsError } = await sessionQuery
  if (sessionsError) throw sessionsError

  let registrations = []
  if (access.canManageBookings && sessions.length) {
    const { data, error } = await supabase.from('bookings').select('id, scheduled_session_id, customer_name, customer_email, customer_phone, quantity, status, reference, notes, created_at').in('scheduled_session_id', sessions.map(session => session.id)).order('created_at')
    if (error) throw error
    registrations = data
  }

  const serviceMap = Object.fromEntries(services.map(service => [service.id, service]))
  const staffMap = Object.fromEntries(staff.map(person => [person.id, person]))
  const scheduled = sessions.filter(session => session.status === 'scheduled')
  const patternIds = new Set(patterns.map(pattern => pattern.id))
  const registrationsBySession = registrations.reduce((grouped, booking) => {
    grouped[booking.scheduled_session_id] ||= []
    grouped[booking.scheduled_session_id].push(booking)
    return grouped
  }, {})

  document.getElementById('universalBookingContent').innerHTML = `
    <div class="schedule-layout">
      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Calendar</p><h2>Upcoming sessions</h2></div><span>${scheduled.length}</span></div>
        ${canManage && scheduled.length ? `<div class="bulk-session-toolbar"><label class="check-label"><input id="selectAllSessions" type="checkbox"> Select all shown</label><button type="button" class="danger-text" id="cancelSelectedSessions" disabled>Cancel selected</button><span id="selectedSessionCount">0 selected</span></div>` : ''}
        <div class="calendar-summary">
          ${scheduled.length ? scheduled.map(session => `
            <article class="calendar-item session-item">${canManage ? `<input class="session-select" type="checkbox" value="${session.id}" aria-label="Select ${escapeHtml(serviceMap[session.service_id]?.name || 'session')}">` : ''}<div><strong>${escapeHtml(serviceMap[session.service_id]?.name || 'Session')}</strong><span>${new Date(session.starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><small>${escapeHtml(staffMap[session.staff_id]?.display_name || 'Unassigned')} · Capacity ${session.capacity}</small></div>${canManage ? `<div class="session-actions"><button type="button" class="secondary-button view-session" data-id="${session.id}">View / edit</button>${patternIds.has(session.series_id) ? `<button type="button" class="secondary-button edit-series" data-id="${session.id}">Edit recurring series</button>` : ''}<button type="button" class="secondary-button copy-session" data-id="${session.id}">Copy</button><button type="button" class="danger-text cancel-session" data-id="${session.id}">Cancel</button></div>` : ''}</article>
          `).join('') : '<p>No upcoming sessions have been scheduled.</p>'}
        </div>
        ${canManage ? '<div id="sessionDetails"></div>' : ''}
      </section>
      <section class="panel"><p class="eyebrow">New calendar entry</p><h2>Schedule a session</h2>
        ${canManage && services.length && staff.length ? `
          <form id="sessionForm" class="stacked-form">
            <label>Service<select id="sessionService">${services.map(service => `<option value="${service.id}">${escapeHtml(service.name)}</option>`).join('')}</select></label>
            <label>Team member<select id="sessionStaff"></select></label>
            <div class="form-row"><label>Date<input id="sessionDate" type="date" required></label><label>Start time<input id="sessionTime" type="time" required></label></div>
            <div class="form-row"><label>Duration<input id="sessionDuration" type="number" min="5" required></label><label>Capacity<input id="sessionCapacity" type="number" min="1" required></label></div>
            <label>Repeat<select id="sessionRepeat"><option value="1">This date only</option><option value="4">Weekly for 4 weeks</option><option value="8">Weekly for 8 weeks</option><option value="12">Weekly for 12 weeks</option></select></label>
            <label>Note<input id="sessionNotes" maxlength="1000"></label>
            <label class="check-label"><input id="sessionPublished" type="checkbox" checked> Publish for customer booking</label>
            <button type="submit">Add to calendar</button>
          </form>` : '<p>The calendar is read-only for this TerraPeak role.</p>'}
      </section>
    </div>
  `

  const serviceSelect = document.getElementById('sessionService')
  function refreshSessionForm() {
    if (!serviceSelect) return
    const serviceId = Number(serviceSelect.value)
    const service = serviceMap[serviceId]
    const eligibleIds = new Set(assignments.filter(item => item.service_id === serviceId).map(item => item.staff_id))
    const staffSelect = document.getElementById('sessionStaff')
    staffSelect.innerHTML = staff.filter(person => eligibleIds.has(person.id)).map(person => `<option value="${person.id}">${escapeHtml(person.display_name)} (${escapeHtml(person.timezone)})</option>`).join('')
    document.getElementById('sessionDuration').value = service?.duration_minutes || 60
    document.getElementById('sessionCapacity').value = service?.capacity || 1
  }
  serviceSelect?.addEventListener('change', refreshSessionForm)
  refreshSessionForm()

  function populateCreateForm(session) {
    const person = staffMap[session.staff_id]
    const local = dateTimeInZone(session.starts_at, person?.timezone || 'UTC')
    serviceSelect.value = session.service_id
    refreshSessionForm()
    document.getElementById('sessionStaff').value = session.staff_id
    document.getElementById('sessionDate').value = local.date
    document.getElementById('sessionTime').value = local.time
    document.getElementById('sessionDuration').value = Math.round((new Date(session.ends_at) - new Date(session.starts_at)) / 60000)
    document.getElementById('sessionCapacity').value = session.capacity
    document.getElementById('sessionRepeat').value = '1'
    document.getElementById('sessionNotes').value = session.notes || ''
    document.getElementById('sessionPublished').checked = session.is_published
  }

  function renderSessionDetails(session) {
    if (!canManage) return
    const target = document.getElementById('sessionDetails')
    const service = serviceMap[session.service_id]
    const person = staffMap[session.staff_id]
    const local = dateTimeInZone(session.starts_at, person?.timezone || 'UTC')
    const sessionRegistrations = registrationsBySession[session.id] || []
    const activePlaces = sessionRegistrations.filter(item => ['pending', 'confirmed'].includes(item.status)).reduce((sum, item) => sum + item.quantity, 0)
    const eligibleIds = new Set(assignments.filter(item => item.service_id === session.service_id).map(item => item.staff_id))
    target.innerHTML = `
      <section class="session-detail">
        <div class="panel-heading"><div><p class="eyebrow">Session details</p><h3>${escapeHtml(service?.name || 'Session')}</h3></div><button type="button" class="secondary-button" id="closeSessionDetails">Close</button></div>
        <form id="editSessionForm" class="stacked-form">
          <label>Team member<select id="editSessionStaff">${staff.filter(item => eligibleIds.has(item.id)).map(item => `<option value="${item.id}" ${item.id === session.staff_id ? 'selected' : ''}>${escapeHtml(item.display_name)}</option>`).join('')}</select></label>
          <div class="form-row"><label>Date<input id="editSessionDate" type="date" value="${local.date}" required></label><label>Start time<input id="editSessionTime" type="time" value="${local.time}" required></label></div>
          <div class="form-row"><label>Duration<input id="editSessionDuration" type="number" min="5" value="${Math.round((new Date(session.ends_at) - new Date(session.starts_at)) / 60000)}" required></label><label>Capacity<input id="editSessionCapacity" type="number" min="${activePlaces || 1}" value="${session.capacity}" required></label></div>
          <label>Note<input id="editSessionNotes" maxlength="1000" value="${escapeHtml(session.notes || '')}"></label>
          <label class="check-label"><input id="editSessionPublished" type="checkbox" ${session.is_published ? 'checked' : ''}> Published</label>
          <button type="submit">Save session changes</button>
        </form>
        ${access.canManageBookings ? `<div class="registration-list"><h3>Registrations (${activePlaces}/${session.capacity})</h3>${sessionRegistrations.length ? sessionRegistrations.map(booking => `<article class="registration-item"><div><strong>${escapeHtml(booking.customer_name)}</strong><span>${escapeHtml(booking.reference)} · ${booking.quantity} · ${escapeHtml(booking.status)}</span></div>${['pending', 'confirmed'].includes(booking.status) ? `<button type="button" class="danger-text cancel-registration" data-id="${booking.id}">Cancel registration</button>` : ''}</article>`).join('') : '<p>No registrations yet.</p>'}</div>` : ''}
      </section>`

    document.getElementById('closeSessionDetails').addEventListener('click', () => { target.innerHTML = '' })
    document.getElementById('editSessionForm').addEventListener('submit', async event => {
      event.preventDefault()
      const { error } = await supabase.rpc('update_scheduled_session', {
        p_session_id: session.id,
        p_staff_id: Number(document.getElementById('editSessionStaff').value),
        p_local_starts_at: `${document.getElementById('editSessionDate').value}T${document.getElementById('editSessionTime').value}:00`,
        p_duration_minutes: Number(document.getElementById('editSessionDuration').value),
        p_capacity: Number(document.getElementById('editSessionCapacity').value),
        p_is_published: document.getElementById('editSessionPublished').checked,
        p_notes: document.getElementById('editSessionNotes').value.trim() || null
      })
      if (error) return showMessage(error.message, 'error')
      showMessage('Session changes saved.')
      await renderSchedule(business, access)
    })
    target.querySelectorAll('.cancel-registration').forEach(button => button.addEventListener('click', async () => {
      const { error } = await supabase.rpc('set_scheduled_booking_status', { p_booking_id: button.dataset.id, p_status: 'cancelled' })
      if (error) return showMessage(error.message, 'error')
      showMessage('Registration cancelled.')
      await renderSchedule(business, access)
    }))
  }

  function renderSeriesDetails(session) {
    const pattern = patterns.find(item => item.id === session.series_id)
    const service = serviceMap[session.service_id]
    if (!pattern || !service) return showMessage('This session is not part of a managed recurring series.', 'error')
    const eligibleIds = new Set(staffSubjects.filter(item => item.subject.toLowerCase() === String(service.subject || '').toLowerCase()).map(item => item.staff_id))
    const target = document.getElementById('sessionDetails')
    const applyFrom = dateTimeInZone(session.starts_at, staffMap[session.staff_id]?.timezone || 'UTC').date
    target.innerHTML = `<section class="session-detail"><div class="panel-heading"><div><p class="eyebrow">Recurring series</p><h3>Edit future ${escapeHtml(service.name)} classes</h3></div><button type="button" class="secondary-button" id="closeSeriesDetails">Close</button></div><p>Changes apply to this occurrence and every later class in the same weekday series.</p><form id="editSeriesForm" class="stacked-form"><label>Apply from<input id="seriesApplyFrom" type="date" value="${applyFrom}" required></label><label>Qualified teacher<select id="seriesStaff">${staff.filter(person => eligibleIds.has(person.id)).map(person => `<option value="${person.id}" ${person.id === pattern.staff_id ? 'selected' : ''}>${escapeHtml(person.display_name)}</option>`).join('')}</select></label><div class="form-row"><label>Start time<input id="seriesStart" type="time" value="${String(pattern.starts_at).slice(0, 5)}" required></label><label>End time<input id="seriesEnd" type="time" value="${String(pattern.ends_at).slice(0, 5)}" required></label></div><button type="submit">Update recurring series</button></form></section>`
    document.getElementById('closeSeriesDetails').onclick = () => { target.innerHTML = '' }
    document.getElementById('editSeriesForm').onsubmit = async event => {
      event.preventDefault()
      if (!document.getElementById('seriesStaff').value) return showMessage('No teacher is qualified for this subject.', 'error')
      const { data, error } = await supabase.rpc('update_cohort_schedule_series', { p_pattern_id: pattern.id, p_staff_id: Number(document.getElementById('seriesStaff').value), p_starts_at: document.getElementById('seriesStart').value, p_ends_at: document.getElementById('seriesEnd').value, p_apply_from: document.getElementById('seriesApplyFrom').value })
      if (error) return showMessage(error.message, 'error')
      showMessage(`${data} future class${data === 1 ? '' : 'es'} updated.`)
      await renderSchedule(business, access)
    }
  }

  document.getElementById('sessionForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    if (!document.getElementById('sessionStaff').value) return showMessage('Assign a staff member to this service first.', 'error')
    const { data, error } = await supabase.rpc('create_scheduled_sessions', {
      p_business_id: business.id,
      p_service_id: Number(serviceSelect.value),
      p_staff_id: Number(document.getElementById('sessionStaff').value),
      p_local_starts_at: `${document.getElementById('sessionDate').value}T${document.getElementById('sessionTime').value}:00`,
      p_duration_minutes: Number(document.getElementById('sessionDuration').value),
      p_capacity: Number(document.getElementById('sessionCapacity').value),
      p_repeat_weeks: Number(document.getElementById('sessionRepeat').value),
      p_is_published: document.getElementById('sessionPublished').checked,
      p_notes: document.getElementById('sessionNotes').value.trim() || null
    })
    if (error) return showMessage(error.message, 'error')
    showMessage(`${data?.[0]?.sessions_created || 1} session${data?.[0]?.sessions_created === 1 ? '' : 's'} added.`)
    await renderSchedule(business, access)
  })

  document.querySelectorAll('.cancel-session').forEach(button => button.addEventListener('click', async () => {
    const { error } = await supabase.rpc('cancel_scheduled_session', { p_session_id: Number(button.dataset.id) })
    if (error) return showMessage(error.message, 'error')
    showMessage('Session cancelled.')
    await renderSchedule(business, access)
  }))
  function refreshBulkSelection() {
    const selected = [...document.querySelectorAll('.session-select:checked')]
    const count = document.getElementById('selectedSessionCount')
    const cancel = document.getElementById('cancelSelectedSessions')
    if (count) count.textContent = `${selected.length} selected`
    if (cancel) cancel.disabled = selected.length === 0
  }
  document.querySelectorAll('.session-select').forEach(input => input.addEventListener('change', refreshBulkSelection))
  document.getElementById('selectAllSessions')?.addEventListener('change', event => {
    document.querySelectorAll('.session-select').forEach(input => { input.checked = event.target.checked })
    refreshBulkSelection()
  })
  document.getElementById('cancelSelectedSessions')?.addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('.session-select:checked')].map(input => Number(input.value))
    if (!ids.length || !window.confirm(`Cancel ${ids.length} selected class${ids.length === 1 ? '' : 'es'}?`)) return
    const { data, error } = await supabase.rpc('bulk_cancel_scheduled_sessions', { p_session_ids: ids })
    if (error) return showMessage(error.message, 'error')
    showMessage(`${data} class${data === 1 ? '' : 'es'} cancelled.`)
    await renderSchedule(business, access)
  })
  document.querySelectorAll('.view-session').forEach(button => button.addEventListener('click', () => renderSessionDetails(scheduled.find(session => session.id === Number(button.dataset.id)))))
  document.querySelectorAll('.edit-series').forEach(button => button.addEventListener('click', () => renderSeriesDetails(scheduled.find(session => session.id === Number(button.dataset.id)))))
  document.querySelectorAll('.copy-session').forEach(button => button.addEventListener('click', () => populateCreateForm(scheduled.find(session => session.id === Number(button.dataset.id)))))
}

async function renderAvailability(business, access) {
  const [{ data: staff, error: staffError }, { data: services, error: servicesError }, { data: assignments, error: assignmentsError }, { data: holidays, error: holidaysError }] = await Promise.all([
    supabase.from('staff_members').select('id, display_name, user_id, timezone').eq('business_id', business.id).eq('is_active', true).order('display_name'),
    supabase.from('services').select('id, name').eq('business_id', business.id).eq('is_active', true).eq('is_internal', false).order('name'),
    supabase.from('staff_services').select('staff_id, service_id').eq('is_active', true),
    supabase.from('centre_holidays').select('id, starts_on, ends_on, reason').eq('business_id', business.id).gte('ends_on', new Date().toISOString().slice(0, 10)).order('starts_on')
  ])
  if (staffError) throw staffError
  if (servicesError) throw servicesError
  if (assignmentsError) throw assignmentsError
  if (holidaysError) throw holidaysError

  const canEditAvailability = access.canManageAvailability
  const visibleStaff = canEditAvailability
    ? staff
    : access.canViewOwnAvailability
      ? staff.filter(person => person.user_id === access.userId)
      : []
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const serviceMap = Object.fromEntries(services.map(service => [service.id, service]))

  document.getElementById('universalBookingContent').innerHTML = `
    <div class="universal-grid">
      <section class="panel"><p class="eyebrow">Weekly hours</p><h2>Recurring availability</h2>
        ${visibleStaff.length ? `
          <form id="availabilityForm" class="stacked-form">
            <label>Staff<select id="availabilityStaff" ${canEditAvailability ? '' : 'disabled'}>${visibleStaff.map(person => `<option value="${person.id}">${escapeHtml(person.display_name)}</option>`).join('')}</select></label>
            <div class="entity-card"><p id="availabilityAssignedServices"></p></div>
            <label>Service restriction<select id="availabilityService"><option value="">All assigned services</option>${services.map(service => `<option value="${service.id}">${escapeHtml(service.name)}</option>`).join('')}</select></label>
            <div class="weekly-grid">${days.map((day, index) => `<div class="day-row availability-day"><label class="check-label"><input class="day-enabled" data-day="${index}" type="checkbox" ${canEditAvailability ? '' : 'disabled'}>${day}</label><div class="day-periods" data-day="${index}"><div class="period-row"><input class="period-start" type="time" value="09:00" ${canEditAvailability ? '' : 'disabled'}><span>to</span><input class="period-end" type="time" value="17:00" ${canEditAvailability ? '' : 'disabled'}>${canEditAvailability ? '<button type="button" class="remove-period">Remove</button>' : ''}</div>${canEditAvailability ? `<button type="button" class="add-period" data-day="${index}">+ Add time period</button>` : ''}</div></div>`).join('')}</div>
            ${canEditAvailability ? '<div class="form-actions"><button id="availabilitySaveButton" type="submit">Replace weekly schedule</button><span id="availabilitySaveStatus" role="status" aria-live="polite"></span></div>' : '<p class="empty-copy">View only. Contact your administrator or planner if this schedule needs to change.</p>'}
          </form>` : access.canViewOwnAvailability ? '<p>Your TerraPeak account is not linked to a Reservations staff profile. Ask an administrator to link your profile.</p>' : '<p>This TerraPeak role does not have staff availability access.</p>'}
      </section>
      <section class="panel"><p class="eyebrow">Exceptions</p><h2>Day off or special hours</h2>
        ${visibleStaff.length ? `
          ${canEditAvailability ? '<form id="exceptionForm" class="stacked-form">' : '<div class="stacked-form">'}
            <label>Staff<select id="exceptionStaff" ${canEditAvailability ? '' : 'disabled'}>${visibleStaff.map(person => `<option value="${person.id}">${escapeHtml(person.display_name)}</option>`).join('')}</select></label>
            <div class="entity-card"><p id="exceptionAssignedServices"></p></div>
            <label>Service restriction<select id="exceptionService"><option value="">All assigned services</option>${services.map(service => `<option value="${service.id}">${escapeHtml(service.name)}</option>`).join('')}</select></label>
            ${canEditAvailability ? '<label>Type<select id="exceptionType"><option value="unavailable">Unavailable / day off</option><option value="available">Additional availability</option></select></label><label>Starts<input id="exceptionStart" type="datetime-local" required></label><label>Ends<input id="exceptionEnd" type="datetime-local" required></label><label>Reason<input id="exceptionReason"></label><div class="form-actions"><button id="exceptionSaveButton" type="submit">Add exception</button><span id="exceptionSaveStatus" role="status" aria-live="polite"></span></div>' : '<p class="empty-copy">Upcoming exceptions are view only.</p>'}
          ${canEditAvailability ? '</form>' : '</div>'}<div id="exceptionList" class="calendar-summary"></div>` : ''}
      </section>
      <section class="panel"><p class="eyebrow">Centre calendar</p><h2>Holidays and closures</h2>
        ${canEditAvailability ? '<form id="holidayForm" class="stacked-form"><div class="form-row"><label>First closed day<input id="holidayStart" type="date" required></label><label>Last closed day<input id="holidayEnd" type="date" required></label></div><label>Holiday or reason<input id="holidayReason" maxlength="300" required></label><p class="empty-copy">Unbooked classes in this period will be cancelled. If a class already has registrations, the closure will pause so staff can contact those families first.</p><div class="form-actions"><button id="holidaySaveButton" type="submit">Add centre closure</button><span id="holidaySaveStatus" role="status" aria-live="polite"></span></div></form>' : ''}
        <div class="calendar-summary">${holidays.length ? holidays.map(item => `<article class="calendar-item"><div><strong>${escapeHtml(item.reason)}</strong><span>${item.starts_on}${item.ends_on === item.starts_on ? '' : ` – ${item.ends_on}`}</span></div>${canEditAvailability ? `<button type="button" class="danger-text remove-holiday" data-id="${item.id}">Remove</button>` : ''}</article>`).join('') : '<p>No upcoming centre closures.</p>'}</div>
      </section>
    </div>
  `

  document.getElementById('holidayForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const startsOn = document.getElementById('holidayStart').value
    const endsOn = document.getElementById('holidayEnd').value
    if (endsOn < startsOn) return showMessage('The last closed day cannot be before the first.', 'error')
    const button = document.getElementById('holidaySaveButton')
    button.disabled = true
    const { data, error } = await supabase.rpc('create_centre_holiday', { p_business_id: business.id, p_starts_on: startsOn, p_ends_on: endsOn, p_reason: document.getElementById('holidayReason').value.trim() })
    button.disabled = false
    if (error) return showMessage(error.message, 'error')
    showMessage(`Centre closure saved. ${data?.[0]?.sessions_cancelled || 0} class${data?.[0]?.sessions_cancelled === 1 ? '' : 'es'} cancelled.`)
    await renderAvailability(business, access)
  })
  document.querySelectorAll('.remove-holiday').forEach(button => button.addEventListener('click', async () => {
    if (!window.confirm('Remove this centre closure? Cancelled classes will remain cancelled.')) return
    const { error } = await supabase.rpc('remove_centre_holiday', { p_holiday_id: Number(button.dataset.id) })
    if (error) return showMessage(error.message, 'error')
    showMessage('Centre closure removed. Previously cancelled classes were not restored.')
    await renderAvailability(business, access)
  }))

  if (!visibleStaff.length) return

  function refreshAssignedServices(staffSelectId, summaryId) {
    const staffId = Number(document.getElementById(staffSelectId).value)
    const assignedNames = assignments
      .filter(item => item.staff_id === staffId && serviceMap[item.service_id])
      .map(item => serviceMap[item.service_id].name)
    document.getElementById(summaryId).innerHTML = assignedNames.length
      ? `<strong>Assigned services:</strong> ${assignedNames.map(escapeHtml).join(', ')}`
      : '<strong>Assigned services:</strong> No services assigned. Assign services in Team &amp; Resources.'
  }

  function refreshServiceOptions(staffSelectId, serviceSelectId) {
    const staffId = Number(document.getElementById(staffSelectId).value)
    const eligible = new Set(assignments.filter(item => item.staff_id === staffId).map(item => item.service_id))
    const select = document.getElementById(serviceSelectId)
    const previous = select.value
    select.innerHTML = `<option value="">All assigned services</option>${services.filter(service => eligible.has(service.id)).map(service => `<option value="${service.id}">${escapeHtml(service.name)}</option>`).join('')}`
    if ([...select.options].some(option => option.value === previous)) select.value = previous
  }

  function wirePeriodRow(row) {
    row.querySelector('.remove-period')?.addEventListener('click', () => {
      const container = row.closest('.day-periods')
      if (container.querySelectorAll('.period-row').length === 1) {
        document.querySelector(`.day-enabled[data-day="${container.dataset.day}"]`).checked = false
        return
      }
      row.remove()
    })
  }
  function appendPeriod(container, start = '09:00', end = '17:00') {
    const row = document.createElement('div')
    row.className = 'period-row'
    row.innerHTML = `<input class="period-start" type="time" value="${start.slice(0, 5)}" ${canEditAvailability ? '' : 'disabled'}><span>to</span><input class="period-end" type="time" value="${end.slice(0, 5)}" ${canEditAvailability ? '' : 'disabled'}>${canEditAvailability ? '<button type="button" class="remove-period">Remove</button>' : ''}`
    container.insertBefore(row, container.querySelector('.add-period'))
    wirePeriodRow(row)
    return row
  }

  document.querySelectorAll('.period-row').forEach(wirePeriodRow)
  document.querySelectorAll('.add-period').forEach(button => button.addEventListener('click', () => {
    const container = document.querySelector(`.day-periods[data-day="${button.dataset.day}"]`)
    appendPeriod(container)
    document.querySelector(`.day-enabled[data-day="${button.dataset.day}"]`).checked = true
  }))

  async function loadWeeklySchedule() {
    const staffId = Number(document.getElementById('availabilityStaff').value)
    const serviceValue = document.getElementById('availabilityService').value
    let query = supabase.from('availability_rules').select('day_of_week, start_time, end_time').eq('staff_id', staffId).eq('is_active', true).order('start_time')
    query = serviceValue ? query.eq('service_id', Number(serviceValue)) : query.is('service_id', null)
    const { data: savedRules, error } = await query
    if (error) return showMessage(error.message, 'error')
    days.forEach((day, dayIndex) => {
      const container = document.querySelector(`.day-periods[data-day="${dayIndex}"]`)
      container.querySelectorAll('.period-row').forEach(row => row.remove())
      const periods = savedRules.filter(rule => rule.day_of_week === dayIndex)
      document.querySelector(`.day-enabled[data-day="${dayIndex}"]`).checked = periods.length > 0
      if (periods.length) periods.forEach(period => appendPeriod(container, period.start_time, period.end_time))
      else appendPeriod(container)
    })
  }

  document.getElementById('availabilityStaff').addEventListener('change', () => {
    refreshAssignedServices('availabilityStaff', 'availabilityAssignedServices')
    refreshServiceOptions('availabilityStaff', 'availabilityService')
    loadWeeklySchedule()
  })
  document.getElementById('availabilityService').addEventListener('change', loadWeeklySchedule)
  document.getElementById('availabilityForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const saveButton = document.getElementById('availabilitySaveButton')
    const saveStatus = document.getElementById('availabilitySaveStatus')
    const staffId = Number(document.getElementById('availabilityStaff').value)
    const serviceValue = document.getElementById('availabilityService').value
    const serviceId = serviceValue ? Number(serviceValue) : null
    const rules = [...document.querySelectorAll('.day-enabled:checked')].flatMap(checkbox => {
      const day = Number(checkbox.dataset.day)
      return [...document.querySelectorAll(`.day-periods[data-day="${day}"] .period-row`)].map(row => ({
        business_id: business.id,
        staff_id: staffId,
        service_id: serviceId,
        day_of_week: day,
        start_time: row.querySelector('.period-start').value,
        end_time: row.querySelector('.period-end').value
      }))
    })
    const invalidRule = rules.find(rule => !rule.start_time || !rule.end_time || rule.end_time <= rule.start_time)
    if (invalidRule) return showMessage(`${days[invalidRule.day_of_week]} has an invalid time range.`, 'error')
    saveButton.disabled = true
    saveStatus.textContent = 'Saving…'
    let deleteQuery = supabase.from('availability_rules').delete().eq('staff_id', staffId)
    deleteQuery = serviceId === null ? deleteQuery.is('service_id', null) : deleteQuery.eq('service_id', serviceId)
    const { error: deleteError } = await deleteQuery
    if (deleteError) {
      saveButton.disabled = false
      saveStatus.textContent = 'Not saved.'
      return showMessage(deleteError.message, 'error')
    }
    if (rules.length) {
      const { error } = await supabase.from('availability_rules').insert(rules)
      if (error) {
        saveButton.disabled = false
        saveStatus.textContent = 'Not saved.'
        return showMessage(error.message, 'error')
      }
    }
    await loadWeeklySchedule()
    saveButton.disabled = false
    saveStatus.textContent = 'Saved.'
    showMessage('Weekly availability saved.')
  })

  async function loadExceptions() {
    const staffId = Number(document.getElementById('exceptionStaff').value)
    const { data: exceptions, error } = await supabase.from('availability_exceptions').select('id, service_id, starts_at, ends_at, exception_type, reason').eq('staff_id', staffId).gte('ends_at', new Date().toISOString()).order('starts_at').limit(30)
    if (error) return showMessage(error.message, 'error')
    const target = document.getElementById('exceptionList')
    target.innerHTML = '<h3>Upcoming exceptions</h3>' + (exceptions.length ? exceptions.map(item => `<div class="calendar-item"><div><strong>${item.exception_type === 'unavailable' ? 'Time off' : 'Special hours'}</strong><span>${new Date(item.starts_at).toLocaleString()} – ${new Date(item.ends_at).toLocaleString()}</span><small>${escapeHtml(item.reason || '')}</small></div>${canEditAvailability ? `<button type="button" class="danger-text remove-exception" data-id="${item.id}">Remove</button>` : ''}</div>`).join('') : '<p>No upcoming exceptions.</p>')
    target.querySelectorAll('.remove-exception').forEach(button => button.addEventListener('click', async () => {
      const { error: deleteError } = await supabase.from('availability_exceptions').delete().eq('id', Number(button.dataset.id))
      if (deleteError) return showMessage(deleteError.message, 'error')
      showMessage('Calendar exception removed.')
      await loadExceptions()
    }))
  }

  document.getElementById('exceptionForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const saveButton = document.getElementById('exceptionSaveButton')
    const saveStatus = document.getElementById('exceptionSaveStatus')
    const staffId = Number(document.getElementById('exceptionStaff').value)
    const serviceValue = document.getElementById('exceptionService').value
    const startInput = document.getElementById('exceptionStart')
    const endInput = document.getElementById('exceptionEnd')
    const startsAt = new Date(startInput.value)
    const endsAt = new Date(endInput.value)
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) return showMessage('Choose a valid start and end date/time.', 'error')
    if (endsAt <= startsAt) return showMessage('The exception end must be after its start.', 'error')
    saveButton.disabled = true
    saveStatus.textContent = 'Saving…'
    const { error } = await supabase.from('availability_exceptions').insert({
      business_id: business.id,
      staff_id: staffId,
      service_id: serviceValue ? Number(serviceValue) : null,
      exception_type: document.getElementById('exceptionType').value,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reason: document.getElementById('exceptionReason').value.trim() || null
    })
    if (error) {
      saveButton.disabled = false
      saveStatus.textContent = 'Not saved.'
      return showMessage(error.message, 'error')
    }
    startInput.value = ''
    endInput.value = ''
    document.getElementById('exceptionReason').value = ''
    await loadExceptions()
    saveButton.disabled = false
    saveStatus.textContent = 'Added.'
    showMessage('Calendar exception added.')
  })
  document.getElementById('exceptionStaff').addEventListener('change', () => {
    refreshAssignedServices('exceptionStaff', 'exceptionAssignedServices')
    refreshServiceOptions('exceptionStaff', 'exceptionService')
    loadExceptions()
  })
  refreshAssignedServices('availabilityStaff', 'availabilityAssignedServices')
  refreshAssignedServices('exceptionStaff', 'exceptionAssignedServices')
  refreshServiceOptions('availabilityStaff', 'availabilityService')
  refreshServiceOptions('exceptionStaff', 'exceptionService')
  await loadWeeklySchedule()
  await loadExceptions()
}
