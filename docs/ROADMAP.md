# Zero Day V2 — Roadmap

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
**Audit tag** (from `docs/AUDIT.md` §8): `PARTIAL` = reusable pieces exist, `NEW` = nothing exists yet.
Build order: M1 → M3 → M2 → M4 → M5 → M6/M7 → M8. M4 can run in parallel with M2.

_Last updated: 2026-10-03 (all modules pass)_

---

## M0 — Baseline
- [x] 0.1 Repo audit → `docs/AUDIT.md` — reviewed 2026-09-23

## M1 — Agent Runtime & Orchestration — ✅ complete 2026-09-23 (budgets provisional)
- [x] 1.1 DECIDE: function-calling vs MCP vs chained prompts `[BLOCKS M1, M2, M3.6]` — **D (hybrid)**, see ADR-001
- [x] 1.2 Agent base interface (input contract, tool registry, output schema, step cap) — done 2026-09-23 (`lib/agents/`); `executeTool` written by Claude at your request
- [x] 1.3 ReAct loop with step limit + termination condition — Research agent only (ADR-001) · done 2026-09-23 (`lib/agents/react-loop.ts`, 17 tests; written by Claude at your request). First live run 2026-09-23: works on `qwen/qwen3.8-27b` and `openai/gpt-oss-20b` (see `docs/evidence/`)
- [x] 1.4 Supervisor/orchestrator: Monitor → Research → Coach — done 2026-09-23 (`lib/agents/pipeline.ts` + client `coalesce.ts`, 15 tests; ADR-002; written by Claude at your request). **Tested with fake agents only**: real Monitor/Coach come in 2.1/2.5
- [x] 1.5 Structured output enforcement (Zod/JSON schema) — done 2026-09-23: loop validates `submit_findings`; `lib/agents/single-shot.ts` uses strict `json_schema` + Zod + one repair (12 tests; written by Claude at your request). Live: strict mode accepted on `gpt-oss-20b` and `qwen3.8-27b`
- [x] 1.6 Retries, timeouts, single-shot fallback — done 2026-09-23: `withRetry` (backoff + full jitter, transient errors only, `lib/agents/retry.ts`); timeouts in loop/single-shot/pipeline; fallback ladder in 1.4. Written by Claude at your request. `withRetry` gets wired in with the real agents (2.3/2.5)
- [x] 1.7 Token/latency budget per agent call — done 2026-09-23 (**provisional values**): `lib/agents/budgets.ts` + `maxRunTokens` → forced submit → `budget_exceeded`; consistency tests. Numbers come from 2 live runs per model; re-derive from the 2.7 eval set

## M2 — The Three Agents
- [x] 2.1 Monitor Agent — done 2026-10-03 (ADR-006): `lib/monitor/`, six rules over the journal, at most one event per action (priority + 15-min cooldown), runs in browser and server (`monitorSession` = server re-check by replay). `revenge_trade`, `news_reflex`, `oversized_position`, `overtrading` (Claude, 2026-10-02); `panic_sell` ("on-screen red") and `averaging_down`: specs and thresholds by Bhavya, implementations written by Claude at Bhavya's request (2026-10-03). 28 tests; every condition mutation-checked (one surviving mutation found and fixed with an isolation test). Live in production since 2026-10-02 (news_reflex detected on a real session)
- [x] 2.2 Monitor tools — met by design (ADR-001/006/012): Monitor is deterministic, so its "tools" are the rule context it is given — position, portfolio state, scenario clock, prices, history (`lib/monitor/context.ts`). No LLM, nothing to call
- [x] 2.3 Research Agent — done 2026-10-03 (ADR-007/010): ReAct with 5 tools and an in-loop grounding check. Eval: 9/12 runs ok on the free tier in both runs (failures = Groq's 7k input-tokens/min on qwen, now diagnosed by the 1.6 fix); a "batch all tools in one turn" prompt was tried and measured WORSE (5/12: malformed parallel calls + their wasted tokens; `docs/evidence/research-turns-2026-10-03.md`) and reverted. Fallback ladder covered every failure
- [x] 2.4 Research tools — done 2026-10-02: `get_price_window`, `get_indicators`, `get_news`, `get_market`, `get_position` over a market view capped at the decision minute; lookback-only arguments; symbol enum per scenario. No-lookahead property test (every tool, 54 minutes × 6 symbols × 3 lookbacks, scenario cut and poisoned) + 2 planted leaks caught. New `lib/indicators/` (Wilder RSI, SMA, VWAP; null instead of invented values)
- [x] 2.5 Coach Agent — done 2026-10-03 (ADR-008/010/012): strict JSON on gpt-oss-20b with `reasoning_effort: low`, enforced content check, `json_validate_failed` now retried; history + bias taxonomy as input (2.6). Eval rubric 99% (with Research) / 98% (without); live in production
- [x] 2.6 Coach tools — done 2026-10-03 as INPUTS (ADR-012): earlier occurrences this session + in past scored sessions, and a bias taxonomy (6 patterns → named bias + classic reference). `lib/agents/coach/history.ts`, 4 tests + pipeline test
- [x] 2.7 Per-agent eval set — done 2026-10-03 (ADR-010): 15 fixed cases × 4 systems (pipeline / no Research / single prompt / templates), 7-check rubric, `npm run eval`. Results `docs/evidence/eval-2026-10-03.md` (+ run1): detection 15/15 vs 13/15 (single prompt); rubric 99/98/89%. Deterministic parts (cases, rubric, report, baseline, pacing) run in CI

## M3 — Persistence & Data Layer
- [x] 3.1 Supabase schema — done 2026-09-23: `supabase/migrations/20260923120000_v2_core.sql` (6 tables, ADR-003), tested in PGlite. **Applied to your Supabase project** (verified 2026-09-24: all 6 tables exist; anon gets `permission denied`). Signed-in RLS not yet checked with a real user. `types/database.ts` is now obsolete
- [x] 3.2 Decision-audit record design — done 2026-09-23: `decision_events` (facts + `state_before`, FK to the triggering action) → `pipeline_runs` (path, feedback) → `agent_runs` (full trace); state after = replay
- [x] 3.3 Migrate off localStorage — **live session sync done 2026-10-02** (ADR-005): the reducer records a journal (`lib/session/journal.ts`); `SessionSync` sends it to `session_actions` (in-order queue, retry + resync, `lib/session/sync.ts`); `/api/sessions/end` completes the session; `replay()` rebuilds state, proven on 150 random sessions against the real engine. Engine edits (deterministic order ids, exports, journaled reducer) made by Claude at your request. 161 tests + `next build`. **Verified live 2026-10-02** on zerodaymarket.vercel.app: a Google-signed-in session synced 14 actions in order (plus an RLS probe with a throwaway user: insert/read own rows OK). Scope decided 2026-10-02: the other 5 localStorage keys stay (ADR-005 addendum); behaviour metrics for 5.x come from server replay of the journal, not `zdm-trace`. Deferred: resume-after-refresh (needs a heartbeat)
- [x] 3.4 Supabase Auth — done 2026-10-02 (ADR-004): bypass → `NEXT_PUBLIC_DEMO_MODE` only; open redirect fixed (`safeNext`); `/dashboard` → `/ledger` (temporary); route guard in `proxy.ts` (Node runtime); missing `/auth/auth-code-error` → `/login`. 19 tests + `next build`. Verified on Vercel 2026-10-02 (401s for anonymous API calls, guard redirects `/sim/COV-20/live` to login; Google OAuth works); ORUS `/api` routes still unauthenticated (your code, P8)
- [x] 3.5 RLS policies — done 2026-09-23: users read own rows and append only to their own active session; audit trail + session results server-only; log and audit immutable (triggers). 16 PGlite tests + 3 mutation checks
- [x] 3.6 Agent run logging (full ReAct trace) — done 2026-09-24: `record_pipeline_run()` DB function (one transaction, server-only) + `lib/db/audit.ts` + `lib/db/admin.ts`; 8 tests incl. atomicity and permission. **New migration `20260924090000_record_pipeline_run.sql` must be applied to Supabase.** Called from the pipeline API route once it exists (2.x)
- [x] 3.7 OHLCV cache layer — done 2026-10-03 by design (ADR-009): real daily bars are fetched ONCE by `scripts/fetch-scenario-daily.mjs` into `lib/data/scenarios/<id>/daily.json` (with provenance), committed and built deterministically. No runtime fetching, so no cache misses and replay stays exact

## M4 — Scenario Pipeline
- [x] 4.1 Audit COV-20, extract reusable template — done 2026-10-03: `lib/data/scenarios/manifest.ts` (ScenarioManifest → ScenarioDataset), the shape COV-20 is wired with
- [x] 4.2 Scenario manifest format — done 2026-10-03: dates, market spec (exchange, hours, session length, currency), stocks, indices, extreme-time hints, objective, difficulty, briefing, news, circuits
- [x] 4.3 Fetch + validate OHLCV — done 2026-10-03 (ADR-009): real daily bars (Yahoo), split un-adjustment (GME $347.51, AMC 1:10 reverse), validation (OHLC consistency, range sanity — flagged KOSS +480%, real, excluded); intraday reconstructed by a seeded Brownian bridge through the real O/H/L/C (`reconstruct.ts`)
- [x] 4.4 Author event timelines — done 2026-10-03 (ADR-011): 9–10 headlines each for TAX-19, ELEC-24, GME-21; documented facts, inexact times marked "approximate", invented noise labelled "Illustrative"
- [x] 4.5 Wire scenarios end-to-end — done 2026-10-03 (ADR-011, rescoped by ADR-009): 4 of 10 playable (COV-20, TAX-19, ELEC-24, GME-21) through the now multi-market engine, Monitor, agents, scoring and UI. Other 6 shown with reasons (`OUT_OF_SCOPE`). COV-20 stays synthetic (headlines tied to synthetic levels)
- [x] 4.6 Per-scenario QA replay — done 2026-10-03: 51 tests (`lib/data/scenarios/scenarios.test.ts`): real O/H/L/C/prev close reproduced exactly per stock, bars inside the range, determinism, market co-movement, replay = live on 5 random sessions per scenario, Monitor + scorecard run

## M5 — Evaluation & Scoring
- [x] 5.1 Sharpe, max drawdown, win rate, avg hold time — done 2026-10-03: `lib/scoring/metrics.ts` (session Sharpe, not annualised; FIFO hold time), hand-checked tests
- [x] 5.2 Behavioural metrics — done 2026-10-03: events by Monitor pattern (all six, incl. averaging down), flagged per 10 orders, discipline score
- [x] 5.3 End-of-scenario scorecard — done 2026-10-03: computed by the server by replay at session end, stored in `sessions.result`; shown on `/progress`
- [~] 5.4 Cross-session progression `[thesis claim]` — tooling done 2026-10-03: OLS trend on `/progress`, study mode with a hashed control group (`NEXT_PUBLIC_STUDY_MODE`), protocol + analysis plan in `docs/STUDY.md`. **The study itself needs participants (Bhavya)**
- [x] 5.5 Baselines — done 2026-10-03: buy-and-hold, a cut-losers rule and cash, played through the same engine; on every scorecard (vs buy-and-hold in points)

## M6 — FinVQA-Chart Alignment
- [x] 6.1 No agent reads numbers off chart images — done (ADR-007): no images, grounded numbers only, capped view; measured in 2.7 (grounded 12/12 for A and B). Known gap kept in ARCHITECTURE.md (binding errors)
- [x] 6.2 Document the response to the Fusion Efficiency finding — drafted 2026-10-03: `docs/ARCHITECTURE.md` §2 (FinVQA-Chart figures marked [cite] for the authors)
- [x] 6.3 Text-first chart path — done: `lib/indicators/` (Wilder RSI, SMA, VWAP, ADX; null when short) for agents AND now the prep room (P9)
- [x] 6.4 Architectural-justification section — drafted 2026-10-03: `docs/ARCHITECTURE.md` §3–5 (with the eval evidence and limitations)

## M7 — Frontend & UX
- [x] 7.1 Coach feedback in the live room — done; production-verified 2026-10-02. **Non-streaming by design** (ADR-002: strict JSON can't stream; the sim pauses instead, ADR-008)
- [x] 7.2 Decision-audit timeline replay — done 2026-10-03: `/progress/[sessionId]`: every logged action, each flagged decision with state before, the feedback shown, path, and each agent's full trace (RLS: own sessions only)
- [x] 7.3 Scenario selection screen — done 2026-10-03: `/scenarios` (4 playable with briefing, objective, difficulty, data provenance; 6 out of scope with reasons); nav updated; live room takes the scenario from the URL
- [x] 7.4 Scorecard + progression dashboard — done 2026-10-03: `/progress`
- [x] 7.5 Latency states — done: "clock paused while the coach reviews" state, 20 s client timeout → standard feedback, honest source line incl. "limit reached"

## M8 — Infrastructure & Delivery
- [x] 8.1 Next.js 16 verification — done 2026-10-02: `next build` passes (Turbopack and webpack); `proxy.ts` confirmed (Node runtime). The random build failures were a known Turbopack bug with Google Fonts' extensionless `…&skey=…` URLs (vercel/next.js#99114); fixed by self-hosting the 11 used fonts from Fontsource packages via `next/font/local` (3 unused fonts removed). The build makes no Google requests. **Check visually** that pages look unchanged
- [x] 8.2 Secrets handling — done: Groq + service-role keys server-only (service key rotated after a leak); no Polygon key needed (ADR-009: Yahoo data fetched offline)
- [x] 8.3 CI: run the agent eval suite — done 2026-10-03: CI runs all deterministic tests (incl. eval cases, rubric, scoring, scenario QA) on Node 22. The live eval (`npm run eval`) stays manual by design: it costs quota and LLM output varies
- [x] 8.4 Rate limiting / cost guardrails — done 2026-10-03 (ADR-012): `consume_quota()` per user (pipeline 40/h, ORUS 60/h), atomic, fails open; plus coalescing, server re-check before spending, `retry-after`. **Apply migration `20261003090000_api_quota.sql`**
- [x] 8.5 Vercel config for new routes — done: `maxDuration = 30`; deploy path fixed (fork → CI → Vercel)

---

## Proposed additions — NOT yet accepted (need your decision)

The audit surfaced these. I haven't folded them into the modules; accept, merge or reject each.

- P1 **Server-authoritative session state** — **ACCEPTED 2026-09-23 as (b) phased** (ADR-003): action log stored from day one; agents switch from client snapshot to server replay once P2 lands.
- P2 **Engine fixes (your code)**: stop-loss execution, news firing, cash reservation, pure reducer, scenario parameterisation (AUDIT §1.4). Gates 2.1, 4.5, 4.6, 5.1.
- P3 **V1-vs-V2 ablation**: same fixed cases through single-shot and multi-agent, scored. Probably part of 2.7 / 5.5.
- P4 **Dead-code decision**: portfolio mode, orphan routes, `ai/` prototypes (AUDIT §7). Also: `portfolio_run_<slug>` storage, and prep telemetry (`zdm_prep_telemetry_*`, written but never read).
- P5 **Auth fixes** — **DONE as 3.4** (2026-10-02).
- P6 **Progression study design** for 5.4: participants, sessions, measure, comparison.
- P7 ✅ **Done 2026-10-03 (Claude, at Bhavya's request):** V1 routes now use `openai/gpt-oss-20b` (debrief: `gpt-oss-120b`) via `lib/ai/v1-model.ts`, with `reasoning_effort: low`, hidden reasoning and +256 token headroom. Probed live: without these settings gpt-oss returns an empty reply on small budgets. Was: 6 routes on `llama-3.1-8b-instant` and debrief on `llama-3.3-70b-versatile`, neither on the key
- P9 **V1 prep-room indicators fabricate values (your UI):** `components/prep/tabs/tab-technicals.tsx` returns RSI = 50 when data is short, and `computeADX` returns `20 + Math.random() * 10` as a fallback, so a user can see a random ADX. Also its RSI uses simple averages, not Wilder's smoothing. `lib/indicators/` has tested replacements. **Scheduled into M4 (2026-10-03):** the prep-room candles are synthetic too (30 generated days, so MA50 can't even be computed); the tab moves to `lib/indicators/` when M4 brings real daily bars
- P8 ✅ **Done 2026-10-03 (Claude, at Bhavya's request):** all 7 V1 routes call `requireUser()` (`lib/auth/require-user.ts`) and return 401 to anonymous callers. The help-chat widget now says "Sign in to chat with ORUS" instead of an HTTP error. Consequence: signed-out visitors on the splash page can't use help chat
