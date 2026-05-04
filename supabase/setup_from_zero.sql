-- Agent Manager: fresh setup SQL for a brand-new Supabase project.
-- Generated from supabase/migrations in filename order.
-- Use this file only for a fresh installation from zero.
-- For an existing installation, apply only the new files from supabase/migrations/.


-- FILE: 202604281500_shared_workstations_mvp.sql

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


-- FILE: 202604281620_fix_update_updated_at_search_path.sql

create or replace function public.update_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- FILE: 202604281730_add_task_delete_policy.sql

drop policy if exists "Authenticated team deletes tasks" on public.tasks;
create policy "Authenticated team deletes tasks" on public.tasks
  for delete to authenticated
  using (auth.uid() is not null);


-- FILE: 202604281810_optimize_rls_policies_and_indexes.sql

create index if not exists idx_agents_user_id on public.agents(user_id);
create index if not exists idx_messages_task_id on public.messages(task_id);
create index if not exists idx_tasks_user_id on public.tasks(user_id);
create index if not exists idx_workstation_jobs_requested_by_user on public.workstation_jobs(requested_by_user_id);
create index if not exists idx_workstation_messages_task_id on public.workstation_messages(task_id);

-- Usuń starsze polityki per-role/per-user. Alpha działa jako wspólny team-space.
drop policy if exists "Manager zarządza profilami" on public.agents;
drop policy if exists "Manager widzi wszystkie profile" on public.agents;
drop policy if exists "Użytkownik widzi swój profil" on public.agents;

drop policy if exists "Manager tworzy przydziały" on public.assignments;
drop policy if exists "Executor widzi swoje przydziały" on public.assignments;
drop policy if exists "Manager widzi wszystkie przydziały" on public.assignments;
drop policy if exists "Executor aktualizuje swój przydział" on public.assignments;
drop policy if exists "Manager aktualizuje przydziały" on public.assignments;

drop policy if exists "Agent wysyła wiadomości" on public.messages;
drop policy if exists "Agent widzi swoje wiadomości" on public.messages;
drop policy if exists "Manager widzi wszystkie wiadomości" on public.messages;

drop policy if exists "Użytkownik tworzy zadania" on public.tasks;
drop policy if exists "Manager widzi wszystkie zadania" on public.tasks;
drop policy if exists "Użytkownik widzi swoje zadania" on public.tasks;
drop policy if exists "Executor aktualizuje status swoich zadań" on public.tasks;
drop policy if exists "Manager może aktualizować zadania" on public.tasks;

-- Odtwórz polityki team-space w formie zgodnej z Supabase RLS performance advisor.
drop policy if exists "Authenticated team reads tasks" on public.tasks;
create policy "Authenticated team reads tasks" on public.tasks
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated team inserts tasks" on public.tasks;
create policy "Authenticated team inserts tasks" on public.tasks
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated team updates tasks" on public.tasks;
create policy "Authenticated team updates tasks" on public.tasks
  for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated team deletes tasks" on public.tasks;
create policy "Authenticated team deletes tasks" on public.tasks
  for delete to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated team reads assignments" on public.assignments;
create policy "Authenticated team reads assignments" on public.assignments
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated team inserts assignments" on public.assignments;
create policy "Authenticated team inserts assignments" on public.assignments
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated team updates assignments" on public.assignments;
create policy "Authenticated team updates assignments" on public.assignments
  for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated team reads messages" on public.messages;
create policy "Authenticated team reads messages" on public.messages
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated team inserts messages" on public.messages;
create policy "Authenticated team inserts messages" on public.messages
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated team reads agents" on public.agents;
create policy "Authenticated team reads agents" on public.agents
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated team inserts agents" on public.agents;
create policy "Authenticated team inserts agents" on public.agents
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated team updates agents" on public.agents;
create policy "Authenticated team updates agents" on public.agents
  for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated team deletes agents" on public.agents;
create policy "Authenticated team deletes agents" on public.agents
  for delete to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated users read workstations" on public.workstations;
create policy "Authenticated users read workstations" on public.workstations
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Operator inserts workstation" on public.workstations;
create policy "Operator inserts workstation" on public.workstations
  for insert to authenticated
  with check (operator_user_id = (select auth.uid()));

drop policy if exists "Operator updates workstation" on public.workstations;
create policy "Operator updates workstation" on public.workstations
  for update to authenticated
  using (operator_user_id = (select auth.uid()))
  with check (operator_user_id = (select auth.uid()));

drop policy if exists "Operator deletes workstation" on public.workstations;
create policy "Operator deletes workstation" on public.workstations
  for delete to authenticated
  using (operator_user_id = (select auth.uid()));

drop policy if exists "Operator manages workstation models" on public.workstation_models;
drop policy if exists "Authenticated users read workstation models" on public.workstation_models;
create policy "Authenticated users read workstation models" on public.workstation_models
  for select to authenticated
  using ((select auth.uid()) is not null);

create policy "Operator inserts workstation models" on public.workstation_models
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and w.operator_user_id = (select auth.uid())
    )
  );

create policy "Operator updates workstation models" on public.workstation_models
  for update to authenticated
  using (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and w.operator_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and w.operator_user_id = (select auth.uid())
    )
  );

create policy "Operator deletes workstation models" on public.workstation_models
  for delete to authenticated
  using (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and w.operator_user_id = (select auth.uid())
    )
  );

drop policy if exists "Authenticated users read workstation messages" on public.workstation_messages;
create policy "Authenticated users read workstation messages" on public.workstation_messages
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated users insert workstation_messages" on public.workstation_messages;
create policy "Authenticated users insert workstation_messages" on public.workstation_messages
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated users update workstation messages" on public.workstation_messages;
create policy "Authenticated users update workstation messages" on public.workstation_messages
  for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "Authenticated users read workstation jobs" on public.workstation_jobs;
create policy "Authenticated users read workstation jobs" on public.workstation_jobs
  for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated users insert workstation jobs" on public.workstation_jobs;
create policy "Authenticated users insert workstation jobs" on public.workstation_jobs
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "Requester or operator updates workstation jobs" on public.workstation_jobs;
create policy "Requester or operator updates workstation jobs" on public.workstation_jobs
  for update to authenticated
  using (
    requested_by_user_id = (select auth.uid())
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and w.operator_user_id = (select auth.uid())
    )
  )
  with check (
    requested_by_user_id = (select auth.uid())
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and w.operator_user_id = (select auth.uid())
    )
  );


-- FILE: 202604281845_seed_default_agent_profiles.sql

insert into public.agents (name, role, skills, concurrency_limit)
select 'AI Kierownik', 'manager', array['planowanie', 'koordynacja', 'przydział'], 1
where not exists (
  select 1 from public.agents where name = 'AI Kierownik'
);

insert into public.agents (name, role, skills, concurrency_limit)
select 'Executor Kodujący', 'executor', array['javascript', 'supabase', 'ui'], 2
where not exists (
  select 1 from public.agents where name = 'Executor Kodujący'
);

insert into public.agents (name, role, skills, concurrency_limit)
select 'Tester Weryfikator', 'specialist', array['testy', 'debug', 'review'], 2
where not exists (
  select 1 from public.agents where name = 'Tester Weryfikator'
);


-- FILE: 202604281850_fix_seeded_agent_profile_labels.sql

update public.agents
set skills = array_replace(skills, 'przydzial', 'przydział')
where name = 'AI Kierownik';

update public.agents
set name = 'Executor Kodujący'
where name = 'Executor Kodujacy';


-- FILE: 202604281930_enable_base_table_rls.sql

-- Explicitly enable RLS on the original MVP tables.
-- Policies for these tables are defined in earlier migrations, but enabling RLS
-- here makes the security boundary visible and idempotent for existing forks.

alter table public.tasks enable row level security;
alter table public.assignments enable row level security;
alter table public.messages enable row level security;
alter table public.agents enable row level security;


-- FILE: 202604291030_seed_hermes_labyrinth_profiles.sql

insert into public.agents (name, role, skills, concurrency_limit)
select 'Hermes Navigator', 'manager', array['labyrinth', 'routing', 'planowanie', 'dekompozycja'], 1
where not exists (
  select 1 from public.agents where name = 'Hermes Navigator'
);

insert into public.agents (name, role, skills, concurrency_limit)
select 'Hermes Scout', 'specialist', array['research', 'repo-map', 'kontekst', 'ryzyka'], 2
where not exists (
  select 1 from public.agents where name = 'Hermes Scout'
);

insert into public.agents (name, role, skills, concurrency_limit)
select 'Hermes Builder', 'executor', array['implementacja', 'refactor', 'integracja', 'runtime'], 2
where not exists (
  select 1 from public.agents where name = 'Hermes Builder'
);

insert into public.agents (name, role, skills, concurrency_limit)
select 'Hermes Verifier', 'specialist', array['testy', 'security', 'review', 'regresje'], 2
where not exists (
  select 1 from public.agents where name = 'Hermes Verifier'
);

insert into public.agents (name, role, skills, concurrency_limit)
select 'Hermes Scribe', 'specialist', array['raport', 'docs', 'podsumowanie', 'handoff'], 1
where not exists (
  select 1 from public.agents where name = 'Hermes Scribe'
);


-- FILE: 202604291200_workstation_enrollment_tokens.sql

create or replace function public.current_user_app_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
$$;

create or replace function public.current_user_owner_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(auth.jwt() -> 'app_metadata' ->> 'owner_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (auth.jwt() -> 'app_metadata' ->> 'owner_user_id')::uuid
    else null
  end
$$;

create or replace function public.is_workstation_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and public.current_user_app_role() = 'workstation'
$$;

create or replace function public.is_app_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and public.current_user_app_role() <> 'workstation'
$$;

create table if not exists public.workstation_enrollment_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_workstation_name text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  uses_allowed integer not null default 1 check (uses_allowed between 1 and 50),
  used_count integer not null default 0 check (used_count >= 0),
  revoked_at timestamptz,
  last_redeemed_at timestamptz,
  last_redeemed_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workstation_enrollment_tokens enable row level security;

create index if not exists idx_workstation_enrollment_tokens_created_by on public.workstation_enrollment_tokens(created_by_user_id, created_at desc);
create index if not exists idx_workstation_enrollment_tokens_active on public.workstation_enrollment_tokens(expires_at, revoked_at) where revoked_at is null;

alter table public.workstations
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists station_user_id uuid references auth.users(id) on delete set null,
  add column if not exists enrollment_token_id uuid references public.workstation_enrollment_tokens(id) on delete set null;

update public.workstations
set owner_user_id = operator_user_id
where owner_user_id is null;

create index if not exists idx_workstations_owner_user on public.workstations(owner_user_id);
create index if not exists idx_workstations_station_user on public.workstations(station_user_id);
create index if not exists idx_workstations_enrollment_token on public.workstations(enrollment_token_id);

create or replace function public.claim_workstation_enrollment_token(
  p_token_hash text,
  p_redeem_metadata jsonb default '{}'::jsonb
)
returns public.workstation_enrollment_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.workstation_enrollment_tokens;
begin
  update public.workstation_enrollment_tokens
  set used_count = used_count + 1,
      last_redeemed_at = now(),
      last_redeemed_metadata = coalesce(p_redeem_metadata, '{}'::jsonb),
      updated_at = now()
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
    and used_count < uses_allowed
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_workstation_enrollment_token(text, jsonb) from public;
revoke all on function public.claim_workstation_enrollment_token(text, jsonb) from anon;
revoke all on function public.claim_workstation_enrollment_token(text, jsonb) from authenticated;
grant execute on function public.claim_workstation_enrollment_token(text, jsonb) to service_role;

-- Token records are managed by authenticated app users and Edge Functions.
drop policy if exists "App users read own workstation enrollment tokens" on public.workstation_enrollment_tokens;
create policy "App users read own workstation enrollment tokens" on public.workstation_enrollment_tokens
  for select to authenticated
  using (public.is_app_user() and created_by_user_id = (select auth.uid()));

drop policy if exists "App users create own workstation enrollment tokens" on public.workstation_enrollment_tokens;
create policy "App users create own workstation enrollment tokens" on public.workstation_enrollment_tokens
  for insert to authenticated
  with check (public.is_app_user() and created_by_user_id = (select auth.uid()));

drop policy if exists "App users revoke own workstation enrollment tokens" on public.workstation_enrollment_tokens;
create policy "App users revoke own workstation enrollment tokens" on public.workstation_enrollment_tokens
  for update to authenticated
  using (public.is_app_user() and created_by_user_id = (select auth.uid()))
  with check (public.is_app_user() and created_by_user_id = (select auth.uid()));

-- Keep browser panel users in the team-space, but exclude technical workstation users.
drop policy if exists "Authenticated team reads tasks" on public.tasks;
create policy "Authenticated team reads tasks" on public.tasks
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "Authenticated team inserts tasks" on public.tasks;
create policy "Authenticated team inserts tasks" on public.tasks
  for insert to authenticated
  with check (public.is_app_user());

drop policy if exists "Authenticated team updates tasks" on public.tasks;
create policy "Authenticated team updates tasks" on public.tasks
  for update to authenticated
  using (public.is_app_user())
  with check (public.is_app_user());

drop policy if exists "Authenticated team deletes tasks" on public.tasks;
create policy "Authenticated team deletes tasks" on public.tasks
  for delete to authenticated
  using (public.is_app_user());

drop policy if exists "Workstation updates assigned task status" on public.tasks;
create policy "Workstation updates assigned task status" on public.tasks
  for update to authenticated
  using (
    public.is_workstation_user()
    and exists (
      select 1
      from public.workstation_jobs j
      join public.workstations w on w.id = j.workstation_id
      where j.task_id = tasks.id
        and w.station_user_id = (select auth.uid())
    )
  )
  with check (
    public.is_workstation_user()
    and exists (
      select 1
      from public.workstation_jobs j
      join public.workstations w on w.id = j.workstation_id
      where j.task_id = tasks.id
        and w.station_user_id = (select auth.uid())
    )
  );

-- Main app tables remain visible to real app users, not station accounts.
drop policy if exists "Authenticated team reads assignments" on public.assignments;
create policy "Authenticated team reads assignments" on public.assignments
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "Authenticated team inserts assignments" on public.assignments;
create policy "Authenticated team inserts assignments" on public.assignments
  for insert to authenticated
  with check (public.is_app_user());

drop policy if exists "Authenticated team updates assignments" on public.assignments;
create policy "Authenticated team updates assignments" on public.assignments
  for update to authenticated
  using (public.is_app_user())
  with check (public.is_app_user());

drop policy if exists "Authenticated team reads messages" on public.messages;
create policy "Authenticated team reads messages" on public.messages
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "Authenticated team inserts messages" on public.messages;
create policy "Authenticated team inserts messages" on public.messages
  for insert to authenticated
  with check (public.is_app_user());

drop policy if exists "Authenticated team reads agents" on public.agents;
create policy "Authenticated team reads agents" on public.agents
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "Authenticated team inserts agents" on public.agents;
create policy "Authenticated team inserts agents" on public.agents
  for insert to authenticated
  with check (public.is_app_user());

drop policy if exists "Authenticated team updates agents" on public.agents;
create policy "Authenticated team updates agents" on public.agents
  for update to authenticated
  using (public.is_app_user())
  with check (public.is_app_user());

drop policy if exists "Authenticated team deletes agents" on public.agents;
create policy "Authenticated team deletes agents" on public.agents
  for delete to authenticated
  using (public.is_app_user());

-- Workstations: app users can view; station accounts can manage only themselves.
drop policy if exists "Authenticated users read workstations" on public.workstations;
drop policy if exists "Operator inserts workstation" on public.workstations;
drop policy if exists "Operator updates workstation" on public.workstations;
drop policy if exists "Operator deletes workstation" on public.workstations;

drop policy if exists "App users read workstations" on public.workstations;
create policy "App users read workstations" on public.workstations
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "Station reads own workstation" on public.workstations;
create policy "Station reads own workstation" on public.workstations
  for select to authenticated
  using (public.is_workstation_user() and station_user_id = (select auth.uid()));

drop policy if exists "Station inserts own workstation" on public.workstations;
create policy "Station inserts own workstation" on public.workstations
  for insert to authenticated
  with check (
    (
      public.is_workstation_user()
      and station_user_id = (select auth.uid())
      and owner_user_id = public.current_user_owner_id()
      and operator_user_id = owner_user_id
    )
    or (
      public.is_app_user()
      and operator_user_id = (select auth.uid())
      and coalesce(owner_user_id, operator_user_id) = (select auth.uid())
    )
  );

drop policy if exists "Station updates own workstation" on public.workstations;
create policy "Station updates own workstation" on public.workstations
  for update to authenticated
  using (
    (
      public.is_workstation_user()
      and (
        station_user_id = (select auth.uid())
        or (station_user_id is null and owner_user_id = public.current_user_owner_id())
      )
    )
    or (public.is_app_user() and operator_user_id = (select auth.uid()))
  )
  with check (
    (public.is_workstation_user() and station_user_id = (select auth.uid()) and owner_user_id = public.current_user_owner_id() and operator_user_id = owner_user_id)
    or (public.is_app_user() and operator_user_id = (select auth.uid()))
  );

drop policy if exists "App users delete own workstations" on public.workstations;
create policy "App users delete own workstations" on public.workstations
  for delete to authenticated
  using (public.is_app_user() and operator_user_id = (select auth.uid()));

-- Workstation models: app users read, station accounts manage only own station models.
drop policy if exists "Operator manages workstation models" on public.workstation_models;
drop policy if exists "Authenticated users read workstation models" on public.workstation_models;
drop policy if exists "Operator inserts workstation models" on public.workstation_models;
drop policy if exists "Operator updates workstation models" on public.workstation_models;
drop policy if exists "Operator deletes workstation models" on public.workstation_models;

drop policy if exists "App users read workstation models" on public.workstation_models;
create policy "App users read workstation models" on public.workstation_models
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "Station reads own workstation models" on public.workstation_models;
create policy "Station reads own workstation models" on public.workstation_models
  for select to authenticated
  using (
    public.is_workstation_user()
    and exists (
      select 1 from public.workstations w
      where w.id = workstation_models.workstation_id
        and w.station_user_id = (select auth.uid())
    )
  );

drop policy if exists "Station manages own workstation models" on public.workstation_models;
create policy "Station manages own workstation models" on public.workstation_models
  for all to authenticated
  using (
    exists (
      select 1 from public.workstations w
      where w.id = workstation_models.workstation_id
        and (
          (public.is_workstation_user() and w.station_user_id = (select auth.uid()))
          or (public.is_app_user() and w.operator_user_id = (select auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from public.workstations w
      where w.id = workstation_models.workstation_id
        and (
          (public.is_workstation_user() and w.station_user_id = (select auth.uid()))
          or (public.is_app_user() and w.operator_user_id = (select auth.uid()))
        )
    )
  );

-- Workstation messages: app users manage all; station accounts manage messages for their station only.
drop policy if exists "Authenticated users read workstation messages" on public.workstation_messages;
drop policy if exists "Authenticated users insert workstation_messages" on public.workstation_messages;
drop policy if exists "Authenticated users update workstation messages" on public.workstation_messages;

drop policy if exists "App users read workstation messages" on public.workstation_messages;
create policy "App users read workstation messages" on public.workstation_messages
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "App users insert workstation messages" on public.workstation_messages;
create policy "App users insert workstation messages" on public.workstation_messages
  for insert to authenticated
  with check (public.is_app_user());

drop policy if exists "App users update workstation messages" on public.workstation_messages;
create policy "App users update workstation messages" on public.workstation_messages
  for update to authenticated
  using (public.is_app_user())
  with check (public.is_app_user());

drop policy if exists "Station reads own workstation messages" on public.workstation_messages;
create policy "Station reads own workstation messages" on public.workstation_messages
  for select to authenticated
  using (
    public.is_workstation_user()
    and exists (
      select 1 from public.workstations w
      where w.id = workstation_messages.workstation_id
        and w.station_user_id = (select auth.uid())
    )
  );

drop policy if exists "Station inserts own workstation messages" on public.workstation_messages;
create policy "Station inserts own workstation messages" on public.workstation_messages
  for insert to authenticated
  with check (
    public.is_workstation_user()
    and exists (
      select 1 from public.workstations w
      where w.id = workstation_messages.workstation_id
        and w.station_user_id = (select auth.uid())
    )
  );

drop policy if exists "Station updates own workstation messages" on public.workstation_messages;
create policy "Station updates own workstation messages" on public.workstation_messages
  for update to authenticated
  using (
    public.is_workstation_user()
    and exists (
      select 1 from public.workstations w
      where w.id = workstation_messages.workstation_id
        and w.station_user_id = (select auth.uid())
    )
  )
  with check (
    public.is_workstation_user()
    and exists (
      select 1 from public.workstations w
      where w.id = workstation_messages.workstation_id
        and w.station_user_id = (select auth.uid())
    )
  );

-- Workstation jobs: app users queue jobs; station accounts read/update only their queue.
drop policy if exists "Authenticated users read workstation jobs" on public.workstation_jobs;
drop policy if exists "Authenticated users insert workstation jobs" on public.workstation_jobs;
drop policy if exists "Requester or operator updates workstation jobs" on public.workstation_jobs;

drop policy if exists "App users read workstation jobs" on public.workstation_jobs;
create policy "App users read workstation jobs" on public.workstation_jobs
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "App users insert workstation jobs" on public.workstation_jobs;
create policy "App users insert workstation jobs" on public.workstation_jobs
  for insert to authenticated
  with check (public.is_app_user());

drop policy if exists "App users update workstation jobs" on public.workstation_jobs;
create policy "App users update workstation jobs" on public.workstation_jobs
  for update to authenticated
  using (public.is_app_user())
  with check (public.is_app_user());

drop policy if exists "Station reads own workstation jobs" on public.workstation_jobs;
create policy "Station reads own workstation jobs" on public.workstation_jobs
  for select to authenticated
  using (
    public.is_workstation_user()
    and exists (
      select 1 from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and w.station_user_id = (select auth.uid())
    )
  );

drop policy if exists "Station updates own workstation jobs" on public.workstation_jobs;
create policy "Station updates own workstation jobs" on public.workstation_jobs
  for update to authenticated
  using (
    public.is_workstation_user()
    and exists (
      select 1 from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and w.station_user_id = (select auth.uid())
    )
  )
  with check (
    public.is_workstation_user()
    and exists (
      select 1 from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and w.station_user_id = (select auth.uid())
    )
  );


-- FILE: 202604291330_merge_workstation_role_policies.sql

drop policy if exists "Authenticated team updates tasks" on public.tasks;
drop policy if exists "Workstation updates assigned task status" on public.tasks;
create policy "Authenticated users update tasks by role" on public.tasks
  for update to authenticated
  using (
    public.is_app_user()
    or (
      public.is_workstation_user()
      and exists (
        select 1
        from public.workstation_jobs j
        join public.workstations w on w.id = j.workstation_id
        where j.task_id = tasks.id
          and w.station_user_id = (select auth.uid())
      )
    )
  )
  with check (
    public.is_app_user()
    or (
      public.is_workstation_user()
      and exists (
        select 1
        from public.workstation_jobs j
        join public.workstations w on w.id = j.workstation_id
        where j.task_id = tasks.id
          and w.station_user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "App users read workstations" on public.workstations;
drop policy if exists "Station reads own workstation" on public.workstations;
create policy "Authenticated users read workstations by role" on public.workstations
  for select to authenticated
  using (
    public.is_app_user()
    or (public.is_workstation_user() and station_user_id = (select auth.uid()))
  );

drop policy if exists "App users read workstation models" on public.workstation_models;
drop policy if exists "Station reads own workstation models" on public.workstation_models;
drop policy if exists "Station manages own workstation models" on public.workstation_models;

create policy "Authenticated users read workstation models by role" on public.workstation_models
  for select to authenticated
  using (
    public.is_app_user()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and public.is_workstation_user()
        and w.station_user_id = (select auth.uid())
    )
  );

create policy "Authenticated users insert workstation models by role" on public.workstation_models
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and (
          (public.is_workstation_user() and w.station_user_id = (select auth.uid()))
          or (public.is_app_user() and w.operator_user_id = (select auth.uid()))
        )
    )
  );

create policy "Authenticated users update workstation models by role" on public.workstation_models
  for update to authenticated
  using (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and (
          (public.is_workstation_user() and w.station_user_id = (select auth.uid()))
          or (public.is_app_user() and w.operator_user_id = (select auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and (
          (public.is_workstation_user() and w.station_user_id = (select auth.uid()))
          or (public.is_app_user() and w.operator_user_id = (select auth.uid()))
        )
    )
  );

create policy "Authenticated users delete workstation models by role" on public.workstation_models
  for delete to authenticated
  using (
    exists (
      select 1
      from public.workstations w
      where w.id = workstation_models.workstation_id
        and (
          (public.is_workstation_user() and w.station_user_id = (select auth.uid()))
          or (public.is_app_user() and w.operator_user_id = (select auth.uid()))
        )
    )
  );

drop policy if exists "App users read workstation messages" on public.workstation_messages;
drop policy if exists "Station reads own workstation messages" on public.workstation_messages;
create policy "Authenticated users read workstation messages by role" on public.workstation_messages
  for select to authenticated
  using (
    public.is_app_user()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_messages.workstation_id
        and public.is_workstation_user()
        and w.station_user_id = (select auth.uid())
    )
  );

drop policy if exists "App users insert workstation messages" on public.workstation_messages;
drop policy if exists "Station inserts own workstation messages" on public.workstation_messages;
create policy "Authenticated users insert workstation messages by role" on public.workstation_messages
  for insert to authenticated
  with check (
    public.is_app_user()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_messages.workstation_id
        and public.is_workstation_user()
        and w.station_user_id = (select auth.uid())
    )
  );

drop policy if exists "App users update workstation messages" on public.workstation_messages;
drop policy if exists "Station updates own workstation messages" on public.workstation_messages;
create policy "Authenticated users update workstation messages by role" on public.workstation_messages
  for update to authenticated
  using (
    public.is_app_user()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_messages.workstation_id
        and public.is_workstation_user()
        and w.station_user_id = (select auth.uid())
    )
  )
  with check (
    public.is_app_user()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_messages.workstation_id
        and public.is_workstation_user()
        and w.station_user_id = (select auth.uid())
    )
  );

drop policy if exists "App users read workstation jobs" on public.workstation_jobs;
drop policy if exists "Station reads own workstation jobs" on public.workstation_jobs;
create policy "Authenticated users read workstation jobs by role" on public.workstation_jobs
  for select to authenticated
  using (
    public.is_app_user()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and public.is_workstation_user()
        and w.station_user_id = (select auth.uid())
    )
  );

drop policy if exists "App users update workstation jobs" on public.workstation_jobs;
drop policy if exists "Station updates own workstation jobs" on public.workstation_jobs;
create policy "Authenticated users update workstation jobs by role" on public.workstation_jobs
  for update to authenticated
  using (
    public.is_app_user()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and public.is_workstation_user()
        and w.station_user_id = (select auth.uid())
    )
  )
  with check (
    public.is_app_user()
    or exists (
      select 1
      from public.workstations w
      where w.id = workstation_jobs.workstation_id
        and public.is_workstation_user()
        and w.station_user_id = (select auth.uid())
    )
  );

-- FILE: 202604291430_allow_station_claim_legacy_workstation.sql

drop policy if exists "Authenticated users read workstations by role" on public.workstations;

create policy "Authenticated users read workstations by role" on public.workstations
  for select to authenticated
  using (
    public.is_app_user()
    or (
      public.is_workstation_user()
      and (
        station_user_id = (select auth.uid())
        or (station_user_id is null and owner_user_id = public.current_user_owner_id())
      )
    )
  );

-- FILE: 202604291650_classroom_grid_and_task_log_cleanup.sql

alter table public.workstations
  add column if not exists classroom_label text,
  add column if not exists grid_row integer check (grid_row is null or grid_row between 1 and 99),
  add column if not exists grid_col integer check (grid_col is null or grid_col between 1 and 99),
  add column if not exists grid_label text;

create index if not exists idx_workstations_classroom_grid
  on public.workstations(owner_user_id, classroom_label, grid_row, grid_col);

drop policy if exists "Authenticated team deletes messages" on public.messages;
create policy "Authenticated team deletes messages" on public.messages
  for delete to authenticated
  using (public.is_app_user());

drop policy if exists "App users delete workstation messages" on public.workstation_messages;
drop policy if exists "Authenticated users delete workstation messages by role" on public.workstation_messages;
create policy "Authenticated users delete workstation messages by role" on public.workstation_messages
  for delete to authenticated
  using (public.is_app_user());


-- FILE: 202604291900_task_quota_and_retry_lifecycle.sql

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


-- FILE: 202604291910_task_quota_advisor_fixes.sql

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


-- FILE: 202604291930_task_quota_update_lifecycle.sql

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

-- FILE: 202604302030_task_feedback.sql

create table if not exists public.task_feedback (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  rating text not null check (rating in ('good', 'bad')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, user_id)
);

alter table public.task_feedback enable row level security;

create index if not exists idx_task_feedback_task
  on public.task_feedback(task_id, created_at desc);

create index if not exists idx_task_feedback_user
  on public.task_feedback(user_id, created_at desc);

drop trigger if exists update_task_feedback_updated_at on public.task_feedback;
create trigger update_task_feedback_updated_at
before update on public.task_feedback
for each row execute function public.update_updated_at();

drop policy if exists "App users read task feedback" on public.task_feedback;
create policy "App users read task feedback" on public.task_feedback
  for select to authenticated
  using (public.is_app_user());

drop policy if exists "App users insert own task feedback" on public.task_feedback;
create policy "App users insert own task feedback" on public.task_feedback
  for insert to authenticated
  with check (public.is_app_user() and user_id = (select auth.uid()));

drop policy if exists "App users update own task feedback" on public.task_feedback;
create policy "App users update own task feedback" on public.task_feedback
  for update to authenticated
  using (public.is_app_user() and user_id = (select auth.uid()))
  with check (public.is_app_user() and user_id = (select auth.uid()));

drop policy if exists "App users delete own task feedback" on public.task_feedback;
create policy "App users delete own task feedback" on public.task_feedback
  for delete to authenticated
  using (public.is_app_user() and user_id = (select auth.uid()));

-- FILE: 202604302040_task_feedback_advisor_cleanup.sql

drop index if exists public.idx_task_feedback_task;

-- FILE: 202604302050_task_feedback_user_fk_index.sql

create index if not exists idx_task_feedback_user
  on public.task_feedback(user_id);

-- FILE: 202604302120_task_events_audit_log.sql

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

-- FILE: 202604302240_restrict_app_user_roles.sql

do $$
declare
  approved_users integer;
  unassigned_users integer;
begin
  select count(*) into approved_users
  from auth.users
  where coalesce(raw_app_meta_data ->> 'role', '') in ('admin', 'manager', 'operator', 'teacher', 'executor', 'viewer');

  select count(*) into unassigned_users
  from auth.users
  where coalesce(raw_app_meta_data ->> 'role', '') = '';

  if approved_users = 0 and unassigned_users = 1 then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'operator')
    where id = (
      select id
      from auth.users
      where coalesce(raw_app_meta_data ->> 'role', '') = ''
      order by created_at asc
      limit 1
    );
  end if;
end $$;

create or replace function public.is_app_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and public.current_user_app_role() in ('admin', 'manager', 'operator', 'teacher', 'executor', 'viewer')
$$;

-- FILE: 202604302320_job_lease_and_gateway_metrics.sql

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


-- FILE: 202604302330_claim_workstation_jobs_security_invoker.sql

-- Keep exposed workstation claim RPC under caller RLS privileges.

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


-- FILE: 202604302350_release_expired_workstation_jobs.sql

-- Sweeper wygasłych lease w workstation_jobs.
-- Zadanie nieprzejęte przez stację w czasie lease_expires_at wraca do statusu
-- queued (lub retrying), żeby inna stacja mogła je zabrać. Po przekroczeniu
-- max_attempts trafia do dead_letter. Funkcja jest SECURITY INVOKER, więc
-- działa wyłącznie w ramach uprawnień wywołującego (RLS pilnuje dostępu).

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
    select id, retry_count, max_attempts
    from public.workstation_jobs
    where status in ('leased', 'running')
      and lease_expires_at is not null
      and lease_expires_at < now()
      and (p_workstation_id is null or workstation_id = p_workstation_id)
    for update skip locked
  ), updated as (
    update public.workstation_jobs j
    set
      status = case
        when expired.retry_count + 1 >= coalesce(expired.max_attempts, 3) then 'dead_letter'
        else 'queued'
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = 'lease_expired',
      last_error_at = now(),
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
  'Zwalnia joby workstation_jobs z wygasłym lease. Wywoływane przez stację co poll albo z zaplanowanego zadania.';


-- FILE: 202605041745_runtime_failure_guard.sql

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


-- FILE: 202605041830_task_orchestration_sync.sql

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

