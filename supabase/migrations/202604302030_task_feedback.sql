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