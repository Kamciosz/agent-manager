-- P0 stabilization: task quotas plus retry/cancel metadata.
-- This migration is additive and keeps existing alpha data valid.

alter table public.tasks
  add column if not exists retry_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists last_error text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancelled_by_user_id uuid references auth.users(id) on delete set null;

alter table public.workstation_jobs
  add column if not exists retry_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancelled_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_tasks_active_by_user
  on public.tasks(user_id, status, created_at desc)
  where status in ('pending', 'analyzing', 'in_progress');

create index if not exists idx_workstation_jobs_active_retry
  on public.workstation_jobs(workstation_id, status, retry_count, created_at desc)
  where status in ('queued', 'running');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_status_check'
  ) then
    alter table public.tasks
      add constraint tasks_status_check
      check (status in ('pending', 'analyzing', 'in_progress', 'done', 'failed', 'cancelled'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_retry_count_check'
  ) then
    alter table public.tasks
      add constraint tasks_retry_count_check
      check (retry_count >= 0)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_max_attempts_check'
  ) then
    alter table public.tasks
      add constraint tasks_max_attempts_check
      check (max_attempts between 1 and 10)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workstation_jobs'::regclass
      and conname = 'workstation_jobs_status_check'
  ) then
    alter table public.workstation_jobs
      add constraint workstation_jobs_status_check
      check (status in ('queued', 'running', 'done', 'failed', 'cancelled'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workstation_jobs'::regclass
      and conname = 'workstation_jobs_retry_count_check'
  ) then
    alter table public.workstation_jobs
      add constraint workstation_jobs_retry_count_check
      check (retry_count >= 0)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workstation_jobs'::regclass
      and conname = 'workstation_jobs_max_attempts_check'
  ) then
    alter table public.workstation_jobs
      add constraint workstation_jobs_max_attempts_check
      check (max_attempts between 1 and 10)
      not valid;
  end if;
end $$;

create or replace function public.active_task_quota_limit()
returns integer
language sql
stable
set search_path = ''
as $$
  select 3
$$;

create or replace function public.enforce_user_active_task_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester uuid;
  current_user_id uuid;
  requester_role text;
  active_count integer;
begin
  if new.status not in ('pending', 'analyzing', 'in_progress') then
    return new;
  end if;

  requester := coalesce(new.user_id, auth.uid());
  current_user_id := auth.uid();
  requester_role := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');

  if requester is null then
    return new;
  end if;

  if current_user_id is not null
     and requester <> current_user_id
     and requester_role not in ('admin', 'manager', 'operator', 'teacher') then
    raise exception 'task user_id must match authenticated user'
      using errcode = 'P0001',
            hint = 'Create tasks as the authenticated user or use an operator account.';
  end if;

  new.user_id := requester;

  if requester_role in ('admin', 'manager', 'operator', 'teacher') then
    return new;
  end if;

  select count(*) into active_count
  from public.tasks
  where user_id = requester
    and status in ('pending', 'analyzing', 'in_progress');

  if active_count >= public.active_task_quota_limit() then
    raise exception 'active task limit exceeded'
      using errcode = 'P0001',
            detail = format('User %s already has %s active tasks.', requester, active_count),
            hint = 'Wait until a task finishes or ask the operator to retry/reprioritize it.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_user_active_task_quota on public.tasks;
create trigger enforce_user_active_task_quota
before insert on public.tasks
for each row
execute function public.enforce_user_active_task_quota();
