-- Runtime-failed jobs cancelled by the manager still quarantine the station.
-- Otherwise the same broken station can be selected again immediately.

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
