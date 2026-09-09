const NEUTRAL_TERMINOLOGY = Object.freeze({
  customerSingular: 'Customer', customerPlural: 'Customers',
  teamMemberSingular: 'Team member', teamMemberPlural: 'Team members',
  serviceSingular: 'Service', servicePlural: 'Services',
  bookingSingular: 'Booking', bookingPlural: 'Bookings',
  guestSingular: 'Guest', guestPlural: 'Guests',
})

const TEMPLATE_TERMINOLOGY = Object.freeze({
  general: {},
  dental: {
    customerSingular: 'Patient', customerPlural: 'Patients',
    teamMemberSingular: 'Dentist', teamMemberPlural: 'Dentists',
    serviceSingular: 'Treatment', servicePlural: 'Treatments',
    bookingSingular: 'Appointment', bookingPlural: 'Appointments',
  },
  physiotherapy: {
    customerSingular: 'Patient', customerPlural: 'Patients',
    teamMemberSingular: 'Therapist', teamMemberPlural: 'Therapists',
    serviceSingular: 'Treatment', servicePlural: 'Treatments',
    bookingSingular: 'Appointment', bookingPlural: 'Appointments',
  },
  salon: {
    teamMemberSingular: 'Stylist', teamMemberPlural: 'Stylists',
    bookingSingular: 'Appointment', bookingPlural: 'Appointments',
  },
  learning_centre: {
    customerSingular: 'Student', customerPlural: 'Students',
    teamMemberSingular: 'Teacher', teamMemberPlural: 'Teachers',
    serviceSingular: 'Class', servicePlural: 'Classes',
    bookingSingular: 'Registration', bookingPlural: 'Registrations',
  },
  restaurant: {
    customerSingular: 'Guest', customerPlural: 'Guests',
    serviceSingular: 'Reservation', servicePlural: 'Reservations',
    bookingSingular: 'Reservation', bookingPlural: 'Reservations',
  },
})

const TEMPLATE_KEYS = new Set(Object.keys(TEMPLATE_TERMINOLOGY))
const BUSINESS_TYPE_TO_TEMPLATE = Object.freeze({
  general: 'general', dental: 'dental', physiotherapy: 'physiotherapy',
  salon: 'salon', learning_centre: 'learning_centre', restaurant: 'restaurant',
})

export const resolveReservationsConfiguration = ({
  templateKey,
  businessType,
  terminology = {},
  capabilities = {},
} = {}) => {
  const candidate = templateKey || BUSINESS_TYPE_TO_TEMPLATE[String(businessType || '').toLowerCase()]
  const resolvedTemplateKey = TEMPLATE_KEYS.has(candidate) ? candidate : 'general'
  return {
    templateKey: resolvedTemplateKey,
    terminology: {
      ...NEUTRAL_TERMINOLOGY,
      ...TEMPLATE_TERMINOLOGY[resolvedTemplateKey],
      ...Object.fromEntries(Object.entries(terminology).filter(([key, value]) => key in NEUTRAL_TERMINOLOGY && typeof value === 'string')),
    },
    capabilities: { ...capabilities },
  }
}
