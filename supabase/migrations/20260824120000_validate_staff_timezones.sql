-- Keep staff calendar timezones valid so date-based operations, including
-- centre closures, can always convert local dates to timestamps.

create or replace function private.validate_staff_timezone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.timezone := case lower(btrim(new.timezone))
    when 'philippines' then 'Asia/Manila'
    else btrim(new.timezone)
  end;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_name
    where timezone_name.name = new.timezone
  ) then
    raise exception 'Choose a valid timezone such as Asia/Manila'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

update public.staff_members
set timezone = 'Asia/Manila'
where lower(btrim(timezone)) = 'philippines';

drop trigger if exists validate_staff_timezone on public.staff_members;
create trigger validate_staff_timezone
before insert or update of timezone on public.staff_members
for each row execute function private.validate_staff_timezone();

revoke all on function private.validate_staff_timezone() from public, anon, authenticated;

comment on function private.validate_staff_timezone() is
  'Normalizes the legacy Philippines label and rejects timezone values PostgreSQL cannot use.';
