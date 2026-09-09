-- Phase 5.2: the sole transaction-safe legacy reservation migration path.
-- Historical migration files are intentionally not edited. This forward
-- migration replaces their callable behavior and introduces the guarded RPC.

create or replace function public.migrate_legacy_reservations_business(
  p_business_id bigint,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historical reservation migration RPC is disabled; use migrate_reservations_to_canonical_v2.'
    using errcode = '55000';
end;
$$;

create or replace function public.migrate_reservations_to_canonical_v2(
  p_business_id bigint,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses%rowtype;
  v_timezone text;
  v_service_id bigint;
  v_legacy_count integer := 0;
  v_mapped_count integer := 0;
  v_created_count integer := 0;
  v_repaired_count integer := 0;
  v_unresolved jsonb := '[]'::jsonb;
  v_recoverable jsonb := '[]'::jsonb;
  v_reservation public.reservations%rowtype;
  v_map public.reservation_booking_migrations%rowtype;
  v_booking public.bookings%rowtype;
  v_candidate timestamp without time zone;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_reference text;
  v_status text;
  v_custom_data jsonb;
  v_existing_count integer;
begin
  if p_business_id is null or p_business_id <= 0 then
    raise exception 'A positive business ID is required' using errcode = '22023';
  end if;

  -- Tenant-scoped advisory locking prevents same-business races while
  -- allowing independent businesses to migrate concurrently.
  perform pg_advisory_xact_lock(p_business_id);

  select * into v_business from public.businesses where id = p_business_id for update;
  if v_business.id is null then
    raise exception 'Reservations business not found' using errcode = 'P0002';
  end if;

  select count(*)::integer into v_legacy_count
  from public.reservations where business_id = p_business_id;

  if v_legacy_count > 0 then
    select timezone into v_timezone
    from public.restaurant_settings
    where business_id = p_business_id;
    if nullif(btrim(v_timezone), '') is null then
      raise exception 'A reviewed tenant timezone is required before migration' using errcode = '22023';
    end if;
    -- Invalid IANA timezone names fail here inside the transaction.
    perform now() at time zone v_timezone;

    select id into v_service_id
    from public.services
    where business_id = p_business_id
      and is_internal = true
      and is_active = true
      and is_published = true
    order by id
    limit 1;
    if v_service_id is null then
      raise exception 'An active published canonical internal service is required before migration' using errcode = '55000';
    end if;
  end if;

  select count(*)::integer into v_existing_count
  from public.reservation_booking_migrations m
  left join public.bookings b on b.id = m.booking_id
  where m.business_id = p_business_id
    and (b.id is null or b.business_id <> p_business_id);
  if v_existing_count > 0 then
    raise exception 'Migration map contains booking-without-booking or cross-tenant corruption' using errcode = '23514';
  end if;

  -- Dry-run validates every legacy candidate without writing. Apply repeats
  -- the same checks under the transaction lock before any insert occurs.
  for v_reservation in
    select * from public.reservations where business_id = p_business_id order by id
  loop
    v_status := lower(coalesce(nullif(btrim(v_reservation.status), ''), 'confirmed'));
    if v_status in ('canceled', 'archived') then v_status := 'cancelled'; end if;
    if v_status not in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show') then
      v_unresolved := v_unresolved || jsonb_build_array(jsonb_build_object('id', v_reservation.id, 'reason', 'unknown-status'));
    end if;
    if nullif(btrim(v_reservation.customer_name), '') is null
      or nullif(btrim(v_reservation.phone), '') is null then
      v_unresolved := v_unresolved || jsonb_build_array(jsonb_build_object('id', v_reservation.id, 'reason', 'missing-customer-identity'));
    end if;
    v_candidate := v_reservation.reservation_date + v_reservation.reservation_time;
    v_starts_at := v_candidate at time zone v_timezone;
    if (v_starts_at at time zone v_timezone) <> v_candidate then
      v_unresolved := v_unresolved || jsonb_build_array(jsonb_build_object('id', v_reservation.id, 'reason', 'invalid-local-time'));
    end if;
    if exists (
      select 1 from public.bookings b
      where b.business_id = p_business_id
        and b.custom_data->'migration'->>'source_table' = 'reservations'
        and b.custom_data->'migration'->>'source_id' = v_reservation.id::text
        and not exists (select 1 from public.reservation_booking_migrations m where m.legacy_reservation_id = v_reservation.id)
    ) then
      v_recoverable := v_recoverable || jsonb_build_array(jsonb_build_object('id', v_reservation.id, 'reason', 'booking-without-map'));
    elsif exists (
      select 1 from public.bookings b
      where b.id = v_reservation.id and b.business_id = p_business_id
        and not exists (select 1 from public.reservation_booking_migrations m where m.legacy_reservation_id = v_reservation.id)
    ) then
      v_unresolved := v_unresolved || jsonb_build_array(jsonb_build_object('id', v_reservation.id, 'reason', 'ambiguous-booking-without-map'));
    end if;
  end loop;

  if not p_apply then
    return jsonb_build_object(
      'mode', 'dry-run', 'business_id', p_business_id,
      'business_slug', v_business.business_slug,
      'booking_model_version', v_business.booking_model_version,
      'legacy_count', v_legacy_count,
      'mapping_count', (select count(*) from public.reservation_booking_migrations where business_id = p_business_id),
      'canonical_service_id', v_service_id,
      'unresolved', v_unresolved,
      'recoverable', v_recoverable,
      'ready', v_business.booking_model_version in (1, 2) and v_existing_count = 0 and jsonb_array_length(v_unresolved) = 0
    );
  end if;

  for v_reservation in
    select * from public.reservations where business_id = p_business_id order by id
  loop
    v_status := lower(coalesce(nullif(btrim(v_reservation.status), ''), 'confirmed'));
    if v_status = 'canceled' or v_status = 'archived' then v_status := 'cancelled'; end if;
    if v_status not in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show') then
      raise exception 'Unknown legacy reservation status for %: %', v_reservation.id, v_reservation.status using errcode = '22023';
    end if;
    if nullif(btrim(v_reservation.customer_name), '') is null
      or nullif(btrim(v_reservation.phone), '') is null then
      raise exception 'Customer identity is incomplete for legacy reservation %', v_reservation.id using errcode = '22023';
    end if;
    v_candidate := v_reservation.reservation_date + v_reservation.reservation_time;
    v_starts_at := v_candidate at time zone v_timezone;
    -- Round-trip validation rejects nonexistent DST wall times.
    if (v_starts_at at time zone v_timezone) <> v_candidate then
      raise exception 'Legacy local date/time is invalid in tenant timezone for %', v_reservation.id using errcode = '22023';
    end if;
    v_ends_at := v_starts_at + make_interval(mins => 60);
    v_reference := coalesce(nullif(btrim(v_reservation.reservation_reference), ''), 'LEGACY-' || upper(substr(replace(v_reservation.id::text, '-', ''), 1, 12)));

    select * into v_map from public.reservation_booking_migrations where legacy_reservation_id = v_reservation.id;
    if v_map.legacy_reservation_id is not null then
      select * into v_booking from public.bookings where id = v_map.booking_id;
      if v_booking.id is null then
        raise exception 'Migration map % points to a missing booking', v_reservation.id using errcode = '23514';
      end if;
      if v_map.business_id <> p_business_id or v_booking.business_id <> p_business_id
        or v_booking.service_id <> v_service_id
        or v_booking.reference <> v_reference
        or v_booking.customer_name is distinct from v_reservation.customer_name
        or v_booking.customer_phone is distinct from v_reservation.phone
        or v_booking.quantity <> greatest(coalesce(v_reservation.party_size, 1), 1)
        or v_booking.starts_at <> v_starts_at
        or v_booking.status <> v_status then
        raise exception 'Migration mapping reconciliation failed for %', v_reservation.id using errcode = '23514';
      end if;
      v_mapped_count := v_mapped_count + 1;
      continue;
    end if;

    -- Recover historical partial applies only when explicit source metadata
    -- proves the booking originated from this exact legacy reservation.
    select * into v_booking
    from public.bookings
    where business_id = p_business_id
      and custom_data->'migration'->>'source_table' = 'reservations'
      and custom_data->'migration'->>'source_id' = v_reservation.id::text;
    if v_booking.id is not null then
      if v_booking.service_id <> v_service_id
        or v_booking.reference <> v_reference
        or v_booking.customer_name is distinct from v_reservation.customer_name
        or v_booking.customer_phone is distinct from v_reservation.phone
        or v_booking.quantity <> greatest(coalesce(v_reservation.party_size, 1), 1)
        or v_booking.starts_at <> v_starts_at
        or v_booking.status <> v_status then
        raise exception 'Unproven booking-without-map state for %', v_reservation.id using errcode = '23514';
      end if;
      insert into public.reservation_booking_migrations
        (legacy_reservation_id, booking_id, business_id, legacy_reference, migration_version)
      values (v_reservation.id, v_booking.id, p_business_id, v_reservation.reservation_reference, 2);
      v_repaired_count := v_repaired_count + 1;
      v_mapped_count := v_mapped_count + 1;
      continue;
    end if;

    v_custom_data := coalesce(v_reservation.custom_data, '{}'::jsonb) || jsonb_build_object(
      'migration', jsonb_build_object(
        'source_table', 'reservations', 'source_id', v_reservation.id,
        'source_reference', v_reservation.reservation_reference,
        'source_status', v_reservation.status, 'source_timezone', v_timezone,
        'migration_version', 2, 'migrated_at', now()
      )
    );
    insert into public.bookings
      (business_id, service_id, customer_name, customer_phone, starts_at, ends_at,
       occupied_starts_at, occupied_ends_at, quantity, status, reference, notes,
       custom_data, created_at, updated_at)
    values
      (p_business_id, v_service_id, v_reservation.customer_name, v_reservation.phone,
       v_starts_at, v_ends_at, v_starts_at, v_ends_at,
       greatest(coalesce(v_reservation.party_size, 1), 1), v_status, v_reference,
       v_reservation.special_request, v_custom_data, coalesce(v_reservation.created_at, now()), now())
    returning * into v_booking;
    insert into public.reservation_booking_migrations
      (legacy_reservation_id, booking_id, business_id, legacy_reference, migration_version)
    values (v_reservation.id, v_booking.id, p_business_id, v_reservation.reservation_reference, 2);
    v_created_count := v_created_count + 1;
    v_mapped_count := v_mapped_count + 1;
  end loop;

  if v_mapped_count <> v_legacy_count then
    raise exception 'Reconciliation failed: legacy %, mapped %', v_legacy_count, v_mapped_count using errcode = '23514';
  end if;
  if exists (
    select 1 from public.reservation_booking_migrations m
    left join public.reservations r on r.id = m.legacy_reservation_id
    left join public.bookings b on b.id = m.booking_id
    where m.business_id = p_business_id
      and (r.id is null or r.business_id <> p_business_id or b.id is null or b.business_id <> p_business_id)
  ) then
    raise exception 'Reconciliation failed: orphaned migration mapping exists' using errcode = '23514';
  end if;

  update public.businesses set booking_model_version = 2 where id = p_business_id;
  return jsonb_build_object(
    'mode', 'applied', 'business_id', p_business_id, 'business_slug', v_business.business_slug,
    'legacy_count', v_legacy_count, 'mapped_count', v_mapped_count,
    'created_count', v_created_count, 'repaired_count', v_repaired_count,
    'canonical_service_id', v_service_id, 'booking_model_version', 2,
    'reconciled', true
  );
end;
$$;

revoke all on function public.migrate_legacy_reservations_business(bigint, boolean) from public, anon, authenticated;
grant execute on function public.migrate_legacy_reservations_business(bigint, boolean) to service_role;
revoke all on function public.migrate_reservations_to_canonical_v2(bigint, boolean) from public, anon, authenticated;
grant execute on function public.migrate_reservations_to_canonical_v2(bigint, boolean) to service_role;

comment on function public.migrate_reservations_to_canonical_v2(bigint, boolean) is
  'The sole service-role-only, tenant-scoped, transaction-safe legacy reservation migration and reconciliation path.';
