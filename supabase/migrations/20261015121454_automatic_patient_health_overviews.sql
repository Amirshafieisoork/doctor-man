-- Private, derived cache. No browser role can read medical summaries or call
-- generation RPCs. Account/patient erasure removes the derived data by FK.
create table if not exists public.patient_health_overviews (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  overview jsonb,
  overview_fingerprint text,
  generated_at timestamptz,
  ai_model text,
  ai_version text,
  claim_token uuid,
  record_fingerprint text,
  lease_until timestamptz,
  retry_after timestamptz,
  attempt_day date,
  daily_attempts integer not null default 0 check (daily_attempts between 0 and 3),
  updated_at timestamptz not null default now(),
  check (overview is null or jsonb_typeof(overview)='object')
);
alter table public.patient_health_overviews enable row level security;
revoke all on public.patient_health_overviews from public,anon,authenticated;
grant select,insert,update,delete on public.patient_health_overviews to service_role;
create index if not exists patient_health_overviews_owner_idx on public.patient_health_overviews(user_id,attempt_day);

create or replace function public.claim_patient_health_overview(
  p_user_id uuid,p_patient_id uuid,p_session_version integer,p_fingerprint text,p_claim_token uuid,p_daily_limit integer
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_cache public.patient_health_overviews%rowtype; used_today integer;
begin
  if p_fingerprint !~ '^[a-f0-9]{64}$' or p_claim_token is null then raise exception 'INVALID_OVERVIEW_CLAIM'; end if;
  -- Serialize all profile claims for an owner, so two tabs / instances cannot
  -- race the daily budget. Recheck password revocation and active status here.
  perform 1 from public.users where id=p_user_id and status='active' and coalesce(session_version,0)=p_session_version for update;
  if not found then return jsonb_build_object('state','access_changed'); end if;
  perform 1 from public.patients where id=p_patient_id and owner_user_id=p_user_id;
  if not found then return jsonb_build_object('state','access_changed'); end if;
  if (select granted from public.consent_records where user_id=p_user_id and patient_id=p_patient_id and consent_type='ai_processing' order by granted_at desc,granted asc limit 1) is distinct from true then
    return jsonb_build_object('state','consent_not_granted');
  end if;
  select * into current_cache from public.patient_health_overviews where patient_id=p_patient_id and user_id=p_user_id for update;
  if found then
    if current_cache.overview is not null and current_cache.overview_fingerprint=p_fingerprint then return jsonb_build_object('state','ready'); end if;
    if current_cache.lease_until>now() then return jsonb_build_object('state','pending'); end if;
    if current_cache.retry_after>now() then return jsonb_build_object('state','cooldown'); end if;
  end if;
  select coalesce(sum(daily_attempts),0)::integer into used_today from public.patient_health_overviews where user_id=p_user_id and attempt_day=current_date;
  if used_today>=greatest(0,least(3,p_daily_limit)) then return jsonb_build_object('state','daily_limit'); end if;
  insert into public.patient_health_overviews(patient_id,user_id,claim_token,record_fingerprint,lease_until,retry_after,attempt_day,daily_attempts)
  values(p_patient_id,p_user_id,p_claim_token,p_fingerprint,now()+interval '90 seconds',now()+interval '10 minutes',current_date,1)
  on conflict(patient_id) do update set user_id=excluded.user_id,claim_token=excluded.claim_token,record_fingerprint=excluded.record_fingerprint,
    lease_until=excluded.lease_until,retry_after=excluded.retry_after,attempt_day=current_date,
    daily_attempts=case when public.patient_health_overviews.attempt_day=current_date then public.patient_health_overviews.daily_attempts+1 else 1 end,updated_at=now()
    where public.patient_health_overviews.user_id=excluded.user_id;
  if not found then return jsonb_build_object('state','access_changed'); end if;
  return jsonb_build_object('state','claimed');
end;
$$;
revoke all on function public.claim_patient_health_overview(uuid,uuid,integer,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_patient_health_overview(uuid,uuid,integer,text,uuid,integer) to service_role;

create or replace function public.finish_patient_health_overview(
  p_user_id uuid,p_patient_id uuid,p_session_version integer,p_fingerprint text,p_claim_token uuid,p_overview jsonb,p_model text,p_version text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare completed_at timestamptz:=now();
begin
  perform 1 from public.users where id=p_user_id and status='active' and coalesce(session_version,0)=p_session_version for update;
  if not found then return jsonb_build_object('saved',false); end if;
  perform 1 from public.patients where id=p_patient_id and owner_user_id=p_user_id;
  if not found then return jsonb_build_object('saved',false); end if;
  if (select granted from public.consent_records where user_id=p_user_id and patient_id=p_patient_id and consent_type='ai_processing' order by granted_at desc,granted asc limit 1) is distinct from true then
    return jsonb_build_object('saved',false);
  end if;
  if p_overview is null then
    update public.patient_health_overviews set claim_token=null,lease_until=null,updated_at=now()
      where patient_id=p_patient_id and user_id=p_user_id and claim_token=p_claim_token and record_fingerprint=p_fingerprint;
    return jsonb_build_object('saved',false);
  end if;
  if jsonb_typeof(p_overview)<>'object' or p_model<>'openai/gpt-oss-120b' or p_version<>'health-overview-v1' then raise exception 'INVALID_OVERVIEW'; end if;
  update public.patient_health_overviews set overview=p_overview,overview_fingerprint=p_fingerprint,generated_at=completed_at,ai_model=p_model,ai_version=p_version,
    claim_token=null,lease_until=null,updated_at=completed_at
    where patient_id=p_patient_id and user_id=p_user_id and claim_token=p_claim_token and record_fingerprint=p_fingerprint and lease_until>now();
  if not found then return jsonb_build_object('saved',false); end if;
  return jsonb_build_object('saved',true,'generated_at',completed_at);
end;
$$;
revoke all on function public.finish_patient_health_overview(uuid,uuid,integer,text,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.finish_patient_health_overview(uuid,uuid,integer,text,uuid,jsonb,text,text) to service_role;
