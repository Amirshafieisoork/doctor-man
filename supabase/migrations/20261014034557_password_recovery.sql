-- DrMan reviewed migration: password_recovery
-- Additive, service-only account recovery. Raw reset links are never stored.
alter table public.users add column if not exists session_version integer not null default 0
  check (session_version >= 0);

create table public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check (status in ('pending','issued','resolved')),
  resolved_at timestamptz
);
create index password_reset_requests_pending_idx
  on public.password_reset_requests (requested_at desc) where status = 'pending';

create table public.password_reset_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.users(id) on delete cascade,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '1 hour')
);
create index password_reset_tokens_user_idx on public.password_reset_tokens (user_id);
create unique index password_reset_tokens_one_active_per_user_idx
  on public.password_reset_tokens (user_id) where consumed_at is null;

alter table public.password_reset_requests enable row level security;
alter table public.password_reset_tokens enable row level security;
revoke all on table public.password_reset_requests, public.password_reset_tokens from public, anon, authenticated;
revoke all on table public.password_reset_requests, public.password_reset_tokens from service_role;
grant select, insert, update, delete on table public.password_reset_requests, public.password_reset_tokens to service_role;

create function public.request_password_reset(p_phone text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare v_user_id uuid;
begin
  if p_phone is null or p_phone !~ '^09[0-9]{9}$' then
    raise exception 'INVALID_RESET_INPUT' using errcode = '22023';
  end if;
  -- Hold the account while enqueuing: erasure blocks it before deleting the
  -- recovery queue and must serialize with an in-flight public request.
  select u.id into v_user_id from public.users u
    where u.phone=p_phone and u.status='active' for share;
  if not found then return; end if;
  insert into public.password_reset_requests (user_id,status,requested_at,resolved_at)
    values (v_user_id,'pending',pg_catalog.clock_timestamp(),null)
    on conflict (user_id) do update set status='pending',requested_at=excluded.requested_at,resolved_at=null;
end;
$$;

create function public.issue_password_reset_token(p_user_id uuid,p_token_hash text,p_ttl_seconds integer default 1800)
returns table (expires_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
declare v_status text; v_now timestamptz; v_expiry timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    raise exception 'INVALID_RESET_INPUT' using errcode = '22023';
  end if;
  -- Issue and consume lock the same user first, serializing competing links.
  select u.status into v_status from public.users u where u.id=p_user_id for update;
  if not found or v_status is distinct from 'active' then return; end if;
  v_now := pg_catalog.clock_timestamp();
  v_expiry := v_now + pg_catalog.make_interval(secs => p_ttl_seconds);
  update public.password_reset_tokens t set consumed_at=v_now where t.user_id=p_user_id and t.consumed_at is null;
  insert into public.password_reset_tokens (token_hash,user_id,issued_at,expires_at) values (p_token_hash,p_user_id,v_now,v_expiry);
  update public.password_reset_requests r set status='issued' where r.user_id=p_user_id and r.status='pending';
  insert into public.audit_logs (actor_type,action,resource_type,resource_id)
    values ('admin','account.password_reset_link_issued','user',p_user_id);
  return query select v_expiry;
end;
$$;

create function public.consume_password_reset_token(p_token_hash text,p_password_hash text)
returns table (user_id uuid,session_version integer)
language plpgsql security invoker set search_path = ''
as $$
declare v_user_id uuid; v_status text; v_version integer; v_token record; v_now timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_password_hash is null or p_password_hash !~ '^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$' then
    raise exception 'INVALID_RESET_INPUT' using errcode = '22023';
  end if;
  select t.user_id into v_user_id from public.password_reset_tokens t where t.token_hash=p_token_hash;
  if not found then return; end if;
  select u.status,u.session_version into v_status,v_version from public.users u where u.id=v_user_id for update;
  if not found or v_status is distinct from 'active' then return; end if;
  -- Re-read after the user lock: a concurrent consume/issue may have revoked it.
  select t.* into v_token from public.password_reset_tokens t where t.token_hash=p_token_hash for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_token.consumed_at is not null or v_token.expires_at <= v_now then return; end if;
  update public.users u set password=p_password_hash,session_version=v_version+1 where u.id=v_user_id;
  update public.password_reset_tokens t set consumed_at=v_now where t.user_id=v_user_id and t.consumed_at is null;
  update public.password_reset_requests r set status='resolved',resolved_at=v_now where r.user_id=v_user_id;
  insert into public.audit_logs (actor_type,actor_user_id,action,resource_type,resource_id)
    values ('user',v_user_id,'account.password_reset_completed','user',v_user_id);
  return query select v_user_id,v_version+1;
end;
$$;

revoke execute on function public.issue_password_reset_token(uuid,text,integer) from public,anon,authenticated;
revoke execute on function public.consume_password_reset_token(text,text) from public,anon,authenticated;
revoke execute on function public.request_password_reset(text) from public,anon,authenticated;
grant execute on function public.issue_password_reset_token(uuid,text,integer),public.consume_password_reset_token(text,text),public.request_password_reset(text) to service_role;
comment on table public.password_reset_tokens is 'Service-only one-use password reset hashes. Never expose to browsers; issue links only after owner verifies identity.';
comment on table public.password_reset_requests is 'Private support-assisted account recovery queue. No unauthenticated account identifiers are returned.';
