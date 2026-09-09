-- Services OFF still uses the existing service-based availability and booking
-- model, but explicitly marks the canonical service as non-customer-visible.
alter table public.services add column if not exists is_internal boolean not null default false;
create index if not exists services_business_internal_visibility_idx
  on public.services (business_id, is_internal, is_active, is_published);

update public.services
set is_internal = true
where booking_type = 'restaurant' and slug = 'restaurant-reservation';

-- Internal services may remain published because canonical availability RPCs
-- require publication. Public list visibility is controlled explicitly here.
drop policy if exists "services_public_read" on public.services;
create policy "services_public_read"
  on public.services for select to anon
  using (is_active and is_published and not is_internal);

drop policy if exists "services_authenticated_read" on public.services;
create policy "services_authenticated_read"
  on public.services for select to authenticated
  using (
    (is_active and is_published and not is_internal)
    or (select private.has_business_role(business_id))
  );

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
  select service.id, service.duration_minutes, service.slot_interval_minutes,
    service.capacity, settings.opening_time, settings.closing_time, settings.timezone
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

comment on column public.services.is_internal is
  'Internal service used by capability-driven booking infrastructure; never expose as a customer service choice.';
