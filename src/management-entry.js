import { RESERVATIONS_MANAGEMENT_ROUTE_SET, RESERVATIONS_ROUTE_GROUPS } from './reservations-routes.js'
import { supabase } from './supabaseclient.js'
import { resolveJourneyConfiguration } from './reservation-journey.js'
import { loadTenantReservationsSettings } from './reservation-settings-access.js'

const runtime = window.__TERRAPEAK_RESERVATIONS_RUNTIME__

if (!runtime || runtime.source !== 'terrapeak-dashboard') {
  throw new Error('Trusted TerraPeak Reservations runtime is required.')
}

const route = window.location.pathname.split('/').filter(Boolean).slice(1).join('/')

if (!RESERVATIONS_MANAGEMENT_ROUTE_SET.has(route)) {
  throw new Error(`Unsupported Reservations management route: ${route}`)
}

await import('./customer-tenant-lock.js')
await import('./business-name-unification.js')

const capabilityForRoute = route.endsWith('/services') ? 'services' : route.endsWith('/staff') ? 'teamResources' : route.endsWith('/schedule') ? 'scheduledSessions' : null
let routeDisabled = false
if (capabilityForRoute && route !== 'admin') {
  try {
    const settings = await loadTenantReservationsSettings(supabase, runtime.businessId, 'template_key,capabilities,terminology')
    routeDisabled = resolveJourneyConfiguration(settings, {}).capabilities[capabilityForRoute] === false
  } catch (error) {
    const app = document.querySelector('#app')
    if (app) app.innerHTML = '<main class="reservations-management"><h1>Reservations unavailable</h1><p role="alert"></p></main>'
    const alert = app?.querySelector('[role="alert"]')
    if (alert) alert.textContent = error.message
    throw error
  }
}

if (routeDisabled) {
  document.querySelector('#app').innerHTML = `<main class="reservations-management"><h1>Reservations feature not enabled</h1><p>This Reservations capability is currently disabled. An administrator can re-enable it in Settings.</p><a href="/${runtime.businessSlug}/dashboard/settings">Open Settings</a></main>`
} else if (RESERVATIONS_ROUTE_GROUPS.unifiedBookings.has(route)) {
  await import('./unified-bookings-admin.js')
}

if (!routeDisabled && RESERVATIONS_ROUTE_GROUPS.settings.has(route)) {
  await import('./restaurant-settings.js')
  await import('./admin-enhancements.js')
  await import('./custom-field-option-repair.js')
}

if (!routeDisabled && RESERVATIONS_ROUTE_GROUPS.customerForm.has(route)) {
  await import('./customer-form-admin.js')
  await import('./admin-enhancements.js')
}

if (!routeDisabled && RESERVATIONS_ROUTE_GROUPS.universal.has(route)) {
  await import('./universal-booking-admin.js')
  await import('./reservation-template-preview.js')
}

await import('./management-capability-ui.js')
await import('./reservations-management-shell.js')
