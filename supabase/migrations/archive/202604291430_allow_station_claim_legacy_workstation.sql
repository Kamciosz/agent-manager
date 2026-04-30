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