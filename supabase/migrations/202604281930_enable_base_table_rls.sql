-- Explicitly enable RLS on the original MVP tables.
-- Policies for these tables are defined in earlier migrations, but enabling RLS
-- here makes the security boundary visible and idempotent for existing forks.

alter table public.tasks enable row level security;
alter table public.assignments enable row level security;
alter table public.messages enable row level security;
alter table public.agents enable row level security;
