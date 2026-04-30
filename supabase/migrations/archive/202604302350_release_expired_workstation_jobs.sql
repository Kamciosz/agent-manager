-- Sweeper wygasłych lease w workstation_jobs.
-- Zadanie nieprzejęte przez stację w czasie lease_expires_at wraca do statusu
-- queued (lub retrying), żeby inna stacja mogła je zabrać. Po przekroczeniu
-- max_attempts trafia do dead_letter. Funkcja jest SECURITY INVOKER, więc
-- działa wyłącznie w ramach uprawnień wywołującego (RLS pilnuje dostępu).

create or replace function public.release_expired_workstation_jobs(
  p_workstation_id uuid default null
)
returns table (
  released_id uuid,
  new_status text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with expired as (
    select id, retry_count, max_attempts
    from public.workstation_jobs
    where status in ('leased', 'running')
      and lease_expires_at is not null
      and lease_expires_at < now()
      and (p_workstation_id is null or workstation_id = p_workstation_id)
    for update skip locked
  ), updated as (
    update public.workstation_jobs j
    set
      status = case
        when expired.retry_count + 1 >= coalesce(expired.max_attempts, 3) then 'dead_letter'
        else 'queued'
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = 'lease_expired',
      last_error_at = now(),
      updated_at = now()
    from expired
    where j.id = expired.id
    returning j.id, j.status, j.retry_count
  )
  select id, status, retry_count from updated;
end;
$$;

revoke all on function public.release_expired_workstation_jobs(uuid) from public;
revoke all on function public.release_expired_workstation_jobs(uuid) from anon;
grant execute on function public.release_expired_workstation_jobs(uuid) to authenticated;

comment on function public.release_expired_workstation_jobs(uuid) is
  'Zwalnia joby workstation_jobs z wygasłym lease. Wywoływane przez stację co poll albo z zaplanowanego zadania.';
