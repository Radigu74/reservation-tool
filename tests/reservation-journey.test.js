import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCustomerJourney, getVisibleNavigation, isCustomerVisibleService, resolveJourneyConfiguration } from '../src/reservation-journey.js'

test('capability dependencies keep the internal service model available', () => {
  const config = resolveJourneyConfiguration({ capabilities: { services: false, scheduledSessions: true } })
  assert.equal(config.capabilities.services, true)
  assert.deepEqual(buildCustomerJourney({ capabilities: { services: false, teamResources: false, scheduledSessions: false } }), ['date-time', 'customer-form', 'confirmation'])
})

test('public service visibility excludes draft, archived and internal services', () => {
  assert.equal(isCustomerVisibleService({ is_active: true, is_published: true }), true)
  assert.equal(isCustomerVisibleService({ is_active: true, is_published: true, is_internal: true }), false)
  assert.equal(isCustomerVisibleService({ is_active: false, is_published: true }), false)
})

test('capability navigation hides conditional destinations only', () => {
  const nav = [{ route: 'admin' }, { route: 'admin/services' }, { route: 'admin/staff' }, { route: 'admin/analytics' }]
  assert.deepEqual(getVisibleNavigation(nav, { services: false, teamResources: false }).map(item => item.route), ['admin', 'admin/analytics'])
})
