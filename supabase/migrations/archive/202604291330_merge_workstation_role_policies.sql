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