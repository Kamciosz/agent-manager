-- Advisor fixes for task quota lifecycle migration.

revoke all on function public.enforce_user_active_task_quota() from public;
revoke all on function public.enforce_user_active_task_quota() from anon;
revoke all on function public.enforce_user_active_task_quota() from authenticated;

create index if not exists idx_tasks_cancelled_by_user
  on public.tasks(cancelled_by_user_id)
  where cancelled_by_user_id is not null;

create index if not exists idx_workstation_jobs_cancelled_by_user
  on public.workstation_jobs(cancelled_by_user_id)
  where cancelled_by_user_id is not null;
