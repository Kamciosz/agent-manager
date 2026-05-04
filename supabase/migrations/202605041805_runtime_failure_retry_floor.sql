-- Follow-up for projects that already applied runtime_failure_guard before the
-- retry clamp was added. Runtime outages must leave jobs claimable.

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
  and coalesce(j.last_error_at, j.updated_at, j.created_at) > now() - interval '24 hours';
