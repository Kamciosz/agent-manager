-- Runtime/proxy outages are station health failures, not task failures.
-- This guard protects older workstation-agent versions that still try to mark
-- local llama-server/proxy 502 errors as retry attempts or dead-letter jobs.

create or replace function public.is_workstation_runtime_failure(
  p_error_text text,
  p_error_code text default null
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(p_error_code), '') = 'runtime_unavailable'
    or coalesce(lower(p_error_text), '') like any (array[
      '%local proxy http 502%',
      '%llama-server unreachable%',
      '%llama-server timeout%',
      '%proxy http 502%'
    ])
$$;

create or replace function public.workstation_runtime_backoff_active(p_metadata jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  raw_until text;
  parsed_until timestamptz;
begin
  raw_until := nullif(coalesce(p_metadata, '{}'::jsonb) ->> 'runtimeBackoffUntil', '');
  if raw_until is null then
    raw_until := nullif(coalesce(p_metadata, '{}'::jsonb) ->> 'runtimeBlockedUntil', '');
  end if;
  if raw_until is null then
    return false;
  end if;

  begin
    parsed_until := raw_until::timestamptz;
  exception when others then
    return false;
  end;

  return parsed_until > now();
end;
$$;

create or replace function public.prevent_runtime_failure_dead_letter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  runtime_backoff_until timestamptz := now() + interval '10 minutes';
  preserved_retry_count integer;
  max_retry_count integer;
begin
  if tg_op = 'UPDATE'
     and new.status in ('retrying', 'failed', 'dead_letter')
     and public.is_workstation_runtime_failure(new.error_text, new.last_error_code) then
    max_retry_count := greatest(coalesce(new.max_attempts, old.max_attempts, 3) - 1, 0);
    preserved_retry_count := least(greatest(0, coalesce(old.retry_count, new.retry_count, 0)), max_retry_count);

    new.status := 'retrying';
    new.retry_count := preserved_retry_count;
    new.lease_owner := null;
    new.lease_expires_at := runtime_backoff_until;
    new.finished_at := null;
    new.last_error_code := 'runtime_unavailable';
    new.last_error_at := coalesce(new.last_error_at, now());
    new.updated_at := now();

    update public.workstations w
    set status = 'offline',
        metadata = coalesce(w.metadata, '{}'::jsonb) || jsonb_build_object(
          'runtimeBackoffUntil', runtime_backoff_until,
          'runtimeBackoffReason', left(coalesce(new.error_text, 'runtime_unavailable'), 500),
          'availableSlots', 0
        ),
        updated_at = now()
    where w.id = new.workstation_id;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_runtime_failure_dead_letter on public.workstation_jobs;
create trigger prevent_runtime_failure_dead_letter
before update of status, retry_count, error_text, last_error_code on public.workstation_jobs
for each row
execute function public.prevent_runtime_failure_dead_letter();

create or replace function public.claim_workstation_jobs(
  p_workstation_id uuid,
  p_limit integer,
  p_lease_seconds integer default 900
)
returns setof public.workstation_jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_limit integer;
  effective_lease_seconds integer;
  requester uuid;
begin
  requester := auth.uid();
  effective_limit := greatest(1, least(coalesce(p_limit, 1), 8));
  effective_lease_seconds := greatest(60, least(coalesce(p_lease_seconds, 900), 3600));

  if p_workstation_id is null or requester is null then
    raise exception 'workstation claim requires an authenticated workstation id'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.workstations w
    where w.id = p_workstation_id
      and (
        public.is_app_user()
        or (public.is_workstation_user() and w.station_user_id = requester)
      )
  ) then
    raise exception 'workstation claim denied'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.workstations w
    where w.id = p_workstation_id
      and w.accepts_jobs is true
      and w.status in ('online', 'busy')
      and w.last_seen_at >= now() - interval '2 minutes'
      and not public.workstation_runtime_backoff_active(w.metadata)
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.workstation_jobs j
    where j.workstation_id = p_workstation_id
      and j.status in ('retrying', 'failed', 'dead_letter', 'cancelled')
      and public.is_workstation_runtime_failure(j.error_text, j.last_error_code)
      and coalesce(j.last_error_at, j.updated_at, j.created_at) > now() - interval '10 minutes'
  ) then
    return;
  end if;

  return query
  with candidates as (
    select j.id
    from public.workstation_jobs j
    where j.workstation_id = p_workstation_id
      and j.cancel_requested_at is null
      and j.retry_count < j.max_attempts
      and (
        j.status = 'queued'
        or (j.status in ('retrying', 'expired') and coalesce(j.lease_expires_at, '-infinity'::timestamptz) <= now())
        or (j.status in ('leased', 'running') and j.lease_expires_at <= now())
      )
    order by j.priority asc, j.created_at asc
    limit effective_limit
    for update skip locked
  )
  update public.workstation_jobs j
  set status = 'leased',
      lease_owner = p_workstation_id::text,
      lease_expires_at = now() + make_interval(secs => effective_lease_seconds),
      finished_at = null,
      error_text = null,
      updated_at = now()
  from candidates
  where j.id = candidates.id
  returning j.*;
end;
$$;

revoke all on function public.claim_workstation_jobs(uuid, integer, integer) from public;
revoke all on function public.claim_workstation_jobs(uuid, integer, integer) from anon;
grant execute on function public.claim_workstation_jobs(uuid, integer, integer) to authenticated;

create or replace function public.release_expired_workstation_jobs(
  p_workstation_id uuid default null
)
returns table (
  released_id uuid,
  new_status text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with expired as (
    select id, retry_count
    from public.workstation_jobs
    where status in ('leased', 'running')
      and lease_expires_at is not null
      and lease_expires_at < now()
      and (p_workstation_id is null or workstation_id = p_workstation_id)
    for update skip locked
  ), updated as (
    update public.workstation_jobs j
    set
      status = 'retrying',
      lease_owner = null,
      lease_expires_at = now() + interval '30 seconds',
      last_error_code = 'lease_expired',
      last_error_at = now(),
      finished_at = null,
      updated_at = now()
    from expired
    where j.id = expired.id
    returning j.id, j.status, j.retry_count
  )
  select id, status, retry_count from updated;
end;
$$;

revoke all on function public.release_expired_workstation_jobs(uuid) from public;
revoke all on function public.release_expired_workstation_jobs(uuid) from anon;
grant execute on function public.release_expired_workstation_jobs(uuid) to authenticated;

comment on function public.release_expired_workstation_jobs(uuid) is
  'Zwalnia joby workstation_jobs z wygasłym lease bez spalania prób; awaria stacji nie jest błędem zadania.';

with repaired_jobs as (
  update public.workstation_jobs j
  set status = 'retrying',
      retry_count = least(coalesce(j.retry_count, 0), greatest(coalesce(j.max_attempts, 3) - 1, 0)),
      lease_owner = null,
      lease_expires_at = now() + interval '10 minutes',
      finished_at = null,
      last_error_code = 'runtime_unavailable',
      last_error_at = coalesce(j.last_error_at, now()),
      updated_at = now()
  where j.status in ('retrying', 'failed', 'dead_letter')
    and public.is_workstation_runtime_failure(j.error_text, j.last_error_code)
    and coalesce(j.last_error_at, j.updated_at, j.created_at) > now() - interval '24 hours'
  returning j.id, j.task_id, j.workstation_id, j.error_text, j.last_error_at
), repaired_tasks as (
  update public.tasks t
  set status = 'in_progress',
      last_error = null,
      updated_at = now()
  from repaired_jobs j
  where t.id = j.task_id
    and t.status = 'failed'
  returning t.id
)
select count(*) from repaired_tasks;
