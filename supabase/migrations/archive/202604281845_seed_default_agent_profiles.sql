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
