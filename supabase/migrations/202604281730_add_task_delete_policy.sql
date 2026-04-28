drop policy if exists "Authenticated team deletes tasks" on public.tasks;
create policy "Authenticated team deletes tasks" on public.tasks
  for delete to authenticated
  using (auth.uid() is not null);
