import { resolveReservationsConfiguration } from './reservation-configuration.js'

export const CAPABILITY_KEYS = Object.freeze(['services', 'teamResources', 'scheduledSessions', 'packages', 'guestCount'])

export function resolveJourneyConfiguration(settings = {}, business = {}) {
  const configuration = resolveReservationsConfiguration({
    templateKey: settings.template_key,
    businessType: business.business_type,
    terminology: settings.terminology,
    capabilities: settings.capabilities,
  })
  const capabilities = Object.fromEntries(CAPABILITY_KEYS.map(key => [key, configuration.capabilities[key] !== false]))
  if (capabilities.scheduledSessions || capabilities.packages) capabilities.services = true
  return { ...configuration, capabilities }
}

export function isCustomerVisibleService(service = {}) {
  return service.is_active === true && service.is_published === true && service.is_internal !== true && service.is_system !== true
}

export function buildCustomerJourney({ capabilities = {}, service = null } = {}) {
  const steps = []
  if (capabilities.services) steps.push('service')
  if (capabilities.teamResources && service?.supportsTeam !== false) steps.push('team')
  if (capabilities.scheduledSessions && service?.scheduling_mode === 'scheduled') steps.push('scheduled')
  else steps.push('date-time')
  steps.push('customer-form', 'confirmation')
  return steps
}

export function getVisibleNavigation(navigation, capabilities = {}) {
  const routeCapability = { services: 'services', staff: 'teamResources', schedule: 'scheduledSessions' }
  return navigation.filter(item => {
    const key = Object.keys(routeCapability).find(route => item.route.endsWith(`/${route}`))
    return !key || capabilities[routeCapability[key]] !== false
  })
}
