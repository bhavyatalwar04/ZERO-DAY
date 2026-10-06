-- TEST ONLY: the minimum of Supabase that our migration relies on, so it can
-- run in PGlite. Mirrors Supabase's behaviour:
--   - auth.uid() reads the JWT subject from the request settings;
--   - roles anon / authenticated / service_role (the last bypasses RLS);
--   - new public tables are granted to all three roles by default, so RLS
--     policies (not grants) are what actually restrict access.

create schema auth;
create table auth.users (id uuid primary key);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select, references on auth.users to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
