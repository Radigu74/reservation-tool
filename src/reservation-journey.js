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
  if (capabilities.guestCount) return ['party-size', 'date-time', 'customer-form', 'confirmation']
  const steps = []
  if (capabilities.services) steps.push('service')
  if (capabilities.teamResources && service?.supportsTeam !== false) steps.push('team')
  if (capabilities.scheduledSessions && service?.scheduling_mode === 'scheduled') steps.push('scheduled')
  else steps.push('date-time')
  steps.push('customer-form', 'confirmation')
  return steps
}

export function restaurantPartySizeRange(maxGuests) {
  const max = Math.floor(Number(maxGuests))
  return { min: 1, max: Number.isFinite(max) && max > 0 ? max : 1 }
}

export function filterRestaurantSlotsForPartySize(slots = [], partySize) {
  const requested = Number(partySize)
  if (!Number.isInteger(requested) || requested < 1) return []
  return slots.filter(slot => Number(slot.remaining_capacity) >= requested)
}

export function bookingConfirmationPresentation(configuration = {}, { requestMode = false } = {}) {
  const terminology = configuration.terminology || resolveReservationsConfiguration().terminology
  const bookingSingular = terminology.bookingSingular || 'Booking'
  return {
    confirmLabel: requestMode ? 'Request appointment' : `Confirm ${bookingSingular.toLowerCase()}`,
    confirmationKicker: requestMode ? 'Appointment request received' : `${bookingSingular} confirmed`,
  }
}

export function scheduledRegistrationPresentation(configuration = {}, service = {}) {
  const terminology = configuration.terminology || resolveReservationsConfiguration().terminology
  const confirmation = bookingConfirmationPresentation(configuration)
  const packageSessions = Math.max(1, Math.floor(Number(service.price_session_count) || 1))
  const packageValidityDays = Math.max(0, Math.floor(Number(service.package_validity_days) || 0))
  return {
    formHeading: `${terminology.customerSingular} details`,
    confirmationKicker: confirmation.confirmationKicker,
    confirmLabel: confirmation.confirmLabel,
    packageSessions,
    packageValidityDays,
  }
}

export function getVisibleNavigation(navigation, capabilities = {}) {
  const routeCapability = { services: 'services', staff: 'teamResources', schedule: 'scheduledSessions' }
  return navigation.filter(item => {
    const key = Object.keys(routeCapability).find(route => item.route.endsWith(`/${route}`))
    return !key || capabilities[routeCapability[key]] !== false
  })
}
