import { listManagedBookings, updateManagedBookingStatus } from './booking-management-store.js'

const runtime = window.__TERRAPEAK_RESERVATIONS_RUNTIME__
if (!runtime || runtime.source !== 'terrapeak-dashboard') throw new Error('Trusted TerraPeak Reservations runtime is required.')
const businessId = Number(runtime.businessId)
const route = window.location.pathname.split('/').filter(Boolean).slice(1).join('/')
const hasCapability = name => runtime.hasCapability?.(name) === true
const today = new Date().toISOString().slice(0, 10)

function escapeHtml(value = '') { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;') }
function statusLabel(status) { return ({ pending:'Awaiting confirmation', confirmed:'Confirmed', completed:'Completed', cancelled:'Cancelled', no_show:'No Show' })[status] || status || 'Unknown' }
function displayValue(value) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
function detailItem(label, value) { return `<div class="booking-detail-item"><span class="booking-detail-label">${escapeHtml(label)}</span><strong class="booking-detail-value">${escapeHtml(displayValue(value))}</strong></div>` }
function detailSection(title, content, className='') { return `<section class="booking-detail-section ${className}"><h4>${escapeHtml(title)}</h4><div class="booking-detail-grid">${content}</div></section>` }
function bookingDetails(row) {
  const appointment = detailItem('Reference', row.reference) + detailItem('Service', row.serviceName) + detailItem('Date', row.bookingDate) + detailItem('Time', row.bookingTime) + detailItem('Status', statusLabel(row.status))
  const customer = detailItem('Name', row.customerName) + detailItem('Phone', row.customerPhone) + detailItem('Email', row.customerEmail)
  const custom = (row.customFields || []).map(field => detailItem(field.label, field.value)).join('')
  const notes = row.notes ? `<section class="booking-notes"><h4>Notes</h4><p>${escapeHtml(displayValue(row.notes))}</p></section>` : ''
  return `<section class="booking-detail-panel" data-detail-key="${escapeHtml(`${row.source}:${row.id}`)}" hidden>
    <div class="booking-detail-columns">
      ${detailSection('Appointment', appointment)}
      ${detailSection('Customer', customer)}
    </div>
    ${custom ? detailSection('Booking details', custom, 'booking-custom-details') : ''}
    ${notes}
  </section>`
}

function ensureBookingDetailStyles() {
  if (document.getElementById('bookingDetailStyles')) return
  const style = document.createElement('style')
  style.id = 'bookingDetailStyles'
  style.textContent = `
    #adminReservations .booking-card-admin{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:start!important;gap:14px 24px!important}
    #adminReservations .booking-card-summary{min-width:0;cursor:pointer;padding:2px 0}
    #adminReservations .booking-card-summary:focus-visible{outline:3px solid rgba(49,91,126,.28);outline-offset:5px;border-radius:6px}
    #adminReservations .booking-card-summary h3{font-size:15px!important;margin-bottom:5px!important}
    #adminReservations .booking-card-summary p{line-height:1.35}
    #adminReservations .booking-detail-hint{margin-top:7px!important;color:#315b7e;font-weight:700;font-size:12px}
    #adminReservations .session-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;align-self:center}
    #adminReservations .booking-detail-panel{grid-column:1/-1;width:100%;box-sizing:border-box;margin-top:4px;padding-top:20px;border-top:1px solid #dbe3e9}
    #adminReservations .booking-detail-panel[hidden]{display:none!important}
    #adminReservations .booking-detail-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    #adminReservations .booking-detail-section{min-width:0;padding:18px;border:1px solid #dbe3e9;border-radius:10px;background:#f8fafb}
    #adminReservations .booking-detail-section h4,#adminReservations .booking-notes h4{margin:0 0 14px;color:#1f3040;font-size:13px;text-transform:uppercase;letter-spacing:.06em}
    #adminReservations .booking-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px 22px}
    #adminReservations .booking-detail-item{min-width:0}
    #adminReservations .booking-detail-label{display:block;margin-bottom:4px;color:#66798a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    #adminReservations .booking-detail-value{display:block;color:#1f3040;font-size:14px;line-height:1.4;overflow-wrap:anywhere}
    #adminReservations .booking-custom-details{grid-column:1/-1;margin-top:16px;background:#fff}
    #adminReservations .booking-custom-details .booking-detail-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
    #adminReservations .booking-notes{margin-top:16px;padding:16px 18px;border-left:3px solid #cfd9e2;background:#f8fafb;border-radius:8px}
    #adminReservations .booking-notes p{margin:0!important;color:#1f3040;line-height:1.5;white-space:pre-wrap}
    @media(max-width:760px){#adminReservations .booking-card-admin{grid-template-columns:1fr!important}#adminReservations .session-actions{justify-content:flex-start}#adminReservations .booking-detail-columns,#adminReservations .booking-custom-details .booking-detail-grid{grid-template-columns:1fr}#adminReservations .booking-detail-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:480px){#adminReservations .booking-detail-grid{grid-template-columns:1fr}}
  `
  document.head.appendChild(style)
}

async function renderBookings() {
  ensureBookingDetailStyles()
  const canManage = hasCapability('manageBookings')
  document.querySelector('#app').innerHTML = `<main class="reservations-management">
    <header class="management-page-heading"><div><h1>Bookings</h1><p>Search, review and update customer bookings.</p></div></header>
    <div class="analytics-filter-panel booking-filter-panel" aria-label="Booking filters"><div class="filter-date-grid"><label>Start date<input type="date" id="adminStartDateFilter" value="${today}"></label><label>End date<input type="date" id="adminEndDateFilter" value="${today}"></label></div><button id="loadDateButton" type="button">Apply dates</button></div>
    <div class="booking-search-toolbar" role="search"><label class="sr-only" for="searchReference">Booking reference</label><input id="searchReference" type="search" placeholder="Search by booking reference" autocomplete="off"><button id="searchButton" type="button">Search</button><button id="refreshButton" type="button">Clear search</button></div>
    <div class="booking-view-tabs" role="group" aria-label="Booking status view"><button id="showActiveButton" class="active" type="button" aria-pressed="true">Active</button><button id="showArchivedButton" type="button" aria-pressed="false">Past & cancelled</button><button id="showAllButton" type="button" aria-pressed="false">All</button></div>
    <div id="dashboardSummary"></div><div id="adminReservations" aria-live="polite">Loading bookings...</div>
  </main>`

  const startInput=document.getElementById('adminStartDateFilter'), endInput=document.getElementById('adminEndDateFilter'), target=document.getElementById('adminReservations'), summary=document.getElementById('dashboardSummary')
  let viewMode='active', currentRows=[]
  function updateSummary(rows) {
    const count=status=>rows.filter(row=>row.status===status).length
    summary.innerHTML=`<div class="summary-grid"><div class="summary-card"><h3>Bookings</h3><p>${rows.length}</p></div><div class="summary-card"><h3>Awaiting confirmation</h3><p>${count('pending')}</p></div><div class="summary-card"><h3>Confirmed</h3><p>${count('confirmed')}</p></div><div class="summary-card"><h3>Completed</h3><p>${count('completed')}</p></div><div class="summary-card"><h3>Cancelled</h3><p>${count('cancelled')}</p></div><div class="summary-card"><h3>No Shows</h3><p>${count('no_show')}</p></div></div>`
  }
  function renderRows(rows) {
    currentRows=rows; updateSummary(rows)
    if(!rows.length){target.innerHTML='<div class="management-empty-state"><h2>No bookings found</h2><p>Try another date range, status view or booking reference.</p></div>';return}
    target.innerHTML=rows.map(row=>`<article class="entity-card booking-card-admin" data-booking-key="${escapeHtml(`${row.source}:${row.id}`)}">
      <div class="booking-card-summary" role="button" tabindex="0" aria-expanded="false"><h3>${escapeHtml(row.reference||'No reference')}</h3><p>${escapeHtml(row.serviceName||'Booking')}</p><p>${escapeHtml(row.customerName)}${row.customerPhone?` · ${escapeHtml(row.customerPhone)}`:''}</p><p>${escapeHtml(row.bookingDate)} ${escapeHtml(row.bookingTime)}</p><span class="booking-status booking-status-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span><p class="booking-detail-hint">View details</p></div>
      ${canManage&&row.source==='bookings'?`<div class="session-actions">${row.status==='pending'?`<button type="button" data-action="confirmed" data-key="${escapeHtml(`${row.source}:${row.id}`)}">Confirm appointment</button>`:''}${['pending','confirmed'].includes(row.status)?`<button type="button" data-action="completed" data-key="${escapeHtml(`${row.source}:${row.id}`)}">Complete</button><button type="button" data-action="no_show" data-key="${escapeHtml(`${row.source}:${row.id}`)}">No show</button><button type="button" data-action="cancelled" data-key="${escapeHtml(`${row.source}:${row.id}`)}">Cancel</button>`:''}</div>`:''}
      ${bookingDetails(row)}</article>`).join('')
  }
  async function loadRows(reference='') {
    target.innerHTML='<p>Loading bookings...</p>'
    try { renderRows(await listManagedBookings({businessId,startDate:startInput.value,endDate:endInput.value,reference,viewMode})) }
    catch(error){target.innerHTML=`<p class="error">${escapeHtml(error.message)}</p>`}
  }
  function toggleDetails(summaryEl) {
    const card=summaryEl.closest('[data-booking-key]'), panel=card?.querySelector('.booking-detail-panel'); if(!panel)return
    const opening=panel.hidden; panel.hidden=!opening; summaryEl.setAttribute('aria-expanded',String(opening)); const hint=summaryEl.querySelector('.booking-detail-hint'); if(hint)hint.textContent=opening?'Hide details':'View details'
  }
  target.addEventListener('click',async event=>{
    const button=event.target.closest('button[data-action]')
    if(button){
      if(!canManage)return
      const booking=currentRows.find(row=>`${row.source}:${row.id}`===button.dataset.key); if(!booking)return
      const action=button.dataset.action; if(!['confirmed','completed','no_show','cancelled'].includes(action))return
      const result=await updateManagedBookingStatus(booking,action); if(result?.error)return window.alert(result.error.message); await loadRows(); return
    }
    const summaryEl=event.target.closest('.booking-card-summary'); if(summaryEl)toggleDetails(summaryEl)
  })
  target.addEventListener('keydown',event=>{if(!['Enter',' '].includes(event.key))return;const summaryEl=event.target.closest('.booking-card-summary');if(!summaryEl)return;event.preventDefault();toggleDetails(summaryEl)})
  document.getElementById('loadDateButton').addEventListener('click',()=>loadRows())
  document.getElementById('refreshButton').addEventListener('click',()=>{document.getElementById('searchReference').value='';loadRows()})
  document.getElementById('searchButton').addEventListener('click',()=>loadRows(document.getElementById('searchReference').value.trim()))
  document.getElementById('searchReference').addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();loadRows(event.currentTarget.value.trim())})
  const viewButtons=['showActiveButton','showArchivedButton','showAllButton']
  function selectView(buttonId,mode){viewMode=mode;viewButtons.forEach(id=>{const button=document.getElementById(id),selected=id===buttonId;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected))});loadRows()}
  document.getElementById('showActiveButton').addEventListener('click',()=>selectView('showActiveButton','active'))
  document.getElementById('showArchivedButton').addEventListener('click',()=>selectView('showArchivedButton','archived'))
  document.getElementById('showAllButton').addEventListener('click',()=>selectView('showAllButton','all'))
  await loadRows()
}

async function renderAnalytics() {
  if(!hasCapability('viewAnalytics')){document.querySelector('#app').innerHTML='<main><h1>Analytics</h1><p>This role does not have access to Reservations analytics.</p></main>';return}
  document.querySelector('#app').innerHTML=`<main class="reservations-management"><header class="management-page-heading"><div><h1>Analytics</h1><p>Review booking volume and attendance for any date range.</p></div></header><div class="analytics-filter-panel booking-filter-panel"><div class="filter-date-grid"><label>Start date<input type="date" id="analyticsStartDate" value="${today}"></label><label>End date<input type="date" id="analyticsEndDate" value="${today}"></label></div><button id="loadAnalyticsButton" type="button">Apply dates</button></div><div id="analyticsResults" aria-live="polite"></div></main>`
  async function loadAnalytics(){const target=document.getElementById('analyticsResults');target.innerHTML='<p>Loading analytics...</p>';try{const rows=await listManagedBookings({businessId,startDate:document.getElementById('analyticsStartDate').value,endDate:document.getElementById('analyticsEndDate').value,viewMode:'all'}),count=status=>rows.filter(row=>row.status===status).length;target.innerHTML=`<div class="summary-grid"><div class="summary-card"><h3>Total Bookings</h3><p>${rows.length}</p></div><div class="summary-card"><h3>Awaiting confirmation</h3><p>${count('pending')}</p></div><div class="summary-card"><h3>Confirmed</h3><p>${count('confirmed')}</p></div><div class="summary-card"><h3>Completed</h3><p>${count('completed')}</p></div><div class="summary-card"><h3>Cancelled</h3><p>${count('cancelled')}</p></div><div class="summary-card"><h3>No Shows</h3><p>${count('no_show')}</p></div></div>`}catch(error){target.innerHTML=`<p class="error">${escapeHtml(error.message)}</p>`}}
  document.getElementById('loadAnalyticsButton').addEventListener('click',loadAnalytics);await loadAnalytics()
}

if(route==='admin')await renderBookings()
if(route==='admin/analytics')await renderAnalytics()
