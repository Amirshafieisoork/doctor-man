-- Additive, service-only quota reservation. No medical payload is stored here.
-- The lease MUST exceed the server function's maximum request duration.
create table public.ai_analysis_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  period_start date not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint ai_analysis_reservations_month_start
    check (extract(day from period_start) = 1),
  constraint ai_analysis_reservations_valid_expiry
    check (expires_at > created_at)
);

create index ai_analysis_reservations_user_period_expiry_idx
  on public.ai_analysis_reservations (user_id, period_start, expires_at);

alter table public.ai_analysis_reservations enable row level security;
revoke all on table public.ai_analysis_reservations from public, anon, authenticated;
revoke all on table public.ai_analysis_reservations from service_role;
grant select, insert, delete on table public.ai_analysis_reservations to service_role;

create function public.reserve_lab_analysis_quota(
  p_user_id uuid,
  p_limit integer,
  p_ttl_seconds integer default 900
)
returns table (
  allowed boolean,
  reservation_id uuid,
  remaining bigint,
  expires_at timestamptz,
  reserved_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_period_start date;
  v_current_period date;
  v_used bigint;
  v_pending bigint;
  v_id uuid;
  v_expiry timestamptz;
begin
  if p_user_id is null or p_limit is null or p_limit < 0 or p_limit > 100000
    or p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    raise exception 'INVALID_QUOTA_INPUT' using errcode = '22023';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_period_start := pg_catalog.date_trunc('month', v_now at time zone 'UTC')::date;

  -- Transaction-scoped lock serializes quota decisions for one user/month.
  -- A rare hash collision only serializes unrelated users; it cannot grant
  -- extra capacity. Every count runs AFTER this lock has been acquired.
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'drman-lab:' || p_user_id::text || ':' || v_period_start::text, 0
    ));
    v_now := pg_catalog.clock_timestamp();
    v_current_period := pg_catalog.date_trunc('month', v_now at time zone 'UTC')::date;
    exit when v_current_period = v_period_start;
    -- A lock wait that crosses midnight on the first day must reserve the new
    -- month. Acquire its lock before counting that month's capacity.
    v_period_start := v_current_period;
  end loop;

  -- Failed or killed requests recover their capacity after their bounded lease.
  -- Expired rows belonging to other users are never touched by this request.
  delete from public.ai_analysis_reservations r
    where r.user_id = p_user_id and r.expires_at <= v_now;

  -- test_results.created_at is an existing timestamp WITHOUT time zone. Its
  -- UTC month boundaries are deliberately kept as that same timestamp type.
  select pg_catalog.count(*) into v_used
    from public.test_results t
    where t.user_id = p_user_id
      and t.created_at >= v_period_start::timestamp
      and t.created_at < v_period_start::timestamp + interval '1 month';
  select pg_catalog.count(*) into v_pending
    from public.ai_analysis_reservations r
    where r.user_id = p_user_id
      and r.period_start = v_period_start
      and r.expires_at > v_now;

  if v_used + v_pending >= p_limit then
    return query select false, null::uuid, 0::bigint, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_expiry := v_now + pg_catalog.make_interval(secs => p_ttl_seconds);
  insert into public.ai_analysis_reservations (user_id, period_start, created_at, expires_at)
    values (p_user_id, v_period_start, v_now, v_expiry)
    returning id into v_id;

  return query select true, v_id,
    greatest(0::bigint, p_limit::bigint - v_used - v_pending - 1),
    v_expiry, v_now;
end;
$$;

revoke execute on function public.reserve_lab_analysis_quota(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_lab_analysis_quota(uuid, integer, integer)
  to service_role;

comment on table public.ai_analysis_reservations is
  'Service-only temporary lab quota leases; no clinical payload. Never expose to clients.';
comment on function public.reserve_lab_analysis_quota(uuid, integer, integer) is
  'Atomically reserves a current-UTC-month lab analysis. Persist result before releasing; lease must exceed function maxDuration.';
