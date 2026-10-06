-- 8.4 Server-side rate limiting (ADR-012). Before this, the only guard on the
-- Groq-backed routes was client-side coalescing: any signed-in user could call
-- /api/pipeline or the ORUS routes in a loop and spend the shared free-tier
-- quota (8k tokens/min per model, 1,000 requests/day).
--
-- consume_quota(bucket, max, window) atomically records one use and returns
-- true, or returns false if the caller already used `max` in the last `window`
-- seconds. It runs as the CALLER (auth.uid()), so a user can only spend their
-- own quota; the table itself has RLS on and no policies, so nobody can read or
-- forge rows directly. Written by Claude at Bhavya's request (2026-10-03).

create table public.api_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket  text not null check (char_length(bucket) between 1 and 32),
  at      timestamptz not null default now()
);
create index api_usage_lookup on public.api_usage (user_id, bucket, at desc);
alter table public.api_usage enable row level security;

create function public.consume_quota(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_used int;
begin
  if v_user is null or p_max < 1 or p_window_seconds < 1 then
    return false;
  end if;
  -- One caller+bucket at a time, so two parallel requests can't both see "one left".
  perform pg_advisory_xact_lock(hashtext(v_user::text || ':' || p_bucket));
  delete from public.api_usage
    where user_id = v_user and bucket = p_bucket and at < now() - make_interval(secs => p_window_seconds);
  select count(*) into v_used from public.api_usage where user_id = v_user and bucket = p_bucket;
  if v_used >= p_max then
    return false;
  end if;
  insert into public.api_usage (user_id, bucket) values (v_user, p_bucket);
  return true;
end;
$$;

revoke all on function public.consume_quota(text, int, int) from public, anon;
grant execute on function public.consume_quota(text, int, int) to authenticated;
