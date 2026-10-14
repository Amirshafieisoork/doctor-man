-- DrMan reviewed migration: professional_license_review
-- Private professional registration images. End-user sessions are verified by
-- the application server; only the service role may access rows or storage.
create table if not exists public.doctor_license_documents (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null unique references public.doctor_profiles(id) on delete cascade,
  uploaded_by_user_id uuid not null references public.users(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  file_size integer not null check (file_size > 0 and file_size <= 4194304),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  ai_report jsonb not null default '{}'::jsonb,
  review_decision text not null default 'pending' check (review_decision in ('pending','verified','rejected')),
  review_reason text,
  registry_checked boolean not null default false,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (review_decision <> 'verified' or (registry_checked and reviewed_at is not null))
);
alter table public.doctor_license_documents enable row level security;
revoke all on public.doctor_license_documents from public, anon, authenticated;
grant select, insert, update, delete on public.doctor_license_documents to service_role;
create index if not exists doctor_license_documents_owner_idx on public.doctor_license_documents(uploaded_by_user_id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('doctor-licenses','doctor-licenses',false,4194304,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.submit_doctor_application(p_user_id uuid,p_profile jsonb,p_document jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare d public.doctor_profiles%rowtype; doc public.doctor_license_documents%rowtype; previous_path text;
begin
  if current_user not in ('postgres','service_role') and coalesce(auth.role(),'') <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  perform 1 from public.users where id=p_user_id and status='active' for update;
  if not found then raise exception 'ACTIVE_ACCOUNT_REQUIRED' using errcode='42501'; end if;
  if nullif(trim(p_profile->>'full_name'),'') is null or nullif(trim(p_profile->>'specialty'),'') is null or nullif(trim(p_profile->>'medical_license_number'),'') is null then raise exception 'INVALID_DOCTOR_APPLICATION'; end if;
  if nullif(p_document->>'storage_path','') is null or p_document->>'storage_path' not like p_user_id::text || '/%' or p_document->>'storage_path' like '%..%' or p_document->>'file_size' is null or (p_document->>'file_size')::integer not between 1 and 4194304 then raise exception 'INVALID_LICENSE_DOCUMENT'; end if;
  select * into d from public.doctor_profiles where user_id=p_user_id for update;
  if coalesce((p_document->>'reuse_existing')::boolean,false) then
    select * into doc from public.doctor_license_documents where doctor_id=d.id for update;
    if doc.id is distinct from (p_document->>'expected_document_id')::uuid
      or doc.updated_at is distinct from (p_document->>'expected_document_updated_at')::timestamptz
      or doc.storage_path is distinct from p_document->>'storage_path' then
      raise exception 'LICENSE_CHANGED' using errcode='40001';
    end if;
  end if;
  if d.id is null then
    insert into public.doctor_profiles(user_id,slug,full_name,medical_license_number,specialty,sub_specialty,bio,city,phone,accepts_online,accepts_in_person,consultation_fee,verification_status,public_profile)
    values(p_user_id,p_profile->>'slug',p_profile->>'full_name',p_profile->>'medical_license_number',p_profile->>'specialty',p_profile->>'sub_specialty',p_profile->>'bio',p_profile->>'city',p_profile->>'phone',(p_profile->>'accepts_online')::boolean,(p_profile->>'accepts_in_person')::boolean,(p_profile->>'consultation_fee')::integer,'pending',false) returning * into d;
  else
    update public.doctor_profiles set full_name=p_profile->>'full_name',medical_license_number=p_profile->>'medical_license_number',specialty=p_profile->>'specialty',sub_specialty=p_profile->>'sub_specialty',bio=p_profile->>'bio',city=p_profile->>'city',phone=p_profile->>'phone',accepts_online=(p_profile->>'accepts_online')::boolean,accepts_in_person=(p_profile->>'accepts_in_person')::boolean,consultation_fee=(p_profile->>'consultation_fee')::integer,verification_status='pending',public_profile=false,verified_at=null,updated_at=clock_timestamp() where id=d.id returning * into d;
  end if;
  select storage_path into previous_path from public.doctor_license_documents where doctor_id=d.id for update;
  insert into public.doctor_license_documents(doctor_id,uploaded_by_user_id,storage_path,original_name,mime_type,file_size,sha256,ai_report)
  values(d.id,p_user_id,p_document->>'storage_path',p_document->>'original_name',p_document->>'mime_type',(p_document->>'file_size')::integer,p_document->>'sha256',coalesce(p_document->'ai_report','{}'::jsonb))
  on conflict(doctor_id) do update set storage_path=excluded.storage_path,original_name=excluded.original_name,mime_type=excluded.mime_type,file_size=excluded.file_size,sha256=excluded.sha256,ai_report=excluded.ai_report,review_decision='pending',review_reason=null,registry_checked=false,reviewed_at=null,updated_at=clock_timestamp() returning * into doc;
  update public.users set account_type='doctor' where id=p_user_id;
  return jsonb_build_object('doctor',to_jsonb(d),'document',to_jsonb(doc),'replaced_storage_path',previous_path);
end; $$;
revoke all on function public.submit_doctor_application(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.submit_doctor_application(uuid,jsonb,jsonb) to service_role;

create or replace function public.review_doctor_application(p_doctor_id uuid,p_document_id uuid,p_document_updated_at timestamptz,p_decision text,p_reason text,p_registry_checked boolean)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare d public.doctor_profiles%rowtype; doc public.doctor_license_documents%rowtype; owner_id uuid;
begin
  if current_user not in ('postgres','service_role') and coalesce(auth.role(),'') <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if p_decision not in ('verified','rejected') or length(trim(coalesce(p_reason,''))) < 5 then return jsonb_build_object('ok',false,'code','INVALID_REVIEW'); end if;
  if p_decision='verified' and p_registry_checked is not true then return jsonb_build_object('ok',false,'code','REGISTRY_REQUIRED'); end if;
  select user_id into owner_id from public.doctor_profiles where id=p_doctor_id;
  perform 1 from public.users where id=owner_id and status='active' for update;
  if not found then return jsonb_build_object('ok',false,'code','ACCOUNT_INACTIVE'); end if;
  select * into d from public.doctor_profiles where id=p_doctor_id for update;
  if d.id is null then return jsonb_build_object('ok',false,'code','DOCTOR_MISSING'); end if;
  select * into doc from public.doctor_license_documents where doctor_id=p_doctor_id for update;
  if doc.id is null then return jsonb_build_object('ok',false,'code','LICENSE_MISSING'); end if;
  if doc.id <> p_document_id or doc.updated_at <> p_document_updated_at then return jsonb_build_object('ok',false,'code','LICENSE_CHANGED'); end if;
  update public.doctor_license_documents set review_decision=p_decision,review_reason=left(trim(p_reason),1200),registry_checked=p_registry_checked,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=doc.id;
  update public.doctor_profiles set verification_status=p_decision,public_profile=(p_decision='verified'),verified_at=case when p_decision='verified' then clock_timestamp() else null end,updated_at=clock_timestamp() where id=d.id returning * into d;
  return jsonb_build_object('ok',true,'doctor',to_jsonb(d));
end; $$;
revoke all on function public.review_doctor_application(uuid,uuid,timestamptz,text,text,boolean) from public,anon,authenticated;
grant execute on function public.review_doctor_application(uuid,uuid,timestamptz,text,text,boolean) to service_role;

-- Editing the identity behind a verified badge invalidates the prior review.
create or replace function public.invalidate_doctor_professional_review()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.full_name is distinct from old.full_name or new.medical_license_number is distinct from old.medical_license_number or new.specialty is distinct from old.specialty then
    new.verification_status := 'pending'; new.public_profile := false; new.verified_at := null;
    update public.doctor_license_documents set review_decision='pending',review_reason=null,registry_checked=false,reviewed_at=null,updated_at=clock_timestamp(),ai_report=jsonb_build_object('status','stale','authenticity_verified',false,'summary','مشخصات حرفه‌ای تغییر کرده است؛ مدرک باید با مشخصات جدید بررسی شود.') where doctor_id=old.id;
  end if;
  return new;
end; $$;
revoke all on function public.invalidate_doctor_professional_review() from public,anon,authenticated;
grant execute on function public.invalidate_doctor_professional_review() to service_role;
drop trigger if exists doctor_professional_review_invalidated on public.doctor_profiles;
create trigger doctor_professional_review_invalidated before update of full_name,medical_license_number,specialty on public.doctor_profiles for each row execute function public.invalidate_doctor_professional_review();
