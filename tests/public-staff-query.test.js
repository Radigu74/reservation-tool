import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import {
  PUBLIC_ASSIGNMENT_PROJECTION,
  PUBLIC_SERVICE_PROJECTION,
  PUBLIC_STAFF_PROJECTION,
  publicRows,
} from '../src/public-booking-data.js'
import { resolveReservationsConfiguration } from '../src/reservation-configuration.js'

test('restricted public staff columns reject wildcard reads and allow the approved projection', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create table public.staff_members (
        id bigint primary key, business_id bigint not null, user_id uuid,
        display_name text not null, slug text not null, bio text, photo_url text,
        timezone text not null, is_active boolean not null,
        is_published boolean not null, created_at timestamptz,
        updated_at timestamptz, login_email text
      );
      insert into public.staff_members values (
        1,35,gen_random_uuid(),'Synthetic Team member','synthetic-staff',
        'Public profile',null,'Asia/Singapore',true,true,now(),now(),
        'private@example.invalid'
      );
      revoke all on public.staff_members from anon;
      grant select (
        id,display_name,slug,bio,photo_url,timezone,is_active,is_published
      ) on public.staff_members to anon;
      set role anon;
    `)

    await assert.rejects(
      () => db.query('select staff.* from public.staff_members staff'),
      error => error.code === '42501',
    )

    const safe = await db.query(`select ${PUBLIC_STAFF_PROJECTION} from public.staff_members`)
    assert.deepEqual(Object.keys(safe.rows[0]), [
      'id', 'display_name', 'slug', 'bio', 'photo_url', 'timezone',
      'is_active', 'is_published',
    ])
    assert.equal(safe.rows[0].display_name, 'Synthetic Team member')
    for (const privateField of ['user_id', 'login_email', 'created_at', 'updated_at']) {
      assert.equal(privateField in safe.rows[0], false)
    }
  } finally {
    await db.close()
  }
})

test('public booking projections and nullable responses are fail-safe', async () => {
  const source = await readFile(new URL('../src/public-booking.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /staff_members!inner\(\*\)/)
  assert.doesNotMatch(source, /from\('staff_members'\)\.select\('\*'\)/)
  assert.doesNotMatch(source, /from\('services'\)\.select\('\*'\)/)
  assert.doesNotMatch(source, /from\('staff_services'\)\.select\('\*'\)/)
  assert.ok(source.includes('staff_members!inner(${PUBLIC_STAFF_PROJECTION})'))
  assert.ok(PUBLIC_SERVICE_PROJECTION.includes('scheduling_mode'))
  assert.ok(PUBLIC_ASSIGNMENT_PROJECTION.includes('custom_duration_minutes'))

  for (const value of [null, undefined, {}, []]) {
    assert.deepEqual(publicRows(value), [])
    assert.doesNotThrow(() => publicRows(value).map(item => item))
  }
})

test('the shared public staff path retains template terminology', () => {
  const expected = {
    general: ['Service', 'Team member'],
    dental: ['Treatment', 'Dentist'],
    physiotherapy: ['Treatment', 'Therapist'],
    salon: ['Service', 'Stylist'],
    learning_centre: ['Class', 'Teacher'],
  }
  for (const [templateKey, [service, teamMember]] of Object.entries(expected)) {
    const { terminology } = resolveReservationsConfiguration({ templateKey })
    assert.equal(terminology.serviceSingular, service)
    assert.equal(terminology.teamMemberSingular, teamMember)
  }
})
