-- Phase 3 Customer Form contract. Existing RPC signatures remain available;
-- these overloads add validated custom_data without changing the journey.
create or replace function private.normalize_public_customer_form_data(
  p_business_id bigint,
  p_custom_data jsonb,
  p_excluded_field_labels text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  field public.booking_custom_fields%rowtype;
  value jsonb;
  result jsonb := '{}'::jsonb;
  labels jsonb := '{}'::jsonb;
  text_value text;
begin
  if p_custom_data is null or jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'Customer Form answers must be an object' using errcode = '22023';
  end if;
  for field in
    select * from public.booking_custom_fields
    where business_id = p_business_id and is_active and system_key is null
      and not (
        lower(btrim(field_label)) = any(coalesce(p_excluded_field_labels, '{}'::text[]))
      )
  loop
    value := p_custom_data->field.id::text;
    text_value := case when value is null or value = 'null'::jsonb then null else value #>> '{}' end;
    if field.field_type = 'select' then field.field_type := 'dropdown'; end if;
    if field.field_type not in ('text', 'textarea', 'dropdown', 'checkbox', 'email', 'phone', 'number', 'date') then
      raise exception 'Unsupported Customer Form field type: %', field.field_type using errcode = '22023';
    end if;
    if field.is_required and (
      (field.field_type = 'checkbox' and value is distinct from 'true'::jsonb)
      or (field.field_type <> 'checkbox' and nullif(btrim(coalesce(text_value, '')), '') is null)
    ) then
      raise exception 'Complete all required customer form fields' using errcode = '22023';
    end if;
    if value is not null and value <> 'null'::jsonb and field.field_type = 'checkbox'
      and jsonb_typeof(value) <> 'boolean' then
      raise exception 'Customer Form checkbox answers must be boolean' using errcode = '22023';
    end if;
    if value is not null and value <> 'null'::jsonb and field.field_type <> 'checkbox'
      and jsonb_typeof(value) <> 'string' and field.field_type <> 'number' then
      raise exception 'Customer Form answers must use the configured field type' using errcode = '22023';
    end if;
    if value is not null and value <> 'null'::jsonb and field.field_type = 'dropdown' and not exists (
      select 1 from regexp_split_to_table(coalesce(field.field_options, ''), E'\\r?\\n') option_value
      where btrim(option_value) = text_value
    ) then
      raise exception 'Choose a valid Customer Form option' using errcode = '22023';
    end if;
    if value is not null and value <> 'null'::jsonb and field.field_type = 'email'
      and text_value !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Enter a valid email address' using errcode = '22023';
    end if;
    if value is not null and value <> 'null'::jsonb and field.field_type = 'phone'
      and (length(btrim(text_value)) < 3 or length(text_value) > 50) then
      raise exception 'Enter a valid phone number' using errcode = '22023';
    end if;
    if value is not null and value <> 'null'::jsonb and field.field_type = 'number' then
      if jsonb_typeof(value) not in ('number', 'string') or text_value !~ '^-?[0-9]+([.][0-9]+)?$' then
        raise exception 'Enter a valid number' using errcode = '22023';
      end if;
      value := to_jsonb(text_value::numeric);
    end if;
    if value is not null and value <> 'null'::jsonb and field.field_type = 'date' then
      if text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Enter a valid date' using errcode = '22023';
      end if;
      perform text_value::date;
    end if;
    if value is not null and value <> 'null'::jsonb then
      if length(coalesce(text_value, value::text)) > (case when field.field_type = 'textarea' then 2000 else 500 end) then
        raise exception 'Customer Form answer is too long' using errcode = '22023';
      end if;
      result := result || jsonb_build_object(field.id::text, value);
      labels := labels || jsonb_build_object(field.id::text, field.field_label);
    end if;
  end loop;
  if labels <> '{}'::jsonb then result := result || jsonb_build_object('_field_labels', labels); end if;
  if length(result::text) > 20000 then raise exception 'Customer Form answers are too long' using errcode = '22023'; end if;
  return result;
end;
$$;

-- Restaurant bookings use the same database-owned answer and label contract.
-- customer_email remains a system value and is persisted in its canonical
-- bookings column rather than trusted as arbitrary custom data.
create or replace function public.create_public_restaurant_reservation(
  p_business_slug text,
  p_customer_name text,
  p_phone text,
  p_reservation_date date,
  p_reservation_time time without time zone,
  p_party_size integer,
  p_special_request text default null,
  p_custom_data jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id bigint;
  v_booking public.bookings%rowtype;
  v_customer_email text;
  v_custom_data jsonb;
begin
  select id into v_business_id
  from public.businesses
  where lower(business_slug) = lower(nullif(btrim(p_business_slug), ''))
    and booking_model_version = 2;
  if v_business_id is null then
    raise exception 'Reservations are not configured for this business' using errcode = 'P0002';
  end if;

  v_customer_email := nullif(btrim(coalesce(p_custom_data->>'customer_email', '')), '');
  v_custom_data := private.normalize_public_customer_form_data(
    v_business_id, coalesce(p_custom_data, '{}'::jsonb)
  );
  v_booking := public.create_canonical_restaurant_booking(
    v_business_id, p_customer_name, p_phone, p_reservation_date,
    p_reservation_time, p_party_size, p_special_request, v_custom_data,
    v_customer_email
  );
  return v_booking.reference;
end;
$$;

-- Class enquiries are persisted separately from bookings by design, but their
-- shared Customer Form answers use the same validation and label snapshots.
create or replace function public.create_public_class_enquiry(
  p_business_slug text,
  p_service_slug text,
  p_guardian_name text,
  p_student_name text,
  p_customer_email text,
  p_customer_phone text,
  p_student_date_of_birth date,
  p_school_grade text,
  p_joins_on date,
  p_notes text,
  p_consent_to_contact boolean,
  p_custom_data jsonb default null
)
returns table(reference text, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.services%rowtype;
  v_enrolled integer;
  v_reference text;
  v_custom_data jsonb;
begin
  select service.* into v_service
  from public.services service
  join public.businesses business on business.id = service.business_id
  where lower(business.business_slug) = lower(p_business_slug)
    and lower(service.slug) = lower(p_service_slug)
    and service.is_active and service.is_published
    and service.enrollment_mode = 'cohort' and not service.enrollment_closed
  for update of service;

  if v_service.id is null then
    raise exception 'This class is not open for enquiries' using errcode = '22023';
  end if;
  if nullif(btrim(p_guardian_name), '') is null
    or nullif(btrim(p_student_name), '') is null
    or nullif(btrim(p_customer_phone), '') is null
    or not coalesce(p_consent_to_contact, false) then
    raise exception 'Guardian name, student name, phone and permission to contact are required' using errcode = '22023';
  end if;

  v_custom_data := private.normalize_public_customer_form_data(
    v_service.business_id,
    coalesce(p_custom_data, '{}'::jsonb),
    array['student name']::text[]
  );
  select coalesce(sum(quantity), 0)::integer into v_enrolled
  from public.class_enrollments
  where service_id = v_service.id and status in ('pending', 'confirmed');
  if v_enrolled + 1 > v_service.capacity then
    raise exception 'This class no longer has enough enquiry places' using errcode = '23P01';
  end if;

  v_reference := 'EN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.class_enrollments(
    business_id, service_id, reference, customer_name, guardian_name,
    customer_email, customer_phone, quantity, joins_on, status, notes,
    student_date_of_birth, school_grade, enquiry_status, consent_to_contact,
    custom_data
  ) values (
    v_service.business_id, v_service.id, v_reference,
    left(btrim(p_student_name), 200), left(btrim(p_guardian_name), 200),
    nullif(left(btrim(p_customer_email), 320), ''),
    left(btrim(p_customer_phone), 50), 1,
    greatest(coalesce(p_joins_on, current_date), v_service.cohort_start_date),
    'pending', nullif(left(btrim(p_notes), 2000), ''),
    p_student_date_of_birth, nullif(left(btrim(p_school_grade), 100), ''),
    'new', true, v_custom_data
  );
  return query select v_reference, v_service.capacity - v_enrolled - 1;
end;
$$;

create or replace function public.create_public_booking(
  p_business_slug text, p_service_slug text, p_staff_slug text,
  p_starts_at timestamptz, p_customer_name text,
  p_customer_email text, p_customer_phone text,
  p_notes text, p_custom_data jsonb
)
returns table (booking_id uuid, reference text, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare created record; business_id bigint;
begin
  select b.id into business_id from public.businesses b where lower(b.business_slug)=lower(p_business_slug);
  if business_id is null then raise exception 'Service or staff member not found' using errcode='P0002'; end if;
  select * into created from public.create_public_booking(p_business_slug,p_service_slug,p_staff_slug,p_starts_at,p_customer_name,p_customer_email,p_customer_phone,p_notes);
  update public.bookings set custom_data=private.normalize_public_customer_form_data(business_id,p_custom_data)
  where id=created.booking_id;
  return query select created.booking_id,created.reference,created.starts_at,created.ends_at;
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
declare created record; business_id bigint;
begin
  select b.id into business_id from public.businesses b where lower(b.business_slug)=lower(p_business_slug);
  if business_id is null then raise exception 'Service or session not found' using errcode='P0002'; end if;
  select * into created from public.create_public_session_booking(p_business_slug,p_service_slug,p_session_id,p_customer_name,p_customer_email,p_customer_phone,p_notes,p_quantity);
  update public.bookings set custom_data=private.normalize_public_customer_form_data(business_id,p_custom_data)
  where id=created.booking_id;
  return query select created.booking_id,created.reference,created.starts_at,created.ends_at;
end;
$$;

-- Keep the admin writer on the same authoritative eight-type contract.
create or replace function public.save_booking_customer_form(
  p_business_id bigint,
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  field jsonb;
  requested_id bigint;
  inserted_id bigint;
  existing public.booking_custom_fields%rowtype;
  requested_type text;
  requested_options text;
  requested_label text;
  requested_order integer;
  seen_ids bigint[] := array[]::bigint[];
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not (select private.has_business_role(p_business_id, array['owner', 'manager'])) then
    raise exception 'You do not have permission to manage this Customer Form';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then raise exception 'Customer Form fields must be an array'; end if;
  if jsonb_array_length(p_fields) > 50 then raise exception 'Customer Form supports a maximum of 50 fields'; end if;

  for field in select value from jsonb_array_elements(p_fields)
  loop
    if jsonb_typeof(field) <> 'object' then raise exception 'Each Customer Form field must be an object'; end if;
    requested_id := nullif(field->>'id', '')::bigint;
    requested_label := btrim(coalesce(field->>'field_label', ''));
    requested_type := case when field->>'field_type' = 'select' then 'dropdown' else lower(field->>'field_type') end;
    requested_options := nullif(btrim(coalesce(field->>'field_options', '')), '');
    requested_order := coalesce((field->>'display_order')::integer, 0);

    if requested_label = '' then raise exception 'Every Customer Form field needs a label'; end if;
    if length(requested_label) > 200 then raise exception 'Customer Form field labels are too long'; end if;
    if requested_type is null or requested_type not in ('text', 'textarea', 'dropdown', 'checkbox', 'email', 'phone', 'number', 'date') then
      raise exception 'Unsupported Customer Form field type: %', requested_type;
    end if;
    if requested_type = 'dropdown' and requested_options is null then raise exception 'Dropdown fields require options'; end if;

    if requested_id is not null then
      select * into existing from public.booking_custom_fields
      where id = requested_id and business_id = p_business_id for update;
      if not found then raise exception 'Customer Form field does not belong to this business'; end if;

      if existing.is_locked then
        if existing.field_label is distinct from requested_label
          or (case when existing.field_type='select' then 'dropdown' else existing.field_type end) is distinct from requested_type
          or existing.is_required is distinct from coalesce((field->>'is_required')::boolean, false)
          or existing.field_options is distinct from requested_options then
          raise exception 'Locked Customer Form fields cannot be changed';
        end if;
        update public.booking_custom_fields set display_order=requested_order,is_active=true
        where id=requested_id and business_id=p_business_id;
      else
        update public.booking_custom_fields
        set field_label=requested_label,field_type=requested_type,
            field_options=case when requested_type='dropdown' then requested_options else null end,
            is_required=coalesce((field->>'is_required')::boolean,false),
            display_order=requested_order,is_active=true
        where id=requested_id and business_id=p_business_id;
      end if;
      seen_ids := array_append(seen_ids, requested_id);
    else
      insert into public.booking_custom_fields
        (business_id,field_label,field_type,field_options,is_required,display_order,is_active,is_locked)
      values
        (p_business_id,requested_label,requested_type,
         case when requested_type='dropdown' then requested_options else null end,
         coalesce((field->>'is_required')::boolean,false),requested_order,true,false)
      returning id into inserted_id;
      seen_ids := array_append(seen_ids, inserted_id);
    end if;
  end loop;

  update public.booking_custom_fields set is_active=false
  where business_id=p_business_id and not is_locked and not (id=any(seen_ids));
end;
$$;

revoke all on function private.normalize_public_customer_form_data(bigint,jsonb,text[]) from public, anon, authenticated;
revoke all on function public.save_booking_customer_form(bigint,jsonb) from public, anon;
revoke all on function public.create_public_restaurant_reservation(text,text,text,date,time without time zone,integer,text,jsonb) from public;
revoke all on function public.create_public_class_enquiry(text,text,text,text,text,text,date,text,date,text,boolean,jsonb) from public;
revoke all on function public.create_public_booking(text,text,text,timestamptz,text,text,text,text,jsonb) from public;
revoke all on function public.create_public_session_booking(text,text,bigint,text,text,text,text,integer,jsonb) from public;
grant execute on function public.save_booking_customer_form(bigint,jsonb) to authenticated;
grant execute on function public.create_public_restaurant_reservation(text,text,text,date,time without time zone,integer,text,jsonb) to anon, authenticated;
grant execute on function public.create_public_class_enquiry(text,text,text,text,text,text,date,text,date,text,boolean,jsonb) to anon, authenticated;
grant execute on function public.create_public_booking(text,text,text,timestamptz,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.create_public_session_booking(text,text,bigint,text,text,text,text,integer,jsonb) to anon, authenticated;
