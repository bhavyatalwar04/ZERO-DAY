-- ============================================================================
-- Zero Day V2 — core persistence (roadmap 3.1, 3.2, 3.5, 3.6 · ADR-003)
--
-- Event sourcing: `session_actions` is the append-only source of truth. The
-- engine's pure reducer replays it to rebuild any past state (P1, phased).
-- Everything else is either identity (profiles, sessions) or the audit trail
-- (decision_events → pipeline_runs → agent_runs), which only the server writes.
--
-- Apply with `supabase db push`, or paste into the Supabase SQL editor.
-- Tested against PostgreSQL 18 (PGlite) in frontend/lib/db/migration.test.ts.
-- ============================================================================

-- ─── profiles: one per user (replaces localStorage zdm_user_v2 + user_metadata stats) ──

create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text check (char_length(display_name) <= 80),
  knowledge_level text check (knowledge_level in ('Beginner', 'Intermediate', 'Advanced')),
  -- Research consent (ethics question still open): null until the user agrees.
  consent_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- ─── sessions: one per play-through ─────────────────────────

create table public.sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scenario_id    text not null check (char_length(scenario_id) between 1 and 64),
  -- Replaying an old log through a NEWER reducer can give different states;
  -- this records which engine produced the session.
  engine_version text not null,
  status         text not null default 'active',
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  -- Summary metrics (5.x), computed by the server by replay. Never client-written.
  result         jsonb,
  constraint sessions_status_check check (status in ('active', 'completed', 'abandoned')),
  constraint sessions_ended_when_not_active check ((status = 'active') = (ended_at is null))
);
create index sessions_user_idx on public.sessions (user_id, started_at desc);

-- ─── session_actions: the append-only event log (source of truth) ──

create table public.session_actions (
  session_id  uuid not null references public.sessions (id) on delete cascade,
  seq         integer not null check (seq >= 0),
  sim_minute  integer not null check (sim_minute >= 0),
  -- A reducer action, e.g. {"type":"PLACE_ORDER", ...}. User decisions only;
  -- TICKs are regenerated during replay.
  action      jsonb not null check (jsonb_typeof(action) = 'object' and action ? 'type'),
  client_ts   timestamptz,
  received_at timestamptz not null default now(),
  primary key (session_id, seq)
);

-- ─── decision_events: what Monitor detected (3.2) ───────────

create table public.decision_events (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null,
  -- The logged action that triggered the event: the FK guarantees it exists.
  action_seq   integer not null,
  kind         text not null,
  sim_minute   integer not null check (sim_minute >= 0),
  symbol       text,
  facts        jsonb not null default '{}'::jsonb,
  summary      text not null,
  -- What the user actually saw (cash, positions, pending orders, minute).
  -- Redundant with replay by design: it survives engine changes.
  state_before jsonb not null,
  created_at   timestamptz not null default now(),
  foreign key (session_id, action_seq) references public.session_actions (session_id, seq) on delete cascade
);
create index decision_events_session_idx on public.decision_events (session_id, sim_minute);

-- ─── pipeline_runs: one per event that went through the orchestrator (1.4) ──

create table public.pipeline_runs (
  id                uuid primary key,
  session_id        uuid not null references public.sessions (id) on delete cascade,
  -- null only for 'rejected': the server could not reproduce the claimed event.
  decision_event_id uuid unique references public.decision_events (id) on delete cascade,
  path              text not null,
  feedback          jsonb,
  notes             text[] not null default '{}',
  timings           jsonb not null,
  created_at        timestamptz not null default now(),
  constraint pipeline_runs_path_check check (path in ('full', 'monitor_only', 'template', 'rejected')),
  constraint pipeline_runs_rejected_has_no_event check ((path = 'rejected') = (decision_event_id is null)),
  constraint pipeline_runs_rejected_has_no_feedback check ((path = 'rejected') = (feedback is null))
);
create index pipeline_runs_session_idx on public.pipeline_runs (session_id);

-- ─── agent_runs: every Research/Coach run with its full trace (3.6) ──

create table public.agent_runs (
  id                uuid primary key,
  pipeline_run_id   uuid not null references public.pipeline_runs (id) on delete cascade,
  agent             text not null,
  model             text,
  status            text not null,
  error             text,
  steps             jsonb not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  latency_ms        integer not null default 0,
  created_at        timestamptz not null default now(),
  constraint agent_runs_agent_check check (agent in ('monitor', 'research', 'coach')),
  constraint agent_runs_status_check check (status in
    ('ok', 'step_limit', 'budget_exceeded', 'invalid_output', 'timeout', 'error', 'fallback'))
);
create index agent_runs_pipeline_idx on public.agent_runs (pipeline_run_id);

-- ─── Integrity triggers ─────────────────────────────────────

-- The log and the audit trail are immutable for EVERYONE, including the
-- service role (which bypasses RLS). Deletion stays possible: it's needed for
-- account deletion / data-removal requests, and is controlled by RLS.
create function public.forbid_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: rows cannot be updated', tg_table_name;
end $$;

create trigger session_actions_no_update  before update on public.session_actions for each row execute function public.forbid_update();
create trigger decision_events_no_update  before update on public.decision_events for each row execute function public.forbid_update();
create trigger pipeline_runs_no_update    before update on public.pipeline_runs   for each row execute function public.forbid_update();
create trigger agent_runs_no_update       before update on public.agent_runs      for each row execute function public.forbid_update();

-- Replay needs a complete, ordered log: seq must be contiguous from 0 and
-- sim_minute must never go backwards. Guards against sync bugs (a client
-- can still choose what to send; see ADR-003).
create function public.check_action_order() returns trigger
language plpgsql set search_path = '' as $$
declare
  prev record;
begin
  select seq, sim_minute into prev
    from public.session_actions
   where session_id = new.session_id
   order by seq desc
   limit 1;
  if new.seq <> coalesce(prev.seq + 1, 0) then
    raise exception 'session_actions: expected seq %, got %', coalesce(prev.seq + 1, 0), new.seq;
  end if;
  if prev.sim_minute is not null and new.sim_minute < prev.sim_minute then
    raise exception 'session_actions: sim_minute went backwards (% after %)', new.sim_minute, prev.sim_minute;
  end if;
  return new;
end $$;

create trigger session_actions_order before insert on public.session_actions
  for each row execute function public.check_action_order();

-- ─── Row Level Security (3.5) ───────────────────────────────
-- Users read their own rows. They may create profiles, sessions and actions;
-- they may NEVER write the audit trail (decision_events, pipeline_runs,
-- agent_runs) or a session's result — only the server (service role) does.
-- `(select auth.uid())` is evaluated once per statement, not once per row.

alter table public.profiles        enable row level security;
alter table public.sessions        enable row level security;
alter table public.session_actions enable row level security;
alter table public.decision_events enable row level security;
alter table public.pipeline_runs   enable row level security;
alter table public.agent_runs      enable row level security;

-- Defence in depth: signed-out visitors get nothing, whatever the policies say.
revoke all on public.profiles, public.sessions, public.session_actions,
              public.decision_events, public.pipeline_runs, public.agent_runs from anon;

create policy "profiles: read own"   on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles: create own" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "sessions: read own"  on public.sessions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "sessions: start own" on public.sessions for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'active' and ended_at is null and result is null);
-- No update/delete policy: ending a session and writing its result is server-only.

create policy "actions: read own" on public.session_actions for select to authenticated
  using (exists (select 1 from public.sessions s
                  where s.id = session_id and s.user_id = (select auth.uid())));
create policy "actions: append to own active session" on public.session_actions for insert to authenticated
  with check (exists (select 1 from public.sessions s
                       where s.id = session_id and s.user_id = (select auth.uid()) and s.status = 'active'));

create policy "decision_events: read own" on public.decision_events for select to authenticated
  using (exists (select 1 from public.sessions s
                  where s.id = session_id and s.user_id = (select auth.uid())));

create policy "pipeline_runs: read own" on public.pipeline_runs for select to authenticated
  using (exists (select 1 from public.sessions s
                  where s.id = session_id and s.user_id = (select auth.uid())));

create policy "agent_runs: read own" on public.agent_runs for select to authenticated
  using (exists (select 1 from public.pipeline_runs p
                   join public.sessions s on s.id = p.session_id
                  where p.id = pipeline_run_id and s.user_id = (select auth.uid())));
