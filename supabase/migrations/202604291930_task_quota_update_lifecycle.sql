-- Enforce the active task quota when retry moves an existing task back to pending.

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
    and status in ('pending', 'analyzing', 'in_progress')
    and id <> new.id;

  if active_count >= public.active_task_quota_limit() then
    raise exception 'active task limit exceeded'
      using errcode = 'P0001',
            detail = format('User %s already has %s other active tasks.', requester, active_count),
            hint = 'Wait until a task finishes or ask the operator to retry/reprioritize it.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_user_active_task_quota() from public;
revoke all on function public.enforce_user_active_task_quota() from anon;
revoke all on function public.enforce_user_active_task_quota() from authenticated;

drop trigger if exists enforce_user_active_task_quota_update on public.tasks;
create trigger enforce_user_active_task_quota_update
before update of status on public.tasks
for each row
when (
  new.status in ('pending', 'analyzing', 'in_progress')
  and old.status is distinct from new.status
)
execute function public.enforce_user_active_task_quota();