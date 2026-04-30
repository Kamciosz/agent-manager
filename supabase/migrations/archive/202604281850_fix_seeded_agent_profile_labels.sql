update public.agents
set skills = array_replace(skills, 'przydzial', 'przydział')
where name = 'AI Kierownik';

update public.agents
set name = 'Executor Kodujący'
where name = 'Executor Kodujacy';
