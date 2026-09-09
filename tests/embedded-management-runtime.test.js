import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const shellUrl = new URL('../src/reservations-management-shell.js', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function createRoot() {
  return {
    dataset: {},
    querySelector: () => null,
    replaceChildren: () => {},
    appendChild: () => {},
  }
}

function withoutImports(source) {
  return source
    .replace(/import \{\n  RESERVATIONS_MANAGEMENT_ROUTE_SET,\n  RESERVATIONS_NAVIGATION,\n\} from '\.\/reservations-routes\.js'\n/, '')
    .replace(/import \{ supabase \} from '\.\/supabaseclient\.js'\n/, '')
    .replace(/import \{ getVisibleNavigation, resolveJourneyConfiguration \} from '\.\/reservation-journey\.js'\n/, '')
    .replace(/import \{ loadTenantReservationsSettings \} from '\.\/reservation-settings-access\.js'\n/, '')
}

async function runShellForRoute(source, route) {
  const root = createRoot()
  const window = {
    location: { pathname: `/terrapeak/${route}`, search: '', origin: 'https://dashboard.terrapeakgroup.com' },
    setTimeout: () => {},
    __TERRAPEAK_RESERVATIONS_RUNTIME__: {
      businessId: 0,
      businessSlug: 'terrapeak',
      businessType: 'restaurant',
      source: 'terrapeak-dashboard',
    },
  }
  const document = { querySelector: selector => selector === '#app' ? root : null }
  const MutationObserver = class { observe() {} disconnect() {} }
  const execute = new AsyncFunction(
    'window', 'document', 'MutationObserver', 'URLSearchParams',
    'RESERVATIONS_MANAGEMENT_ROUTE_SET', 'RESERVATIONS_NAVIGATION', 'supabase',
    'getVisibleNavigation', 'resolveJourneyConfiguration', 'loadTenantReservationsSettings',
    `${withoutImports(source)}\nreturn installUnifiedManagementShell;`,
  )
  const installUnifiedManagementShell = await execute(
    window, document, MutationObserver, URLSearchParams,
    new Set(['admin', 'admin/analytics', 'admin/settings', 'admin/customer-form']), [], {},
    () => [], () => ({ capabilities: {} }), async () => ({}),
  )
  await installUnifiedManagementShell()
}

test('embedded management shell initializes without an undeclared runtime on every legacy Dashboard route', async () => {
  const source = await readFile(shellUrl, 'utf8')
  for (const route of ['admin', 'admin/analytics', 'admin/settings', 'admin/customer-form']) {
    await assert.doesNotReject(runShellForRoute(source, route), route)
  }
})
