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
