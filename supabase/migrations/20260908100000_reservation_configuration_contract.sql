-- Phase 2: canonical per-business Reservations configuration.
-- Existing rows remain valid and resolve through template/system fallbacks.

alter table public.reservation_business_settings
  add column if not exists template_key text,
  add column if not exists capabilities jsonb not null default '{}'::jsonb,
  add column if not exists terminology jsonb not null default '{}'::jsonb;

comment on column public.reservation_business_settings.template_key is
  'Explicit tenant template selection; null preserves fallback compatibility.';
comment on column public.reservation_business_settings.capabilities is
  'Tenant capability overrides layered over template defaults.';
comment on column public.reservation_business_settings.terminology is
  'Tenant terminology overrides layered over template and neutral defaults.';

alter table public.reservation_business_settings
  drop constraint if exists reservation_business_settings_template_key_check;

alter table public.reservation_business_settings
  add constraint reservation_business_settings_template_key_check
  check (template_key is null or template_key in (
    'general', 'dental', 'physiotherapy', 'salon', 'learning_centre', 'restaurant'
  ));

-- Initialize only missing template selections. Existing explicit selections,
-- capability overrides, terminology overrides, and booking settings survive.
-- Historical reservation rows are the strongest restaurant compatibility
-- signal. A supported non-restaurant profile repairs the old blanket
-- restaurant default; all other conflicts fall back to neutral/general.
insert into public.reservation_business_settings (business_id, template_key)
select
  business.id,
  case
    when exists (
      select 1 from public.reservations legacy
      where legacy.business_id = business.id
    ) then 'restaurant'
    when profile.industry_template in (
      'general', 'dental', 'physiotherapy', 'salon', 'learning_centre', 'restaurant'
    ) and profile.industry_template <> 'restaurant'
      and (
        business.business_type is null
        or business.business_type = 'restaurant'
        or business.business_type = profile.industry_template
        or business.business_type not in (
          'general', 'dental', 'physiotherapy', 'salon', 'learning_centre', 'restaurant'
        )
      ) then profile.industry_template
    when business.business_type in (
      'general', 'dental', 'physiotherapy', 'salon', 'learning_centre', 'restaurant'
    ) and (
      profile.industry_template is null
      or profile.industry_template = business.business_type
      or profile.industry_template not in (
        'general', 'dental', 'physiotherapy', 'salon', 'learning_centre', 'restaurant'
      )
    ) then business.business_type
    when profile.industry_template = 'restaurant'
      and (
        business.business_type is null
        or business.business_type = 'restaurant'
        or business.business_type not in (
          'general', 'dental', 'physiotherapy', 'salon', 'learning_centre', 'restaurant'
        )
      ) then 'restaurant'
    else 'general'
  end
from public.businesses business
left join public.business_profile profile on profile.business_id = business.id
on conflict (business_id) do update
set template_key = excluded.template_key,
    updated_at = now()
where public.reservation_business_settings.template_key is null;

-- Grants and RLS are separate Data API controls. Anonymous callers use the
-- narrow public RPC below; direct table access is tenant-scoped and signed-in.
alter table public.reservation_business_settings enable row level security;
revoke all on table public.reservation_business_settings from public, anon, authenticated;
grant select, insert, update on table public.reservation_business_settings to authenticated;
grant select, insert, update, delete on table public.reservation_business_settings to service_role;

drop policy if exists reservation_business_settings_public_read on public.reservation_business_settings;
drop policy if exists reservation_business_settings_member_read on public.reservation_business_settings;
create policy reservation_business_settings_member_read
on public.reservation_business_settings for select to authenticated
using ((select private.has_business_role(business_id)));

drop policy if exists reservation_business_settings_manager_insert on public.reservation_business_settings;
create policy reservation_business_settings_manager_insert
on public.reservation_business_settings for insert to authenticated
with check ((select private.has_business_role(business_id, array['owner','manager'])));

drop policy if exists reservation_business_settings_manager_update on public.reservation_business_settings;
create policy reservation_business_settings_manager_update
on public.reservation_business_settings for update to authenticated
using ((select private.has_business_role(business_id, array['owner','manager'])))
with check ((select private.has_business_role(business_id, array['owner','manager'])));

drop policy if exists reservation_business_settings_manager_delete on public.reservation_business_settings;

create or replace function public.get_public_reservations_configuration(p_business_slug text)
returns table (
  business_id bigint,
  template_key text,
  capabilities jsonb,
  terminology jsonb,
  booking_behavior text,
  confirmation_message text
)
language sql
stable
security definer
set search_path = ''
as $$
  select settings.business_id, settings.template_key, settings.capabilities,
    settings.terminology, settings.booking_behavior, settings.confirmation_message
  from public.businesses business
  join public.reservation_business_settings settings on settings.business_id = business.id
  where lower(business.business_slug) = lower(btrim(p_business_slug))
  limit 1;
$$;

revoke all on function public.get_public_reservations_configuration(text) from public, anon, authenticated;
grant execute on function public.get_public_reservations_configuration(text) to anon, authenticated;
