import { supabase } from './supabaseclient.js'

const searchParams = new URLSearchParams(window.location.search)
const isCustomerDashboardView = searchParams.get('customerView') === '1'
const TERRAPEAK_DASHBOARD_ORIGINS = new Set([
  'https://dashboard.terrapeakgroup.com',
  'https://platform.terrapeakgroup.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175'
])
const PARENT_ORIGIN_STORAGE_KEY = 'terrapeak:reservations-parent-origin'

const pathParts = window.location.pathname.split('/').filter(Boolean)
const businessSlug = pathParts[0] || ''
const managementSegments = new Set([
  'admin',
  'dashboard',
  'analytics',
  'settings',
  'services',
  'staff',
  'schedule',
  'availability'
])
const reservedSegments = new Set([...managementSegments, 'book', 'onboarding'])
const isManagementRoute = pathParts.length > 1 && managementSegments.has(String(pathParts[1] || '').toLowerCase())

async function validatePublicBusinessRoute() {
  if (!businessSlug || reservedSegments.has(businessSlug.toLowerCase())) return null
  const { data, error } = await supabase.rpc('get_public_booking_business', { p_business_slug: businessSlug })
  if (error) {
    console.error('Could not validate Reservations tenant:', error)
    return null
  }
  return Array.isArray(data) ? data[0] || null : data || null
}

function renderUnavailable(message = 'This Reservations workspace is not configured or the link is invalid.') {
  document.querySelector('#app').innerHTML = `<main class="auth-card"><h1>Reservations workspace not available</h1><p>${message}</p><a href="https://dashboard.terrapeakgroup.com/dashboard/reservations" target="_top">Return to TerraPeak Reservations</a></main>`
}

function allowedDashboardOrigin(value) {
  return TERRAPEAK_DASHBOARD_ORIGINS.has(String(value || '')) ? String(value) : ''
}

function rememberParentOrigin(origin) {
  const trusted = allowedDashboardOrigin(origin)
  if (!trusted) return ''
  try { window.sessionStorage.setItem(PARENT_ORIGIN_STORAGE_KEY, trusted) } catch {}
  return trusted
}

function getTrustedParentOrigin() {
  const ancestorOrigin = allowedDashboardOrigin(window.location.ancestorOrigins?.[0])
  if (ancestorOrigin) return rememberParentOrigin(ancestorOrigin)
  if (document.referrer) {
    try {
      const referrerOrigin = allowedDashboardOrigin(new URL(document.referrer).origin)
      if (referrerOrigin) return rememberParentOrigin(referrerOrigin)
    } catch {}
  }
  try { return allowedDashboardOrigin(window.sessionStorage.getItem(PARENT_ORIGIN_STORAGE_KEY)) } catch { return '' }
}

async function establishSupabaseSession(bootstrap) {
  const expectedUserId = String(bootstrap?.supabaseUserId || '')
  const { data: sessionData } = await supabase.auth.getSession()
  const currentSession = sessionData?.session || null

  if (currentSession?.user?.id && expectedUserId && currentSession.user.id === expectedUserId) {
    return { error: null, reused: true }
  }

  if (currentSession?.user?.id && currentSession.user.id !== expectedUserId) {
    await supabase.auth.signOut({ scope: 'local' })
  }

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: bootstrap.tokenHash,
    type: bootstrap.type || 'email'
  })
  if (error) return { error, reused: false }

  const establishedUserId = String(data?.user?.id || data?.session?.user?.id || '')
  if (!expectedUserId || establishedUserId !== expectedUserId) {
    await supabase.auth.signOut({ scope: 'local' })
    return { error: new Error('Reservations session identity did not match the TerraPeak bootstrap.'), reused: false }
  }

  const { data: membership, error: membershipError } = await supabase
    .from('business_memberships')
    .select('role,platform_role')
    .eq('business_id', Number(bootstrap.businessId))
    .eq('user_id', expectedUserId)
    .maybeSingle()

  if (membershipError || !membership) {
    await supabase.auth.signOut({ scope: 'local' })
    return { error: membershipError || new Error('Reservations access membership is missing.'), reused: false }
  }

  return { error: null, reused: false }
}

function storeTrustedContext(bootstrap) {
  window.__TERRAPEAK_RESERVATIONS_CONTEXT__ = Object.freeze({
    companyId: String(bootstrap.companyId || ''),
    companyRole: String(bootstrap.companyRole || 'viewer').toLowerCase(),
    capabilities: Object.freeze({ ...(bootstrap.capabilities || {}) }),
    reservationsCompatibilityRole: String(bootstrap.reservationsCompatibilityRole || ''),
    businessId: Number(bootstrap.businessId),
    businessSlug: bootstrap.businessSlug,
    supabaseUserId: String(bootstrap.supabaseUserId || ''),
    source: 'terrapeak-dashboard'
  })
  window.__TERRAPEAK_RESERVATIONS_READY__ = true
}

function startCustomerDashboardView() {
  const parentOrigin = getTrustedParentOrigin()
  if (!parentOrigin || window.parent === window) {
    renderUnavailable('Reservations management must be opened from the TerraPeak Dashboard.')
    return Promise.resolve(false)
  }

  document.querySelector('#app').innerHTML = `<main class="auth-card"><h1>Opening Reservations</h1><p>Connecting your TerraPeak workspace...</p></main>`

  return new Promise((resolve) => {
    let completed = false, sessionExchangeInFlight = false, readyHeartbeat = null, timeoutId = null
    const postReady = () => {
      if (completed || sessionExchangeInFlight) return
      window.parent.postMessage({ type: 'terrapeak:reservations-ready', businessSlug }, parentOrigin)
    }
    const finish = result => {
      if (readyHeartbeat) window.clearInterval(readyHeartbeat)
      if (timeoutId) window.clearTimeout(timeoutId)
      window.removeEventListener('message', receiveSession)
      resolve(result)
    }
    const receiveSession = async event => {
      if (completed || sessionExchangeInFlight || event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== 'terrapeak:reservations-session') return
      const bootstrap = event.data.bootstrap
      const trustedBusinessId = Number(bootstrap?.businessId)
      if (!bootstrap?.tokenHash || bootstrap.businessSlug !== businessSlug || !Number.isFinite(trustedBusinessId) || trustedBusinessId <= 0 || !bootstrap?.supabaseUserId) {
        completed = true
        renderUnavailable('The TerraPeak company does not match this Reservations workspace.')
        finish(false)
        return
      }
      sessionExchangeInFlight = true
      if (readyHeartbeat) window.clearInterval(readyHeartbeat)
      const { error } = await establishSupabaseSession(bootstrap)
      if (error) {
        completed = true
        console.error('Could not establish Reservations session:', error)
        renderUnavailable('Your TerraPeak Reservations session could not be established. Return to the dashboard and try again.')
        finish(false)
        return
      }
      completed = true
      storeTrustedContext(bootstrap)
      finish(true)
    }
    window.addEventListener('message', receiveSession)
    postReady()
    readyHeartbeat = window.setInterval(postReady, 500)
    timeoutId = window.setTimeout(() => {
      if (completed) return
      completed = true
      renderUnavailable('The TerraPeak Reservations connection timed out. Return to the dashboard and try again.')
      finish(false)
    }, 20000)
  })
}

if (isManagementRoute) {
  if (!isCustomerDashboardView) renderUnavailable('Reservations management is controlled by TerraPeak. Open this company from the TerraPeak Dashboard instead of signing in separately.')
  else await startCustomerDashboardView()
} else {
  const validBusiness = await validatePublicBusinessRoute()
  if (!validBusiness) renderUnavailable()
  else {
    const canonicalPublicPath = `/book/${encodeURIComponent(validBusiness.business_slug || businessSlug)}`
    if (window.location.pathname !== canonicalPublicPath) window.history.replaceState({}, '', `${canonicalPublicPath}${window.location.search}${window.location.hash}`)
    await import('./public-booking.js')
  }
}
