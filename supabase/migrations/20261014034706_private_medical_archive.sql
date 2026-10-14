-- DrMan reviewed migration: private_medical_archive
-- Original filenames and byte sizes for private medical-document uploads.
-- Existing rows stay unchanged; viewers fall back to their title and MIME.
alter table public.medical_documents
  add column if not exists original_filename text,
  add column if not exists size_bytes bigint;

-- Serialize medical-file finalization with account freeze before erasure inventory.
create or replace function public.guard_private_medical_insert()
returns trigger language plpgsql security invoker set search_path='' as $$
declare owner_id uuid; patient_owner uuid; owner_status text;
begin
  if TG_TABLE_NAME='medical_documents' then
    select owner_user_id into owner_id from public.patients where id=NEW.patient_id;
    if owner_id is null or NEW.uploaded_by_user_id is distinct from owner_id then raise exception 'MEDICAL_PATIENT_FORBIDDEN'; end if;
  elsif TG_TABLE_NAME='test_results' then
    owner_id:=NEW.user_id;
    if NEW.patient_id is not null then
      select owner_user_id into patient_owner from public.patients where id=NEW.patient_id;
      if patient_owner is distinct from owner_id then raise exception 'MEDICAL_PATIENT_FORBIDDEN'; end if;
    end if;
  else raise exception 'MEDICAL_TABLE_INVALID'; end if;
  select status into owner_status from public.users where id=owner_id for share;
  if owner_status is distinct from 'active' then raise exception 'MEDICAL_ACCOUNT_INACTIVE'; end if;
  return NEW;
end; $$;
revoke all on function public.guard_private_medical_insert() from PUBLIC,anon,authenticated;
grant execute on function public.guard_private_medical_insert() to service_role;
drop trigger if exists zz_archive_owner_guard on public.medical_documents;
create trigger zz_archive_owner_guard before insert on public.medical_documents for each row execute function public.guard_private_medical_insert();
drop trigger if exists zz_archive_owner_guard on public.test_results;
create trigger zz_archive_owner_guard before insert on public.test_results for each row execute function public.guard_private_medical_insert();
