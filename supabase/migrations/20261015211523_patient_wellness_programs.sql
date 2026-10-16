-- Private owner-requested nutrition and skin/hair programs. No clinical record
-- is overwritten; deleting the patient/account cascades this derived content.
create table if not exists public.patient_wellness_programs (
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('nutrition','skin_hair')),
  questionnaire jsonb not null default '{}'::jsonb check(jsonb_typeof(questionnaire)='object'),
  program jsonb check(program is null or jsonb_typeof(program)='object'),
  source text check(source in ('ai','local')),
  input_fingerprint text,
  generated_at timestamptz,
  ai_model text,
  program_version text,
  claim_token uuid,
  record_fingerprint text,
  lease_until timestamptz,
  retry_after timestamptz,
  attempt_day date,
  daily_attempts integer not null default 0 check(daily_attempts between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key(patient_id,kind)
);
alter table public.patient_wellness_programs enable row level security;
revoke all on public.patient_wellness_programs from public,anon,authenticated;
grant select,insert,update,delete on public.patient_wellness_programs to service_role;
create index if not exists patient_wellness_programs_owner_day_idx on public.patient_wellness_programs(user_id,attempt_day);

create or replace function public.claim_patient_wellness_program(
 p_user_id uuid,p_patient_id uuid,p_session_version integer,p_kind text,p_fingerprint text,p_claim_token uuid,p_allow_ai boolean,p_daily_limit integer
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_program public.patient_wellness_programs%rowtype; used_today integer; use_ai boolean; fallback_reason text;
begin
 if p_kind is null or p_kind not in ('nutrition','skin_hair') or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_claim_token is null then raise exception 'INVALID_WELLNESS_CLAIM'; end if;
 perform 1 from public.users where id=p_user_id and status='active' and coalesce(session_version,0)=p_session_version for update;
 if not found then return jsonb_build_object('state','access_changed'); end if;
 perform 1 from public.patients where id=p_patient_id and owner_user_id=p_user_id;
 if not found then return jsonb_build_object('state','access_changed'); end if;
 if (select granted from public.consent_records where user_id=p_user_id and patient_id=p_patient_id and consent_type='ai_processing' order by granted_at desc,granted asc limit 1) is distinct from true then return jsonb_build_object('state','consent_not_granted'); end if;
 select * into current_program from public.patient_wellness_programs where patient_id=p_patient_id and kind=p_kind for update;
 if found then
   if current_program.user_id<>p_user_id then return jsonb_build_object('state','access_changed'); end if;
   if current_program.program is not null and current_program.input_fingerprint=p_fingerprint and (current_program.source='ai' or not p_allow_ai) then return jsonb_build_object('state','ready'); end if;
   if current_program.lease_until>now() then return jsonb_build_object('state','pending'); end if;
 end if;
 select coalesce(sum(daily_attempts),0)::integer into used_today from public.patient_wellness_programs where user_id=p_user_id and attempt_day=current_date;
 use_ai:=coalesce(p_allow_ai,false) and used_today<greatest(0,least(3,p_daily_limit)) and (current_program.retry_after is null or current_program.retry_after<=now());
 fallback_reason:=case when not coalesce(p_allow_ai,false) then 'provider_unavailable' when used_today>=greatest(0,least(3,p_daily_limit)) then 'daily_limit' else 'cooldown' end;
 insert into public.patient_wellness_programs(patient_id,user_id,kind,claim_token,record_fingerprint,lease_until,retry_after,attempt_day,daily_attempts)
 values(p_patient_id,p_user_id,p_kind,p_claim_token,p_fingerprint,now()+interval '90 seconds',case when use_ai then now()+interval '10 minutes' else null end,current_date,case when use_ai then 1 else 0 end)
 on conflict(patient_id,kind) do update set claim_token=excluded.claim_token,record_fingerprint=excluded.record_fingerprint,lease_until=excluded.lease_until,
 retry_after=case when use_ai then excluded.retry_after else public.patient_wellness_programs.retry_after end,
 attempt_day=current_date,daily_attempts=(case when public.patient_wellness_programs.attempt_day=current_date then public.patient_wellness_programs.daily_attempts else 0 end)+(case when use_ai then 1 else 0 end),updated_at=now()
 where public.patient_wellness_programs.user_id=excluded.user_id;
 if not found then return jsonb_build_object('state','access_changed'); end if;
 return jsonb_build_object('state',case when use_ai then 'claimed' else 'claimed_local' end,'reason',case when use_ai then null else fallback_reason end);
end;
$$;
revoke all on function public.claim_patient_wellness_program(uuid,uuid,integer,text,text,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.claim_patient_wellness_program(uuid,uuid,integer,text,text,uuid,boolean,integer) to service_role;

create or replace function public.finish_patient_wellness_program(
 p_user_id uuid,p_patient_id uuid,p_session_version integer,p_kind text,p_fingerprint text,p_claim_token uuid,p_questionnaire jsonb,p_program jsonb,p_source text,p_model text,p_version text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare completed_at timestamptz:=now();
begin
 perform 1 from public.users where id=p_user_id and status='active' and coalesce(session_version,0)=p_session_version for update;
 if not found then return jsonb_build_object('saved',false); end if;
 perform 1 from public.patients where id=p_patient_id and owner_user_id=p_user_id;
 if not found then return jsonb_build_object('saved',false); end if;
 if (select granted from public.consent_records where user_id=p_user_id and patient_id=p_patient_id and consent_type='ai_processing' order by granted_at desc,granted asc limit 1) is distinct from true then return jsonb_build_object('saved',false); end if;
 if p_program is null then
   update public.patient_wellness_programs set claim_token=null,lease_until=null,updated_at=now() where patient_id=p_patient_id and user_id=p_user_id and kind=p_kind and claim_token=p_claim_token and record_fingerprint=p_fingerprint;
   return jsonb_build_object('saved',false);
 end if;
 if jsonb_typeof(p_program)<>'object' or p_questionnaire is null or jsonb_typeof(p_questionnaire)<>'object' or octet_length(p_program::text)>48000 or octet_length(p_questionnaire::text)>12000 or p_version is distinct from 'wellness-v1' or p_source is null or p_source not in ('ai','local') or (p_source='ai' and p_model is distinct from 'openai/gpt-oss-120b') or (p_source='local' and p_model is not null) then raise exception 'INVALID_WELLNESS_PROGRAM'; end if;
 update public.patient_wellness_programs set questionnaire=p_questionnaire,program=p_program,source=p_source,input_fingerprint=p_fingerprint,generated_at=completed_at,ai_model=p_model,program_version=p_version,claim_token=null,lease_until=null,updated_at=completed_at
 where patient_id=p_patient_id and user_id=p_user_id and kind=p_kind and claim_token=p_claim_token and record_fingerprint=p_fingerprint and lease_until>now();
 if not found then return jsonb_build_object('saved',false); end if;
 return jsonb_build_object('saved',true,'generated_at',completed_at);
end;
$$;
revoke all on function public.finish_patient_wellness_program(uuid,uuid,integer,text,text,uuid,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_patient_wellness_program(uuid,uuid,integer,text,text,uuid,jsonb,jsonb,text,text,text) to service_role;
