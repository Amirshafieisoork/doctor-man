-- DrMan reviewed migration: owner_clinical_operations
-- Fixed table and field allowlists; update and administrative audit are atomic.
create or replace function public.admin_update_clinical_record(
  p_kind text, p_id uuid, p_patch jsonb, p_reason text
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  target_table text;
  allowed_fields text[];
  field_name text;
  assignments text := '';
  previous_record jsonb;
  updated_record jsonb;
begin
  if nullif(btrim(p_reason), '') is null or length(p_reason)>500 then
    raise exception 'ADMIN_REASON_REQUIRED';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb then
    raise exception 'INVALID_PATCH';
  end if;
  case p_kind
    when 'task' then
      target_table := 'care_tasks';
      allowed_fields := array['title','details','due_at','status','priority','completed_at'];
    when 'order' then
      target_table := 'diagnostic_orders';
      allowed_fields := array['clinical_note','items','status','priority','completed_at'];
    when 'episode' then
      target_table := 'care_episodes';
      allowed_fields := array['title','summary','goal','status','urgency','preferred_specialty','updated_at'];
    when 'care_plan' then
      target_table := 'personalized_care_plans';
      allowed_fields := array['status'];
    else raise exception 'INVALID_KIND';
  end case;
  for field_name in select jsonb_object_keys(p_patch) loop
    if not field_name=any(allowed_fields) then raise exception 'INVALID_FIELD'; end if;
    if assignments<>'' then assignments:=assignments||', '; end if;
    assignments:=assignments||format('%I = (jsonb_populate_record(null::public.%I, $2)).%I',field_name,target_table,field_name);
  end loop;
  execute format('select to_jsonb(t) from public.%I as t where id=$1 for update',target_table)
    into previous_record using p_id;
  if previous_record is null then return null; end if;
  execute format('update public.%I as t set %s where id=$1 returning to_jsonb(t)',target_table,assignments)
    into updated_record using p_id,p_patch;
  insert into public.audit_logs(actor_type,action,resource_type,resource_id,patient_id,metadata)
  values('admin','clinical.'||p_kind||'.updated',target_table,p_id,(previous_record->>'patient_id')::uuid,
    jsonb_build_object('reason',p_reason,'changed_fields',(select jsonb_agg(key) from jsonb_object_keys(p_patch) as f(key)),
      'old_status',previous_record->>'status','new_status',updated_record->>'status'));
  return updated_record;
end;
$$;
revoke all on function public.admin_update_clinical_record(text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.admin_update_clinical_record(text,uuid,jsonb,text) to service_role;

create or replace function public.admin_update_user_annotation(p_user_id uuid,p_note text,p_labels jsonb,p_reason text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  if length(p_note)>3000 or jsonb_typeof(p_labels) is distinct from 'array' or jsonb_array_length(p_labels)>10 then raise exception 'INVALID_ANNOTATION'; end if;
  perform 1 from public.users where id=p_user_id and phone not like 'deleted-%' for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  -- The erasure worker claims the request before freezing and inventorying the
  -- account. Serialize on the user row and reject annotations during cleanup so
  -- a late note cannot survive deletion from the non-FK app_settings table.
  if exists(select 1 from public.account_deletion_requests where user_id=p_user_id and status='processing') then
    raise exception 'ACCOUNT_ERASURE_IN_PROGRESS';
  end if;
  insert into public.app_settings(key,value,updated_at)
    values('admin_user_'||p_user_id::text,jsonb_build_object('note',p_note,'labels',p_labels),now())
    on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
  insert into public.audit_logs(actor_type,action,resource_type,resource_id,metadata)
    values('admin','user.annotation_updated','user',p_user_id,jsonb_build_object('reason',p_reason,'label_count',jsonb_array_length(p_labels)));
  return true;
end;
$$;
revoke all on function public.admin_update_user_annotation(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.admin_update_user_annotation(uuid,text,jsonb,text) to service_role;

create or replace function public.admin_send_user_message(p_user_id uuid,p_title text,p_message text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare message_record public.notifications%rowtype;
begin
  if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  if nullif(btrim(p_title),'') is null or length(p_title)>160 or nullif(btrim(p_message),'') is null or length(p_message)>3000 then raise exception 'INVALID_MESSAGE'; end if;
  perform 1 from public.users where id=p_user_id and status='active' and phone not like 'deleted-%' for update;
  if not found then raise exception 'ACTIVE_USER_NOT_FOUND'; end if;
  insert into public.notifications(user_id,type,title,body,action_url,sent_at)
    values(p_user_id,'admin_message',p_title,p_message,'/health',now()) returning * into message_record;
  insert into public.audit_logs(actor_type,action,resource_type,resource_id,metadata)
    values('admin','user.message_sent','user',p_user_id,jsonb_build_object('reason',p_reason,'notification_id',message_record.id));
  return jsonb_build_object('id',message_record.id,'title',message_record.title,'body',message_record.body,'created_at',message_record.created_at);
end;
$$;
revoke all on function public.admin_send_user_message(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_send_user_message(uuid,text,text,text) to service_role;
