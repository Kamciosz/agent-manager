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
