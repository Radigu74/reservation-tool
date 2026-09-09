import {
  RESERVATIONS_MANAGEMENT_ROUTE_SET,
  RESERVATIONS_NAVIGATION,
} from './reservations-routes.js'
import { supabase } from './supabaseclient.js'
import { getVisibleNavigation, resolveJourneyConfiguration } from './reservation-journey.js'
import { loadTenantReservationsSettings } from './reservation-settings-access.js'

const managementRoutes = new Set([
  'admin',
  'dashboard',
  ...RESERVATIONS_MANAGEMENT_ROUTE_SET,
  ...[...RESERVATIONS_MANAGEMENT_ROUTE_SET].map((route) => route.replace(/^admin/, 'dashboard')),
])

const pathParts = window.location.pathname.split('/').filter(Boolean)
const businessSlug = pathParts[0] || ''
const rawRoute = pathParts.slice(1).join('/')
const isCustomerView = new URLSearchParams(window.location.search).get('customerView') === '1'

if (businessSlug && isCustomerView && managementRoutes.has(rawRoute)) {
  installUnifiedManagementShell().catch(showConfigurationError)
}

function showConfigurationError(error) {
  const root = document.querySelector('#app')
  if (!root) return
  root.replaceChildren()
  const message = document.createElement('main')
  message.className = 'reservations-management'
  message.innerHTML = '<h1>Reservations unavailable</h1><p role="alert"></p>'
  message.querySelector('[role="alert"]').textContent = error?.message || 'Reservations configuration could not be loaded.'
  root.appendChild(message)
}

function canonicalRoute(route) {
  if (route.startsWith('admin')) {
    return route.replace(/^admin/, 'dashboard')
  }
  return route || 'dashboard'
}

function routeLabel(route) {
  const canonical = canonicalRoute(route)
  if (canonical.endsWith('/services')) return 'Services'
  if (canonical.endsWith('/staff')) return 'Team & Resources'
  if (canonical.endsWith('/schedule')) return 'Scheduled'
  if (canonical.endsWith('/availability')) return 'Availability'
  if (canonical.endsWith('/analytics')) return 'Analytics'
  if (canonical.endsWith('/settings')) return 'Settings'
  return 'Bookings'
}

function customerManagementHref(path) {
  const url = new URL(path, window.location.origin)
  url.searchParams.set('customerView', '1')
  return `${url.pathname}${url.search}`
}

function buildNavigation(activeRoute, capabilities = {}) {
  const base = `/${businessSlug}/dashboard`
  // The canonical registry remains the only source; capability filtering wraps RESERVATIONS_NAVIGATION.map.
  return getVisibleNavigation(RESERVATIONS_NAVIGATION, capabilities).map(({ label, route }) => {
    const path = route === 'admin' ? base : `${base}/${route.replace(/^admin\//, '')}`
    const hrefRoute = path.split('/').slice(2).join('/') || 'dashboard'
    const active = canonicalRoute(activeRoute) === hrefRoute
    const href = customerManagementHref(path)
    return `<a href="${href}" ${active ? 'class="active" aria-current="page"' : ''}>${label}</a>`
  }).join('')
}

function findBusinessName(root) {
  const trustedHeading = root.querySelector('.universal-header h1, h1')
  if (!trustedHeading) return 'Reservations'

  return trustedHeading.textContent
    .replace(/\s+Admin Dashboard$/i, '')
    .replace(/\s+Dashboard$/i, '')
    .replace(/\s+Reservations$/i, '')
    .trim() || 'Reservations'
}

function extractPageContent(root) {
  const universal = root.querySelector('.universal-admin')
  if (universal) {
    const message = universal.querySelector('#universalBookingMessage')
    const content = universal.querySelector('#universalBookingContent')
    const fragment = document.createDocumentFragment()
    if (message) fragment.appendChild(message)
    if (content) fragment.appendChild(content)
    return fragment
  }

  root.querySelectorAll('.admin-nav, #businessSwitcher').forEach((element) => element.remove())

  const fragment = document.createDocumentFragment()
  while (root.firstChild) {
    fragment.appendChild(root.firstChild)
  }
  return fragment
}

function renderUnifiedShell(root, capabilities) {
  if (root.dataset.unifiedReservationsShell === '1') return true

  const hasLegacyAdmin = root.querySelector('.reservations-management, .admin-nav, #adminReservations, #businessSettingsSection, #analyticsResults')
  const hasUniversalAdmin = root.querySelector('.universal-admin')
  if (!hasLegacyAdmin && !hasUniversalAdmin) return false

  const businessName = findBusinessName(root)
  const pageTitle = routeLabel(rawRoute)
  const content = extractPageContent(root)

  const shell = document.createElement('main')
  shell.className = 'reservations-management-shell'
  shell.innerHTML = `
    <span class="admin-nav reservations-admin-style-marker" hidden aria-hidden="true"></span>
    <header class="reservations-shell-header">
      <div>
        <p class="reservations-shell-eyebrow">TerraPeak Reservations</p>
        <h1>${pageTitle}</h1>
        <p>${businessName}</p>
      </div>
    </header>
    <nav class="reservations-shell-nav" aria-label="Reservations">
      ${buildNavigation(rawRoute, capabilities)}
    </nav>
    <section class="reservations-shell-content" data-reservations-content></section>
  `

  shell.querySelector('[data-reservations-content]').appendChild(content)
  root.replaceChildren(shell)
  root.dataset.unifiedReservationsShell = '1'
  document.body.classList.add('unified-reservations-management')
  document.title = `${businessName} | TerraPeak Reservations`
  return true
}

async function installUnifiedManagementShell() {
  const root = document.querySelector('#app')
  if (!root) return
  let capabilities = {}
  const businessId = Number(runtime.businessId)
  if (businessId) {
    const settings = await loadTenantReservationsSettings(supabase, businessId, 'template_key,capabilities,terminology')
    capabilities = resolveJourneyConfiguration(settings || {}, { business_type: runtime.businessType }).capabilities
  }

  if (renderUnifiedShell(root, capabilities)) return

  const observer = new MutationObserver(() => {
    if (renderUnifiedShell(root, capabilities)) observer.disconnect()
  })

  observer.observe(root, { childList: true, subtree: true })

  window.setTimeout(() => observer.disconnect(), 15000)
}
