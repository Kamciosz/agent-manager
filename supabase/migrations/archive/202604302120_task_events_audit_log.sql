create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  task_title text,
  actor_user_id uuid,
  actor_kind text not null default 'system' check (actor_kind in ('user', 'station', 'system')),
  event_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.task_events enable row level security;

create index if not exists idx_task_events_task_created
  on public.task_events(task_id, created_at desc);

create or replace function public.task_event_actor_kind()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when public.is_workstation_user() then 'station'
    when public.is_app_user() then 'user'
    else 'system'
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

  if old.title is distinct from new.title then changed_fields := changed_fields || 'title'; end if;
  if old.description is distinct from new.description then changed_fields := changed_fields || 'description'; end if;
  if old.priority is distinct from new.priority then changed_fields := changed_fields || 'priority'; end if;
  if old.git_repo is distinct from new.git_repo then changed_fields := changed_fields || 'git_repo'; end if;
  if old.context is distinct from new.context then changed_fields := changed_fields || 'context'; end if;
  if old.requested_workstation_id is distinct from new.requested_workstation_id then changed_fields := changed_fields || 'requested_workstation_id'; end if;
  if old.requested_model_name is distinct from new.requested_model_name then changed_fields := changed_fields || 'requested_model_name'; end if;

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

revoke all on function public.task_event_actor_kind() from public;
revoke all on function public.task_event_actor_kind() from anon;
revoke all on function public.task_event_actor_kind() from authenticated;

revoke all on function public.record_task_event() from public;
revoke all on function public.record_task_event() from anon;
revoke all on function public.record_task_event() from authenticated;

drop trigger if exists record_task_event on public.tasks;
create trigger record_task_event
after insert or update or delete on public.tasks
for each row execute function public.record_task_event();

drop policy if exists "App users read task events" on public.task_events;
create policy "App users read task events" on public.task_events
  for select to authenticated
  using (public.is_app_user());