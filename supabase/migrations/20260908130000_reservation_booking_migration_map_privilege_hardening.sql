-- The project-level default ACL grants broad table privileges to service_role.
-- Keep this migration map narrowly service-role-only and non-destructive.
alter table public.reservation_booking_migrations enable row level security;

revoke all privileges on table public.reservation_booking_migrations from public;
revoke all privileges on table public.reservation_booking_migrations from anon;
revoke all privileges on table public.reservation_booking_migrations from authenticated;
revoke all privileges on table public.reservation_booking_migrations from service_role;

grant select, insert, update on table public.reservation_booking_migrations to service_role;
