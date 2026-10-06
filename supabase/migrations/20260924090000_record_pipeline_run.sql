-- ============================================================================
-- record_pipeline_run(p jsonb) — roadmap 3.6 · ADR-003
--
-- Writes one pipeline run's whole audit chain in ONE transaction:
--   decision_events (skipped for 'rejected') → pipeline_runs → agent_runs.
-- A plpgsql function body is atomic: if any insert fails, none are kept, so
-- the audit trail never holds a half-written record.
--
-- Server-only: Supabase exposes public functions over its API and grants
-- EXECUTE to everyone by default, so it is revoked explicitly below.
-- Payload shape: frontend/lib/db/audit.ts (toAuditPayload).
-- ============================================================================

create function public.record_pipeline_run(p jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  event_id uuid;
begin
  if p->>'path' <> 'rejected' then
    insert into public.decision_events
      (session_id, action_seq, kind, sim_minute, symbol, facts, summary, state_before)
    values (
      (p->>'session_id')::uuid,
      (p->>'action_seq')::integer,
      p->'event'->>'kind',
      (p->'event'->>'sim_minute')::integer,
      p->'event'->>'symbol',
      coalesce(p->'event'->'facts', '{}'::jsonb),
      p->'event'->>'summary',
      p->'state_before'
    )
    returning id into event_id;
  end if;

  insert into public.pipeline_runs (id, session_id, decision_event_id, path, feedback, notes, timings)
  values (
    (p->>'id')::uuid,
    (p->>'session_id')::uuid,
    event_id,
    p->>'path',
    -- p->'feedback' is the JSON value null (not SQL NULL) when absent-as-null;
    -- nullif turns it into SQL NULL so the rejected/feedback CHECK can see it.
    nullif(p->'feedback', 'null'::jsonb),
    coalesce(array(select jsonb_array_elements_text(p->'notes')), '{}'),
    p->'timings'
  );

  insert into public.agent_runs
    (id, pipeline_run_id, agent, model, status, error, steps, prompt_tokens, completion_tokens, latency_ms)
  select
    (r->>'id')::uuid,
    (p->>'id')::uuid,
    r->>'agent',
    r->>'model',
    r->>'status',
    r->>'error',
    r->'steps',
    (r->>'prompt_tokens')::integer,
    (r->>'completion_tokens')::integer,
    (r->>'latency_ms')::integer
  from jsonb_array_elements(coalesce(p->'agent_runs', '[]'::jsonb)) as r;

  return (p->>'id')::uuid;
end $$;

revoke execute on function public.record_pipeline_run(jsonb) from public, anon, authenticated;
grant execute on function public.record_pipeline_run(jsonb) to service_role;
