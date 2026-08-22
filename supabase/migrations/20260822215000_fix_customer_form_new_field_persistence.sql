-- Ensure newly inserted Customer Form fields remain active during the same atomic save.
-- The previous implementation inserted new rows but did not add their generated IDs
-- to seen_ids, so the cleanup step immediately marked them inactive.

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
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not (select private.has_business_role(p_business_id, array['owner', 'manager'])) then
    raise exception 'You do not have permission to manage this Customer Form';
  end if;

  if jsonb_typeof(p_fields) <> 'array' then
    raise exception 'Customer Form fields must be an array';
  end if;

  if jsonb_array_length(p_fields) > 50 then
    raise exception 'Customer Form supports a maximum of 50 fields';
  end if;

  for field in select value from jsonb_array_elements(p_fields)
  loop
    requested_id := nullif(field->>'id', '')::bigint;
    requested_label := btrim(coalesce(field->>'field_label', ''));
    requested_type := case when field->>'field_type' = 'select' then 'dropdown' else field->>'field_type' end;
    requested_options := nullif(btrim(coalesce(field->>'field_options', '')), '');
    requested_order := coalesce((field->>'display_order')::integer, 0);

    if requested_label = '' then
      raise exception 'Every Customer Form field needs a label';
    end if;
    if requested_type not in ('text', 'textarea', 'dropdown', 'checkbox') then
      raise exception 'Unsupported Customer Form field type: %', requested_type;
    end if;
    if requested_type = 'dropdown' and requested_options is null then
      raise exception 'Dropdown fields require options';
    end if;

    if requested_id is not null then
      select * into existing
      from public.booking_custom_fields
      where id = requested_id and business_id = p_business_id
      for update;

      if not found then
        raise exception 'Customer Form field does not belong to this business';
      end if;

      if existing.is_locked then
        if existing.field_label is distinct from requested_label
          or existing.field_type is distinct from requested_type
          or existing.is_required is distinct from coalesce((field->>'is_required')::boolean, false)
          or existing.field_options is distinct from requested_options then
          raise exception 'Locked Customer Form fields cannot be changed';
        end if;

        update public.booking_custom_fields
        set display_order = requested_order,
            is_active = true
        where id = requested_id and business_id = p_business_id;
      else
        update public.booking_custom_fields
        set field_label = requested_label,
            field_type = requested_type,
            field_options = case when requested_type = 'dropdown' then requested_options else null end,
            is_required = coalesce((field->>'is_required')::boolean, false),
            display_order = requested_order,
            is_active = true
        where id = requested_id and business_id = p_business_id;
      end if;

      seen_ids := array_append(seen_ids, requested_id);
    else
      insert into public.booking_custom_fields (
        business_id,
        field_label,
        field_type,
        field_options,
        is_required,
        display_order,
        is_active,
        is_locked
      ) values (
        p_business_id,
        requested_label,
        requested_type,
        case when requested_type = 'dropdown' then requested_options else null end,
        coalesce((field->>'is_required')::boolean, false),
        requested_order,
        true,
        false
      )
      returning id into inserted_id;

      -- Critical fix: include the newly generated ID in the keep-list so the
      -- cleanup below does not immediately deactivate the row we just inserted.
      seen_ids := array_append(seen_ids, inserted_id);
    end if;
  end loop;

  update public.booking_custom_fields
  set is_active = false
  where business_id = p_business_id
    and not is_locked
    and not (id = any(seen_ids));
end;
$$;

revoke all on function public.save_booking_customer_form(bigint, jsonb) from public, anon;
grant execute on function public.save_booking_customer_form(bigint, jsonb) to authenticated;
