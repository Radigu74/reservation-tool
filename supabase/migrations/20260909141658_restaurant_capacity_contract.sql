-- Restaurant capacity is tenant configuration. The internal service remains
-- the canonical operational booking target, but its generic capacity must not
-- override restaurant_settings.max_guests_per_slot.
create or replace function private.get_canonical_restaurant_context(
  p_business_id bigint
)
returns table (
  service_id bigint,
  duration_minutes integer,
  slot_interval_minutes integer,
  capacity integer,
  opening_time time,
  closing_time time,
  timezone text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    service.id,
    service.duration_minutes,
    service.slot_interval_minutes,
    settings.max_guests_per_slot,
    settings.opening_time,
    settings.closing_time,
    settings.timezone
  from public.businesses business
  join public.services service on service.business_id = business.id
  join public.restaurant_settings settings on settings.business_id = business.id
  where business.id = p_business_id
    and business.booking_model_version = 2
    and service.booking_type = 'restaurant'
    and service.is_internal
    and service.is_active
    and service.is_published
  order by service.id
  limit 1;
$$;
