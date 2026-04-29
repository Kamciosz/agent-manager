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
