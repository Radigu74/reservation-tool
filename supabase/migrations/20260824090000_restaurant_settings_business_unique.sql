-- restaurant_settings is one row per Reservations business. The management
-- settings flow uses ON CONFLICT (business_id), so keep that invariant in
-- source-controlled migrations as well as production.
create unique index if not exists restaurant_settings_business_id_key
  on public.restaurant_settings (business_id);
