alter table public.class_enrollments
  add column if not exists custom_data jsonb not null default '{}'::jsonb;

-- This overload is additive: existing clients continue using the original
-- eleven-argument function while the updated form sends p_custom_data.
create function public.create_public_class_enquiry(
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
  p_custom_data jsonb
)
returns table(reference text,remaining integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_business_id bigint;
  v_custom_data jsonb;
  v_result record;
begin
  select b.id into v_business_id
  from public.businesses b
  join public.services s on s.business_id=b.id
  where lower(b.business_slug)=lower(p_business_slug)
    and lower(s.slug)=lower(p_service_slug)
    and s.is_active and s.is_published
    and s.enrollment_mode='cohort' and not s.enrollment_closed;

  if v_business_id is null then
    raise exception 'This class is not open for enquiries' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_custom_data,'{}'::jsonb)) <> 'object' then
    raise exception 'Customer Form answers must be an object' using errcode='22023';
  end if;

  select coalesce(jsonb_object_agg(f.id::text, p_custom_data->(f.id::text)), '{}'::jsonb)
  into v_custom_data
  from public.booking_custom_fields f
  where f.business_id=v_business_id
    and f.is_active and f.system_key is null
    and lower(btrim(f.field_label)) <> 'student name'
    and coalesce(p_custom_data,'{}'::jsonb) ? f.id::text;

  if length(v_custom_data::text)>20000 then
    raise exception 'Customer Form answers are too long' using errcode='22023';
  end if;

  if exists(
    select 1
    from public.booking_custom_fields f
    where f.business_id=v_business_id
      and f.is_active and f.is_required and f.system_key is null
      and lower(btrim(f.field_label)) <> 'student name'
      and case
        when f.field_type='checkbox' then v_custom_data->(f.id::text) is distinct from 'true'::jsonb
        else nullif(btrim(coalesce(v_custom_data->>f.id::text,'')),'') is null
      end
  ) then
    raise exception 'Complete all required customer form fields' using errcode='22023';
  end if;

  if exists(
    select 1
    from public.booking_custom_fields f
    where f.business_id=v_business_id
      and f.is_active and f.field_type='dropdown' and f.system_key is null
      and lower(btrim(f.field_label)) <> 'student name'
      and v_custom_data ? f.id::text
      and not exists(
        select 1
        from regexp_split_to_table(coalesce(f.field_options,''), E'\\r?\\n') option_value
        where btrim(option_value)=v_custom_data->>f.id::text
      )
  ) then
    raise exception 'Choose a valid Customer Form option' using errcode='22023';
  end if;

  select * into v_result
  from public.create_public_class_enquiry(
    p_business_slug,p_service_slug,p_guardian_name,p_student_name,
    p_customer_email,p_customer_phone,p_student_date_of_birth,p_school_grade,
    p_joins_on,p_notes,p_consent_to_contact
  );

  update public.class_enrollments
  set custom_data=v_custom_data
  where business_id=v_business_id and class_enrollments.reference=v_result.reference;

  return query select v_result.reference::text,v_result.remaining::integer;
end;
$$;

revoke all on function public.create_public_class_enquiry(text,text,text,text,text,text,date,text,date,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.create_public_class_enquiry(text,text,text,text,text,text,date,text,date,text,boolean,jsonb) to anon,authenticated;
