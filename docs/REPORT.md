# Zero Day V2: Progress Report, Side by Side

**What this is:** one row per task in the V2 proposal. Each row compares the proposal's promise, what V1 had, what V2 has now, and the evidence for it.
**Updated whenever a task moves.** Detail: `ROADMAP.md` (status), `DECISIONS.md` (ADR-001…012), `LEARNINGS.md` (how each part works), `AUDIT.md` (the V1 baseline), `ARCHITECTURE.md` (thesis text), `STUDY.md` (5.4 protocol).

_Last updated: 2026-10-03: 46 of 47 tasks done; 5.4 needs study participants._

**Status key:**
- ✅ done
- 🟡 partial
- ⬜ not started
- ❌ dropped or rescoped (with an ADR)

## Headline

| | V1 (baseline, audit 2026-09-23) | V2 now |
|---|---|---|
| AI during trading | None. The in-sim "ORUS" was scripted text | Monitor → Research → Coach on every flagged decision, live in production |
| LLM calls | 7 single-shot routes, 3 reachable; models missing from the key, so **down** | V2 agents on gpt-oss-20b / qwen3.8-27b. V1 routes repaired (P7), sign-in protected (P8) and rate-limited (8.4) |
| Multi-step reasoning / tools | None | ReAct Research agent, 5 tools that can't see the future |
| Hallucination control | None | Grounding checks (every number from a tool or a fact), strict schemas + repair |
| Evidence that it works | None | Eval: 15 cases × 4 systems. Detection 15/15 (pipeline) vs 13/15 (one prompt); rubric 99% / 98% / 89% |
| Persistence | `localStorage` only | Supabase: action log (event sourcing), decision-audit trail, RLS, scorecards |
| Server trust | The client could claim anything | The server replays the log and re-runs Monitor before spending tokens |
| Auth / abuse | Bypassable; open AI routes | Route guard, Google OAuth, per-user quotas in the database |
| Scenarios | 1 (COV-20, synthetic prices) | 4 playable: COV-20 + 3 on **real daily data** (NSE ×2, NYSE ×1) |
| Scoring | Debrief narrative only | Sharpe, drawdown, win rate, hold time, behaviour, baselines, progression, study mode |
| Tests | 0 | 390 deterministic tests in CI + live-model eval |

## M1: Agent runtime and orchestration (7/7 ✅)

| # | Proposal | V1 | V2 now | Evidence |
|---|---|---|---|---|
| 1.1 | Execution model | n/a | ✅ Hybrid: rules / ReAct / single-shot | ADR-001 |
| 1.2 | Agent interface | Key-rotation helper | ✅ `AgentSpec` | `lib/agents/types.ts` |
| 1.3 | ReAct loop | None | ✅ Step cap, forced submit. A "one-turn" prompt variant measured worse (5/12) and was reverted | `react-loop.ts`; `research-turns-2026-10-03.md` |
| 1.4 | Orchestrator | None | ✅ Fixed order + fallback ladder | ADR-002; caught every Research failure in the eval |
| 1.5 | Structured output | None | ✅ Strict JSON + Zod + repair; `json_validate_failed` retried | `single-shot.ts` |
| 1.6 | Retries / timeouts | Copy-pasted key rotation | ✅ Backoff; honours `retry-after`; keeps the 429 reason | `retry.ts`, `model.ts` |
| 1.7 | Budgets | None | ✅ Per agent. Eval measured 7.2k tokens / 2.7 s (A) | `budgets.ts`; ADR-010 |

## M2: The three agents (7/7 ✅)

| # | Proposal | V1 | V2 now | Evidence |
|---|---|---|---|---|
| 2.1 | Monitor | Tracer counted events afterwards | ✅ 6 rules, one event per action, same code on both sides | 28 tests, mutation-checked; production event 2026-10-02 |
| 2.2 | Monitor tools | Client selectors | ✅ By design: a deterministic rule context | ADR-001/012 |
| 2.3 | Research | `/api/tutor` (single prompt) | ✅ ReAct + grounding; ~75% ok on the free tier, fallback covers the rest | ADR-007/010 |
| 2.4 | Research tools | None | ✅ 5 tools, no-lookahead property test | `tools.test.ts` |
| 2.5 | Coach | `/api/debrief` (post-session only) | ✅ Live; rubric 98–99% | ADR-008/010 |
| 2.6 | Coach tools | 10-rule mistake list | ✅ History + bias taxonomy, as inputs | ADR-012 |
| 2.7 | Eval set | None | ✅ 15 cases × 4 systems, 7 checks, 2 recorded runs | ADR-010; `docs/evidence/eval-*` |

## M3: Persistence and data (7/7 ✅)

| # | Proposal | V1 | V2 now | Evidence |
|---|---|---|---|---|
| 3.1 | Schema | Users only | ✅ 6 tables + quota table | 3 migrations |
| 3.2 | Audit record | None | ✅ Event → run → agent traces | ADR-003 |
| 3.3 | Off localStorage | All local | ✅ Live sync; replay proven | Production session 2026-10-02 |
| 3.4 | Auth | Bypassable | ✅ Guard, demo flag, Google | ADR-004 |
| 3.5 | RLS | None | ✅ Own rows; immutable log | PGlite tests + a real-user probe |
| 3.6 | Run logging | None | ✅ One-transaction RPC | Production `agent_runs` rows |
| 3.7 | OHLCV cache | None | ✅ Fetched once, committed with provenance | ADR-009 |

## M4: Scenarios (6/6 ✅, rescoped to 4 of 10 by ADR-009/011)

| # | Proposal | V1 | V2 now | Evidence |
|---|---|---|---|---|
| 4.1 | Template | Hardcoded | ✅ `ScenarioManifest` | `manifest.ts` |
| 4.2 | Manifest | Unused metadata | ✅ Market spec, stocks, indices, hints, news | |
| 4.3 | Real OHLCV | Synthetic generator | ✅ Real daily bars (split-unadjusted, validated) + reconstructed intraday | `fetch-scenario-daily.mjs`, `reconstruct.ts` |
| 4.4 | Event timelines | COV-20 | ✅ 3 new: facts, approximate times marked, illustrative noise labelled | Manifests |
| 4.5 | Wire scenarios | 1 of 10 | ✅ 4 of 10, multi-market engine (NSE + NYSE); 6 listed with reasons | ADR-011 |
| 4.6 | QA replay | None | ✅ 51 tests | `scenarios.test.ts` |

## M5: Evaluation and scoring (4 ✅ · 1 🟡)

| # | Proposal | V1 | V2 now | Evidence |
|---|---|---|---|---|
| 5.1 | Sharpe, drawdown, win rate, hold | None | ✅ | `metrics.ts` (hand-checked tests) |
| 5.2 | Behavioural metrics | Partial counts | ✅ All 6 patterns, per-10 rate, discipline | `scorecard.ts` |
| 5.3 | Scorecard | Narrative | ✅ Server-computed at session end | `sessions.result`; `/progress` |
| 5.4 | Progression (**thesis claim**) | None | 🟡 Tooling + control group + protocol; **study not run** | `STUDY.md` |
| 5.5 | Baselines | None | ✅ Buy-and-hold, rule, cash through the same engine | Scorecard |

## M6: FinVQA-Chart alignment (4/4 ✅)

| # | Proposal | V1 | V2 now | Evidence |
|---|---|---|---|---|
| 6.1 | No chart reading | Accidental | ✅ Enforced + measured (grounded 12/12) | ADR-007/010 |
| 6.2 | Fusion-Efficiency response | None | ✅ Drafted ([cite] marks for the study's figures) | `ARCHITECTURE.md` §2 |
| 6.3 | Text-first indicators | Invented fallbacks | ✅ For agents and the prep room (P9) | `lib/indicators` |
| 6.4 | Justification | None | ✅ Drafted with eval evidence | `ARCHITECTURE.md` §3–5 |

## M7: Frontend (5/5 ✅)

| # | Proposal | V1 | V2 now |
|---|---|---|---|
| 7.1 | Coach UI | Scripted | ✅ Live panel; non-streaming by design (ADR-002) |
| 7.2 | Audit replay | None | ✅ `/progress/[id]` |
| 7.3 | Scenario selection | Hardcoded links | ✅ `/scenarios` |
| 7.4 | Dashboard | Debrief only | ✅ `/progress` |
| 7.5 | Latency states | None | ✅ Paused state, timeout, honest source line |

## M8: Delivery (5/5 ✅)

| # | Proposal | V1 | V2 now |
|---|---|---|---|
| 8.1 | Next.js 16 | Random build failures | ✅ Fonts self-hosted; builds clean |
| 8.2 | Secrets | Groq server-side | ✅ Server-only; service key rotated |
| 8.3 | CI | Lint + build | ✅ + all deterministic tests (Node 22); live eval manual by design |
| 8.4 | Rate limits | None | ✅ `consume_quota()` (migration to apply) |
| 8.5 | Vercel | Stale deploys | ✅ Fork → CI → Vercel |

## What you must still do

1. Apply migration `supabase/migrations/20261003090000_api_quota.sql` in Supabase.
2. Run the 5.4 study (`docs/STUDY.md`). Consider a consent screen first.
3. Fill in the [cite] marks in `ARCHITECTURE.md` from the FinVQA-Chart study.
4. Review the code written in your areas: FSM/engine, UI, ORUS routes, rules. Every file marks its authorship.

## Known limitations (to state in the thesis)

- **Prices:**
  - COV-20 is synthetic.
  - The other scenarios have real daily bars and reconstructed intraday paths.
- **What the eval does and doesn't show:**
  - It shows reliable detection; feedback quality is similar to one prompt on these checks.
  - Research's value is unmeasured by the rubric.
- **Free tier:** Research succeeds about 75% of the time (7k input tokens/min).
- **Fixed sequence:** the orchestration is a fixed sequence by design.
- **Labels are operational definitions.**
- **The thesis claim needs the study;** as designed it is a pilot.
