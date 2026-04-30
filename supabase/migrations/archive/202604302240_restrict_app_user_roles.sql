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