-- Insurance and national identifiers remain private to existing server-authorized
-- patient/doctor endpoints. No browser grants or RLS policies are broadened.
alter table public.patient_insurances
  add column if not exists coverage_type text not null default 'base';
alter table public.patient_insurances
  add constraint patient_insurances_coverage_type_check
  check (coverage_type in ('base','supplementary','none'));
comment on column public.patient_insurances.coverage_type is
  'User-declared coverage category. Existing records retain the base default; this is not insurer verification.';

create or replace function public.drman_valid_national_code(code text)
returns boolean language plpgsql immutable strict security invoker
set search_path = '' as $$
declare total integer := 0; remainder integer; i integer;
begin
  if code !~ '^[0-9]{10}$' or code ~ '^([0-9])\1{9}$'
    or code in ('0123456789','1234567891','9876543210')
    or code ~ '^000' or code ~ '^[0-9]{3}0{6}[0-9]$' then return false; end if;
  for i in 1..9 loop total := total + substring(code,i,1)::integer * (11-i); end loop;
  remainder := total % 11;
  return substring(code,10,1)::integer = case when remainder < 2 then remainder else 11-remainder end;
end $$;
revoke all on function public.drman_valid_national_code(text) from public,anon,authenticated;
grant execute on function public.drman_valid_national_code(text) to service_role;

create or replace function public.drman_require_prescription_registration()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare code text; today date := (now() at time zone 'Asia/Tehran')::date;
begin
  -- Incomplete insurance must not block drafts, cancellation or clinical notes.
  if new.status <> 'active' then return new; end if;
  select national_code into code from public.patients where id = new.patient_id;
  if not coalesce(public.drman_valid_national_code(code),false) or not exists (
    select 1 from public.patient_insurances i where i.patient_id = new.patient_id
      and i.coverage_type = 'base' and length(trim(i.provider_name)) > 0
      and trim(i.provider_name) !~* '^(none|uninsured|بدون\s*بیمه|بیمه\s*ندارم|ندارم|فاقد\s*بیمه)$'
      and (i.valid_from is null or i.valid_from <= today)
      and (i.valid_until is null or i.valid_until >= today)
  ) or exists (
    -- Keep historical rows intact. A current explicit uninsured declaration
    -- cannot silently coexist with an apparently current base policy.
    select 1 from public.patient_insurances i where i.patient_id = new.patient_id
      and i.coverage_type = 'none'
      and (i.valid_from is null or i.valid_from <= today)
      and (i.valid_until is null or i.valid_until >= today)
  ) then raise exception 'PRESCRIPTION_PATIENT_REGISTRATION_REQUIRED'; end if;
  return new;
end $$;
revoke all on function public.drman_require_prescription_registration() from public,anon,authenticated;
grant execute on function public.drman_require_prescription_registration() to service_role;
create trigger prescriptions_require_patient_registration
  before insert or update of patient_id,status on public.prescriptions
  for each row execute function public.drman_require_prescription_registration();
