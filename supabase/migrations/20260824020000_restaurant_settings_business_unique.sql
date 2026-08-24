-- restaurant_settings is one row per Reservations business.
-- Application upserts use ON CONFLICT (business_id), so fresh environments must
-- carry the same uniqueness invariant as production.
create unique index if not exists restaurant_settings_business_id_key
  on public.restaurant_settings (business_id);
