-- Forward-only production hotfix: the Customer Form overloads must not use a
-- PL/pgSQL variable that is also a column on public.bookings.

create or replace function public.create_public_booking(
  p_business_slug text, p_service_slug text, p_staff_slug text,
  p_starts_at timestamptz, p_customer_name text,
  p_customer_email text, p_customer_phone text,
  p_notes text, p_custom_data jsonb
)
returns table (booking_id uuid, reference text, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_created record;
  v_business_id bigint;
begin
  select b.id into v_business_id
  from public.businesses b
  where lower(b.business_slug) = lower(p_business_slug);
  if v_business_id is null then
    raise exception 'Service or staff member not found' using errcode = 'P0002';
  end if;

  select * into v_created
  from public.create_public_booking(
    p_business_slug, p_service_slug, p_staff_slug, p_starts_at,
    p_customer_name, p_customer_email, p_customer_phone, p_notes
  );

  update public.bookings booking
  set custom_data = private.normalize_public_customer_form_data(v_business_id, p_custom_data)
  where booking.id = v_created.booking_id;

  return query select v_created.booking_id, v_created.reference, v_created.starts_at, v_created.ends_at;
end;
$$;

create or replace function public.create_public_session_booking(
  p_business_slug text, p_service_slug text, p_session_id bigint,
  p_customer_name text, p_customer_email text,
  p_customer_phone text, p_notes text,
  p_quantity integer, p_custom_data jsonb
)
returns table (booking_id uuid, reference text, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_created record;
  v_business_id bigint;
begin
  select b.id into v_business_id
  from public.businesses b
  where lower(b.business_slug) = lower(p_business_slug);
  if v_business_id is null then
    raise exception 'Service or session not found' using errcode = 'P0002';
  end if;

  select * into v_created
  from public.create_public_session_booking(
    p_business_slug, p_service_slug, p_session_id, p_customer_name,
    p_customer_email, p_customer_phone, p_notes, p_quantity
  );

  update public.bookings booking
  set custom_data = private.normalize_public_customer_form_data(v_business_id, p_custom_data)
  where booking.id = v_created.booking_id;

  return query select v_created.booking_id, v_created.reference, v_created.starts_at, v_created.ends_at;
end;
$$;

revoke all on function public.create_public_booking(text,text,text,timestamptz,text,text,text,text,jsonb) from public;
revoke all on function public.create_public_session_booking(text,text,bigint,text,text,text,text,integer,jsonb) from public;
grant execute on function public.create_public_booking(text,text,text,timestamptz,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.create_public_session_booking(text,text,bigint,text,text,text,text,integer,jsonb) to anon, authenticated;
