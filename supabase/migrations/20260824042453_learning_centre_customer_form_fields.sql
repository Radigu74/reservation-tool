alter table public.class_enrollments
  add column if not exists custom_data jsonb not null default '{}'::jsonb;

-- Keep one unambiguous RPC name for PostgREST. Existing clients can omit the
-- optional final argument while the updated Customer Form sends it.
drop function if exists public.create_public_class_enquiry(text,text,text,text,text,text,date,text,date,text,boolean);

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
  p_custom_data jsonb default null
)
returns table(reference text,remaining integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_service public.services%rowtype;
  v_enrolled integer;
  v_reference text;
  v_custom_data jsonb;
begin
  select s.* into v_service
  from public.services s
  join public.businesses b on b.id=s.business_id
  where lower(b.business_slug)=lower(p_business_slug)
    and lower(s.slug)=lower(p_service_slug)
    and s.is_active and s.is_published
    and s.enrollment_mode='cohort' and not s.enrollment_closed
  for update of s;

  if v_service.id is null then
    raise exception 'This class is not open for enquiries' using errcode='22023';
  end if;
  if nullif(btrim(p_guardian_name),'') is null
     or nullif(btrim(p_student_name),'') is null
     or nullif(btrim(p_customer_phone),'') is null
     or not coalesce(p_consent_to_contact,false) then
    raise exception 'Guardian name, student name, phone and permission to contact are required' using errcode='22023';
  end if;
  if p_custom_data is not null and jsonb_typeof(p_custom_data) <> 'object' then
    raise exception 'Customer Form answers must be an object' using errcode='22023';
  end if;

  select coalesce(jsonb_object_agg(f.id::text, p_custom_data->(f.id::text)), '{}'::jsonb)
  into v_custom_data
  from public.booking_custom_fields f
  where f.business_id=v_service.business_id
    and f.is_active and f.system_key is null
    and lower(btrim(f.field_label)) <> 'student name'
    and coalesce(p_custom_data,'{}'::jsonb) ? f.id::text;

  if length(v_custom_data::text)>20000 then
    raise exception 'Customer Form answers are too long' using errcode='22023';
  end if;

  if p_custom_data is not null and exists(
    select 1
    from public.booking_custom_fields f
    where f.business_id=v_service.business_id
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
    where f.business_id=v_service.business_id
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

  select coalesce(sum(quantity),0)::integer into v_enrolled
  from public.class_enrollments
  where service_id=v_service.id and status in ('pending','confirmed');
  if v_enrolled+1>v_service.capacity then
    raise exception 'This class no longer has enough enquiry places' using errcode='23P01';
  end if;

  v_reference:='EN-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.class_enrollments(
    business_id,service_id,reference,customer_name,guardian_name,customer_email,
    customer_phone,quantity,joins_on,status,notes,student_date_of_birth,
    school_grade,enquiry_status,consent_to_contact,custom_data
  ) values(
    v_service.business_id,v_service.id,v_reference,left(btrim(p_student_name),200),
    left(btrim(p_guardian_name),200),nullif(left(btrim(p_customer_email),320),''),
    left(btrim(p_customer_phone),50),1,
    greatest(coalesce(p_joins_on,current_date),v_service.cohort_start_date),'pending',
    nullif(left(btrim(p_notes),2000),''),p_student_date_of_birth,
    nullif(left(btrim(p_school_grade),100),''),'new',true,v_custom_data
  );

  return query select v_reference,v_service.capacity-v_enrolled-1;
end;
$$;

revoke all on function public.create_public_class_enquiry(text,text,text,text,text,text,date,text,date,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.create_public_class_enquiry(text,text,text,text,text,text,date,text,date,text,boolean,jsonb) to anon,authenticated;
