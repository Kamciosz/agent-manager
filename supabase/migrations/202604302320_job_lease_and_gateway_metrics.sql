-- Production foundation: atomic workstation leases, retry backoff and dead-letter states.

alter table public.workstation_jobs
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists priority integer not null default 100,
  add column if not exists idempotency_key text,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz;

alter table public.workstation_jobs
  drop constraint if exists workstation_jobs_status_check;

alter table public.workstation_jobs
  add constraint workstation_jobs_status_check
  check (status in ('queued', 'leased', 'running', 'done', 'failed', 'retrying', 'cancelled', 'expired', 'dead_letter'))
  not valid;

create index if not exists idx_tasks_user_status_created
  on public.tasks(user_id, status, created_at desc);

create index if not exists idx_messages_task_created
  on public.messages(task_id, created_at desc);

create index if not exists idx_assignments_agent_status
  on public.assignments(agent_id, status, created_at desc);

create index if not exists idx_workstation_jobs_claim
  on public.workstation_jobs(workstation_id, status, priority, created_at)
  where status in ('queued', 'retrying', 'expired', 'leased', 'running')
    and cancel_requested_at is null;

create index if not exists idx_workstation_jobs_lease_expired
  on public.workstation_jobs(workstation_id, lease_expires_at)
  where status in ('leased', 'running', 'retrying', 'expired')
    and cancel_requested_at is null;

create unique index if not exists idx_workstation_jobs_idempotency_key
  on public.workstation_jobs(idempotency_key)
  where idempotency_key is not null;

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
