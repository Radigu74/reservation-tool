-- Explicit, tenant-scoped identity for legacy-to-canonical reconciliation.
-- This table is metadata only; legacy reservations remain untouched.
create table if not exists public.reservation_booking_migrations (
  legacy_reservation_id uuid primary key references public.reservations(id) on delete restrict,
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  business_id bigint not null references public.businesses(id) on delete restrict,
  legacy_reference text,
  migration_version integer not null default 1,
  migrated_at timestamptz not null default now(),
  constraint reservation_booking_migrations_business_identity_unique
    unique (business_id, legacy_reservation_id)
);

create index if not exists reservation_booking_migrations_business_idx
  on public.reservation_booking_migrations (business_id, migrated_at desc);

alter table public.reservation_booking_migrations enable row level security;
revoke all on table public.reservation_booking_migrations from public, anon, authenticated;
grant select, insert, update on public.reservation_booking_migrations to service_role;

comment on table public.reservation_booking_migrations is
  'Auditable identity map from legacy reservations to canonical bookings; written only by controlled service-role reconciliation.';
