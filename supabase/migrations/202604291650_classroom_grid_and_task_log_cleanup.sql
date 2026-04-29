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
