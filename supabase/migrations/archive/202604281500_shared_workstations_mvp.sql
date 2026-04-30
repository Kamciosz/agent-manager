create table if not exists public.workstations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  hostname text not null unique,
  operator_user_id uuid not null references auth.users(id) on delete cascade,
  os text not null default 'unknown',
  arch text not null default 'unknown',
  gpu_backend text,
  status text not null default 'offline',
  current_model_name text,
  accepts_jobs boolean not null default true,
  schedule_enabled boolean not null default false,
  schedule_start time,
  schedule_end time,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workstation_models (
  id uuid primary key default gen_random_uuid(),
  workstation_id uuid not null references public.workstations(id) on delete cascade,
  model_label text not null,
  model_path text,
  is_loaded boolean not null default false,
  is_default boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workstation_id, model_label)
);

create table if not exists public.workstation_messages (
  id uuid primary key default gen_random_uuid(),
  workstation_id uuid not null references public.workstations(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  sender_kind text not null,
  sender_label text not null,
  message_type text not null default 'note',
  content text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workstation_jobs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete set null,
  workstation_id uuid not null references public.workstations(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  model_name text,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  result_summary text,
  result_payload jsonb not null default '{}'::jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks
  add column if not exists requested_workstation_id uuid references public.workstations(id) on delete set null,
  add column if not exists requested_model_name text;

create index if not exists idx_workstations_status on public.workstations(status);
create index if not exists idx_workstations_operator on public.workstations(operator_user_id);
create index if not exists idx_workstation_models_workstation on public.workstation_models(workstation_id);
create index if not exists idx_workstation_messages_workstation on public.workstation_messages(workstation_id, created_at desc);
create index if not exists idx_workstation_jobs_workstation on public.workstation_jobs(workstation_id, status, created_at desc);
create index if not exists idx_tasks_requested_workstation on public.tasks(requested_workstation_id);
create unique index if not exists idx_assignments_task_agent_unique on public.assignments(task_id, agent_id);
create unique index if not exists idx_workstation_jobs_task_workstation_unique on public.workstation_jobs(task_id, workstation_id);

alter table public.workstations enable row level security;
alter table public.workstation_models enable row level security;
alter table public.workstation_messages enable row level security;
alter table public.workstation_jobs enable row level security;

-- Współdzielony team-space dla aktualnego MVP.
drop policy if exists "Authenticated team reads tasks" on public.tasks;
create policy "Authenticated team reads tasks" on public.tasks
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated team updates tasks" on public.tasks;
create policy "Authenticated team updates tasks" on public.tasks
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "Authenticated team reads assignments" on public.assignments;
create policy "Authenticated team reads assignments" on public.assignments
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated team inserts assignments" on public.assignments;
create policy "Authenticated team inserts assignments" on public.assignments
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Authenticated team updates assignments" on public.assignments;
create policy "Authenticated team updates assignments" on public.assignments
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "Authenticated team reads messages" on public.messages;
create policy "Authenticated team reads messages" on public.messages
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated team inserts messages" on public.messages;
create policy "Authenticated team inserts messages" on public.messages
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Authenticated team reads agents" on public.agents;
create policy "Authenticated team reads agents" on public.agents
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated team inserts agents" on public.agents;
create policy "Authenticated team inserts agents" on public.agents
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Authenticated team updates agents" on public.agents;
create policy "Authenticated team updates agents" on public.agents
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "Authenticated team deletes agents" on public.agents;
create policy "Authenticated team deletes agents" on public.agents
  for delete to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users read workstations" on public.workstations;
create policy "Authenticated users read workstations" on public.workstations
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Operator inserts workstation" on public.workstations;
create policy "Operator inserts workstation" on public.workstations
  for insert to authenticated
  with check (operator_user_id = auth.uid());

drop policy if exists "Operator updates workstation" on public.workstations;
create policy "Operator updates workstation" on public.workstations
  for update to authenticated
  using (operator_user_id = auth.uid())
  with check (operator_user_id = auth.uid());

drop policy if exists "Operator deletes workstation" on public.workstations;
create policy "Operator deletes workstation" on public.workstations
  for delete to authenticated
  using (operator_user_id = auth.uid());

drop policy if exists "Authenticated users read workstation models" on public.workstation_models;
create policy "Authenticated users read workstation models" on public.workstation_models
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Operator manages workstation models" on public.workstation_models;
create policy "Operator manages workstation models" on public.workstation_models
  for all to authenticated
  using (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and w.operator_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and w.operator_user_id = auth.uid()
    )
  );

drop policy if exists "Authenticated users read workstation messages" on public.workstation_messages;
create policy "Authenticated users read workstation messages" on public.workstation_messages
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users insert workstation_messages" on public.workstation_messages;
create policy "Authenticated users insert workstation_messages" on public.workstation_messages
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Authenticated users update workstation messages" on public.workstation_messages;
create policy "Authenticated users update workstation messages" on public.workstation_messages
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "Authenticated users read workstation jobs" on public.workstation_jobs;
create policy "Authenticated users read workstation jobs" on public.workstation_jobs
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users insert workstation jobs" on public.workstation_jobs;
create policy "Authenticated users insert workstation jobs" on public.workstation_jobs
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Requester or operator updates workstation jobs" on public.workstation_jobs;
create policy "Requester or operator updates workstation jobs" on public.workstation_jobs
  for update to authenticated
  using (
    requested_by_user_id = auth.uid()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and w.operator_user_id = auth.uid()
    )
  )
  with check (
    requested_by_user_id = auth.uid()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and w.operator_user_id = auth.uid()
    )
  );

drop trigger if exists set_workstations_updated_at on public.workstations;
create trigger set_workstations_updated_at
before update on public.workstations
for each row execute function public.update_updated_at();

drop trigger if exists set_workstation_models_updated_at on public.workstation_models;
create trigger set_workstation_models_updated_at
before update on public.workstation_models
for each row execute function public.update_updated_at();

drop trigger if exists set_workstation_jobs_updated_at on public.workstation_jobs;
create trigger set_workstation_jobs_updated_at
before update on public.workstation_jobs
for each row execute function public.update_updated_at();
