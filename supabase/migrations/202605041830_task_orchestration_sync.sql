-- Keep task orchestration consistent even when a browser tab or workstation misses
-- one of the follow-up updates. A workstation job is now authoritative for the
-- assigned station/model and for completing the task when the job is done.

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

  if tg_op = 'UPDATE'
     and old.status in ('pending', 'analyzing', 'in_progress')
     and new.status in ('pending', 'analyzing', 'in_progress')
     and old.user_id is not distinct from new.user_id then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*) into active_count
    from public.tasks
    where user_id = requester
      and status in ('pending', 'analyzing', 'in_progress')
      and id <> old.id;
  else
    select count(*) into active_count
    from public.tasks
    where user_id = requester
      and status in ('pending', 'analyzing', 'in_progress');
  end if;

  if active_count >= public.active_task_quota_limit() then
    raise exception 'active task limit exceeded'
      using errcode = 'P0001',
            detail = format('User %s already has %s active tasks.', requester, active_count),
            hint = 'Wait until a task finishes or ask the operator to retry/reprioritize it.';
  end if;

  return new;
end;
$$;

create or replace function public.record_task_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_fields text[] := array[]::text[];
  actor_kind_value text := public.task_event_actor_kind();
  actor_user_value uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_events(task_id, task_title, actor_user_id, actor_kind, event_type, summary, metadata)
    values (
      new.id,
      new.title,
      actor_user_value,
      actor_kind_value,
      'task.created',
      'Utworzono polecenie',
      jsonb_build_object('status', new.status, 'priority', new.priority, 'requested_workstation_id', new.requested_workstation_id, 'requested_model_name', new.requested_model_name)
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.task_events(task_id, task_title, actor_user_id, actor_kind, event_type, summary, metadata)
    values (
      old.id,
      old.title,
      actor_user_value,
      actor_kind_value,
      'task.deleted',
      'Usunięto polecenie',
      jsonb_build_object('old_status', old.status, 'priority', old.priority)
    );
    return old;
  end if;

  if old.status is distinct from new.status then
    insert into public.task_events(task_id, task_title, actor_user_id, actor_kind, event_type, summary, metadata)
    values (
      new.id,
      new.title,
      actor_user_value,
      actor_kind_value,
      case
        when new.status = 'cancelled' then 'task.cancelled'
        when new.status = 'pending' and old.status in ('failed', 'cancelled') then 'task.retried'
        else 'task.status_changed'
      end,
      case
        when new.status = 'cancelled' then 'Anulowano polecenie'
        when new.status = 'pending' and old.status in ('failed', 'cancelled') then 'Ponowiono polecenie'
        else format('Status: %s → %s', old.status, new.status)
      end,
      jsonb_build_object('old_status', old.status, 'new_status', new.status, 'retry_count', new.retry_count, 'last_error', new.last_error)
    );
  end if;

  if old.title is distinct from new.title then changed_fields := changed_fields || array['title']; end if;
  if old.description is distinct from new.description then changed_fields := changed_fields || array['description']; end if;
  if old.priority is distinct from new.priority then changed_fields := changed_fields || array['priority']; end if;
  if old.git_repo is distinct from new.git_repo then changed_fields := changed_fields || array['git_repo']; end if;
  if old.context is distinct from new.context then changed_fields := changed_fields || array['context']; end if;
  if old.requested_workstation_id is distinct from new.requested_workstation_id then changed_fields := changed_fields || array['requested_workstation_id']; end if;
  if old.requested_model_name is distinct from new.requested_model_name then changed_fields := changed_fields || array['requested_model_name']; end if;

  if array_length(changed_fields, 1) > 0 then
    insert into public.task_events(task_id, task_title, actor_user_id, actor_kind, event_type, summary, metadata)
    values (
      new.id,
      new.title,
      actor_user_value,
      actor_kind_value,
      'task.edited',
      'Zmieniono dane polecenia',
      jsonb_build_object('changed_fields', changed_fields, 'status', new.status, 'priority', new.priority, 'requested_workstation_id', new.requested_workstation_id, 'requested_model_name', new.requested_model_name)
    );
  end if;

  return new;
end;
$$;

create or replace function public.upsert_project_manager_assignment(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_status text default 'in_progress'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_status text;
begin
  if p_task_id is null then
    return;
  end if;

  assignment_status := case when p_status in ('done', 'cancelled', 'failed') then 'done' else 'in_progress' end;

  insert into public.assignments (task_id, agent_id, instructions, profile, status)
  values (
    p_task_id,
    'manager',
    concat(
      'Kierownik projektu koordynuje wykonanie polecenia, dobiera wykonawcę, pilnuje stacji roboczych i zamknięcia statusu.',
      E'\nPolecenie: ', coalesce(p_title, ''),
      case when nullif(p_description, '') is null then '' else concat(E'\nSzczegóły: ', p_description) end
    ),
    'kierownik projektu',
    assignment_status
  )
  on conflict (task_id, agent_id) do update
    set instructions = excluded.instructions,
        profile = excluded.profile,
        status = excluded.status,
        updated_at = now();
end;
$$;

create or replace function public.sync_project_manager_assignment_from_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('pending', 'analyzing', 'in_progress') then
    perform public.upsert_project_manager_assignment(new.id, new.title, new.description, 'in_progress');
  elsif new.status in ('done', 'failed', 'cancelled') then
    perform public.upsert_project_manager_assignment(new.id, new.title, new.description, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists sync_project_manager_assignment_from_task on public.tasks;
create trigger sync_project_manager_assignment_from_task
after insert or update of status, title, description on public.tasks
for each row
execute function public.sync_project_manager_assignment_from_task();

create or replace function public.sync_task_from_workstation_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.tasks%rowtype;
begin
  if new.task_id is null then
    return new;
  end if;

  select * into task_row from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;

  perform public.upsert_project_manager_assignment(task_row.id, task_row.title, task_row.description,
    case when new.status = 'done' then 'done' when new.status in ('failed', 'dead_letter') then 'failed' else 'in_progress' end);

  if new.status in ('queued', 'leased', 'running', 'retrying') then
    update public.tasks t
    set status = case when t.status in ('pending', 'analyzing') then 'in_progress' else t.status end,
        requested_workstation_id = coalesce(t.requested_workstation_id, new.workstation_id),
        requested_model_name = coalesce(t.requested_model_name, new.model_name),
        updated_at = now()
    where t.id = new.task_id
      and t.status not in ('cancelled', 'done');
  elsif new.status = 'done' then
    update public.tasks t
    set status = 'done',
        requested_workstation_id = coalesce(t.requested_workstation_id, new.workstation_id),
        requested_model_name = coalesce(t.requested_model_name, new.model_name),
        last_error = null,
        updated_at = now()
    where t.id = new.task_id
      and t.status <> 'cancelled';
  elsif new.status in ('failed', 'dead_letter') and not public.is_workstation_runtime_failure(new.error_text, new.last_error_code) then
    update public.tasks t
    set status = 'failed',
        requested_workstation_id = coalesce(t.requested_workstation_id, new.workstation_id),
        requested_model_name = coalesce(t.requested_model_name, new.model_name),
        last_error = new.error_text,
        updated_at = now()
    where t.id = new.task_id
      and t.status <> 'cancelled';
  end if;

  return new;
end;
$$;

drop trigger if exists sync_task_from_workstation_job on public.workstation_jobs;
create trigger sync_task_from_workstation_job
after insert or update of status, workstation_id, model_name, result_summary, error_text, last_error_code on public.workstation_jobs
for each row
execute function public.sync_task_from_workstation_job();

-- Repair existing artifacts: completed workstation jobs whose parent task stayed
-- in_progress, and active tasks missing the project-manager assignment.
update public.tasks t
set status = 'done',
    requested_workstation_id = coalesce(t.requested_workstation_id, j.workstation_id),
    requested_model_name = coalesce(t.requested_model_name, j.model_name),
    last_error = null,
    updated_at = now()
from public.workstation_jobs j
where j.task_id = t.id
  and j.status = 'done'
  and t.status <> 'cancelled';

insert into public.assignments (task_id, agent_id, instructions, profile, status)
select
  t.id,
  'manager',
  concat(
    'Kierownik projektu koordynuje wykonanie polecenia, dobiera wykonawcę, pilnuje stacji roboczych i zamknięcia statusu.',
    E'\nPolecenie: ', coalesce(t.title, ''),
    case when nullif(t.description, '') is null then '' else concat(E'\nSzczegóły: ', t.description) end
  ),
  'kierownik projektu',
  case when t.status in ('done', 'failed', 'cancelled') then 'done' else 'in_progress' end
from public.tasks t
where t.status in ('pending', 'analyzing', 'in_progress', 'done', 'failed', 'cancelled')
on conflict (task_id, agent_id) do update
  set instructions = excluded.instructions,
      profile = excluded.profile,
      status = excluded.status,
      updated_at = now();
