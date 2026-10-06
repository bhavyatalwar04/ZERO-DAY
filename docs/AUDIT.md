# Zero Day V1 — Codebase Audit

**Date:** 2026-09-23 · **Commit audited:** `021ee8c` (plus uncommitted edits to `login/page.tsx` and `signup/page.tsx`)
**Purpose:** establish what exists before any V2 work, so nothing is rebuilt and nothing is assumed.

Everything below was checked in the code; where something is inference or needs outside verification, it says so.
Paths are relative to `frontend/` unless stated.

---

## TL;DR — the five things that matter most for V2

1. **The trading engine runs entirely in the browser.** V2 agents will run on the server. Today there is no server-side copy of session state, so an agent has nothing trustworthy to call tools against. This is the biggest architectural gap, and it shapes 1.1, 2.2 and 3.3.
2. **COV-20 price data is synthetic.** `lib/data/scenarios/cov-20/timeline.ts` generates all six stocks from *one shared curve* (`PATH_SHAPE`), per-stock % targets and PRNG noise. V2's core claim is "all numbers come from structured OHLCV via tools". If that OHLCV is invented, the Research Agent is grounded in fiction. M4.3 has to cover COV-20 too, not just the other nine.
3. **Of the 7 Groq routes, only 3 are reachable from any page.** The live simulation makes **zero** LLM calls: the in-session "ORUS" is static scripted text. The "five ORUS calls" in `PROJECT_CONTEXT.txt` don't match what actually runs.
4. **Two engine features are silently broken:** stop-losses are stored but never executed, and news events are never recorded as fired. Both feed the behavioural mistake detector, so V1's debrief is partly built on bad signals (§1.4).
5. **Nothing persists across sessions except XP/badges and bandit weights.** The behaviour trace is overwritten every session. The thesis claim (5.4, cross-session progression) currently has no data source.

---

## 1. Live Trading Engine (FSM) — *owned by you*

**Location:** `lib/contexts/live-session-context.tsx` (reducer + provider, ~390 lines), types in `types/live.ts`.

### 1.1 How it's built
The engine is a React `useReducer`, and a reducer *is* a finite-state machine: a pure function `(state, action) → nextState`.
The `LiveSessionProvider` runs a `setInterval` that dispatches `TICK`. One tick is one simulated minute; at speed 1×/5×/10× a tick is 1500/300/150 ms.

### 1.2 States (`SessionStatus`)

| State | Meaning | Time advances? | Orders match? |
|---|---|---|---|
| `PRE_OPEN` | before start | no | no |
| `LIVE` | trading | yes | yes |
| `PAUSED` | user paused | no | orders *placeable*; MARKET fills instantly |
| `HALTED` | circuit breaker | yes | no |
| `CLOSED` | bell at minute 375 | no | no |

### 1.3 Transitions (actions)

```
PRE_OPEN --START--> LIVE                 (auto-dispatched on mount, so PRE_OPEN lasts one render)
LIVE     --PAUSE--> PAUSED --RESUME--> LIVE
LIVE     --TICK @ circuit.fireAt--> HALTED --TICK @ endsAtMin--> LIVE
HALTED   --SKIP_HALT--> LIVE             (jumps clock to halt end)
any      --END--> CLOSED
LIVE/HALTED --TICK @ minute 375--> CLOSED (auto square-off of all positions)
```
Non-transition actions: `SET_SPEED`, `SET_ACTIVE`, `PLACE_ORDER`, `CANCEL_ORDER`, `SET_STOP`, `MARK_COACH_SHOWN`.

**What events does it emit? None.** The reducer emits nothing. `lib/behavior/trace-bridge.tsx` watches state with `useEffect` and **infers** events by diffing (new order ids → `order_placed`, status change → `pause`, and so on). It produces trace events `session_start/end`, `pause/resume`, `circuit_started/ended`, `speed_change`, `symbol_focus`, `order_placed/filled/rejected/cancelled`, `sl_set/cleared/triggered` and `news_dropped`. The full vocabulary (41 kinds, including tutorial/game events) is in `lib/behavior/types.ts`.

> **V2 relevance:** the stream of *actions* going into the reducer is already the ideal decision-audit log. If you record every action plus the initial state, you can replay any session exactly. This is event sourcing, and it matters for 3.2 and 7.2. It only works if the reducer is pure (see bug 5 below).

### 1.4 Findings in the engine (proposals for you to fix — I have not changed anything)

| # | Finding | Evidence | Why it matters for V2 |
|---|---|---|---|
| 1 | **Stop-losses never execute.** `SET_STOP` stores `position.stopPrice`; neither `TICK` nor `matchOrders` ever reads it. The "Set SL −3%" button in `right-rail.tsx:230` does nothing to execution. | `grep stopPrice` → only UI + tracer read it | The `NO_STOP_LOSS` rule counts `sl_set`, so users get credit for protection that doesn't exist. A Coach agent would praise a stop that never fired. |
| 2 | **`firedNewsIds` is never written.** Initialised to `[]`, never appended. | no writer anywhere | `news_dropped` never fires, so `NEWS_REFLEX` / `IGNORED_NEWS` detection runs on missing data (verify how each rule uses it). |
| 3 | Cash is checked only at placement. Several pending LIMIT/SL buys can each pass the check and then all fill. | `PLACE_ORDER` vs `matchOrders` | `cash` can go negative, which corrupts any P&L / Sharpe computed later. |
| 4 | A SELL fill with no remaining position is still marked `FILLED`. | `matchOrders`, SELL branch, `if (cur)` | Audit log would record trades that didn't happen. |
| 5 | **Reducer is impure:** `PLACE_ORDER` uses `Date.now()` and `Math.random()` for order ids. | line ~140 | Breaks deterministic replay (3.2/7.2). Fix: generate the id in the action creator, not the reducer. |
| 6 | **Hardcoded to COV-20:** imports `COV20_*` directly; `SYMBOLS`, `STARTING_CASH`, `SESSION_MINUTES = 375`, NSE hours are constants; `state.scenarioId` is set but never used. | top of file | The #1 blocker for M4.5. US sessions are 390 min; crypto has no session. |
| 7 | Circuit levels are typed `5 \| 10 \| 20`. As far as I know, NSE's market-wide circuit breakers are 10/15/20%, and I don't believe NIFTY halted on 9 March 2020 (the 2020 halts I'm aware of were 13 and 23 March). **Verify against NSE records.** | `types/live.ts`, `live-events.ts` n7 | An examiner with market knowledge could catch this. |
| 8 | `Order.reason` holds both the user's thesis and the rejection reason. | `types/live.ts` | Ambiguous audit data. |
| 9 | `Position.qty` is documented "negative = short", but shorting is rejected. `validity: 'IOC'` is accepted but never enforced. | types vs reducer | Comments describe behaviour that doesn't exist. |
| 10 | Price is the *close of the 5-minute bar*, so it's constant for 5 ticks. `START` has no guard. `PAUSE` is ignored during `HALTED`. | `getPriceAtMinute` | Minor; worth knowing when writing tools. |

---

## 2. Scenario data pipeline — *owned by you*

### 2.1 How COV-20 is wired
There is **no scenario registry**. COV-20 is wired through direct imports in at least five places:

| Consumer | Imports |
|---|---|
| `app/sim/[id]/prep/page.tsx` | `COV20_SCENARIO`, `COV20_COMPANIES`, with `SCENARIOS['COV-20']` hardcoded; the `[id]` param is read into `_id` and ignored |
| `lib/contexts/live-session-context.tsx` | `COV20_TIMELINE`, `COV20_INDICES`, `COV20_NEWS_EVENTS`, `COV20_CIRCUITS`, `COV20_WHISPERS` |
| `app/sim/[id]/live/page.tsx` | `[id]` ignored; redirects to hardcoded `/sim/COV-20/debrief` |
| `lib/behavior/trace-bridge.tsx` | `COV20_NEWS_EVENTS` |
| `app/api/tutor/route.ts` | "Covid Day Zero, March 9, 2020" hardcoded in prompt |

### 2.2 What COV-20 contains (`lib/data/scenarios/cov-20/`)
- `timeline.ts`: 6 NSE stocks × 75 five-minute bars, plus indices. **Generated, not historical** (see TL;DR #2). `prevClose` values and per-stock open/low/close % are hand-set targets.
- `live-events.ts`: 20 news events (signal/noise labelled, some with per-stock impact), 1 circuit breaker, 11 static ORUS whispers.
- `stocks.ts`, `companies.ts`, `macro.ts`: prep-room fundamentals and narrative (hand-authored).

### 2.3 The other 9 scenarios
- `lib/data/scenarios.ts` defines metadata for 10 scenarios (`lehman-2008`, `covid-crash-2020`, `gamestop-2021`, …). **It is imported by nothing.** Its ids don't match the engine's (`covid-crash-2020` vs `COV-20`), and a third id scheme exists in portfolio mode (`covid-crash`).
- `lib/data/lehman-ohlcv.ts` is used only by orphaned components (§7).
- So "1 of 10 wired" is generous: the other 9 exist only as display metadata in an unused file.

### 2.4 Data-source warnings for M4.3 (verify before committing)
- **Polygon.io is a US-market provider.** I don't believe it covers NSE equities. COV-20 (NSE) and `india-demonetization-2016` would need another source (NSE bhavcopy for daily bars; intraday NSE history is hard to get for free).
- Minute-level history for 2008 / 2010 / 2016 likely needs a paid Polygon tier; check the plan's history depth.
- The scenarios span NSE, NYSE/NASDAQ, crypto (24h) and Brexit (FX/UK), so the **manifest (4.2) must carry the session calendar, currency and circuit rules**; they can't stay engine constants.

---

## 3. ORUS — all Groq call sites

`PROJECT_CONTEXT.txt` describes five ORUS calls. The code has **seven routes**, and **only three are reachable from a mounted page.**

| Route | Called from | Reachable? | Input | Output / state written | Mode |
|---|---|---|---|---|---|
| `/api/chat` | `help-chat/chat-widget.tsx` (mounted in root `layout.tsx`, so every page) | ✅ | last 12 client messages + image slugs | `{reply}`; history saved to localStorage `zdm-help-chat` | non-stream, 700 tok |
| `/api/tutor` | `prep/tutor-drawer.tsx` (prep room) | ✅ | `stock`, `artifact`, `scenarioId`, arbitrary client `contextData` | short text; nothing persisted | non-stream, 180 tok |
| `/api/debrief` | `app/sim/[id]/debrief/page.tsx` | ✅ | archetype, profile, mistakes, ≤30 key events, all computed **client-side** from `zdm-trace` | narrative JSON; not persisted; client has a deterministic fallback | `json_object`, `JSON.parse` + regex fallback |
| `/api/copilot` | `gameplay/trading-team-drawer.tsx`, `portfolio/coach-whisper.tsx` | ❌ neither is mounted | client `messages` passed through **including system roles** | text / stream | 2 modes |
| `/api/portfolio-feedback` | `portfolio/results/pro-tip.tsx` | ❌ portfolio mode not routed | run result | JSON | non-stream |
| `/api/feedback` | nothing | ❌ | scenario, guess, confidence (older prediction-game design) | streamed JSON | stream |
| `/api/sentiment` | nothing | ❌ | headline | score | only user of `lib/ai/groq-client.ts` |

Common properties of all seven:
- All use `llama-3.1-8b-instant`, single-shot, with no tools and no multi-step reasoning. This confirms your V1 characterisation.
- The 4-key rotation loop is copy-pasted into 6 routes; `lib/ai/groq-client.ts` exists but only the dead `sentiment` route uses it.
- No timeouts (`AbortController` appears nowhere), no schema validation (no Zod in `package.json`), no auth check, no rate limit.
- Several return errors with HTTP 200 and raw upstream error text.
- The server trusts whatever the client computes (profile, mistakes, contextData).

**In the live sim, ORUS is not an LLM.** Whispers come from `COV20_WHISPERS` via `whisperForMinute()`, and the coach prompts in `live/live-coach-prompts.tsx` are scripted. No component under `components/live/` calls `fetch`. For V2 this is good news: there is no live-sim LLM code to untangle, and the Monitor→Research→Coach pipeline slots into an empty place.

> **Framing risk for the report:** "V1 = five independent Groq calls" is the baseline you'll compare V2 against. Describe V1 as it actually runs: three reachable single-shot calls, none during trading. Otherwise an examiner who opens the repo will find the mismatch.

---

## 4. localStorage inventory

| Key | Written by | Contents | Lifetime |
|---|---|---|---|
| `zdm_user_v2` | `lib/utils/localStorage.ts` | profile, XP, level, streak, completed scenarios, badges, knowledge level | permanent; also mirrored to Supabase `user_metadata.stats` |
| `zdm-trace` | `lib/behavior/tracer.tsx` | behaviour trace of **the current** live session | **overwritten each session**: a new provider mount persists an empty event list |
| `zdm-rl-bandit` | `lib/rl/bandit.ts` | bandit arm statistics for Academy recommendations | permanent, and the **only cross-session learning state** |
| `zdm-help-chat` | `help-chat/chat-widget.tsx` | help-chat history | permanent |
| `zdm_prep_telemetry_<scenarioId>` | `lib/utils/telemetry.ts` | prep-room behaviour telemetry | per scenario |
| `portfolio_run_<slug>` | `lib/utils/localStorage.ts` | portfolio-mode results | orphaned feature |

**Not persisted anywhere:** `LiveSessionState` itself. Refreshing `/sim/COV-20/live` loses all positions and orders; only the trace survives.

---

## 5. Supabase usage

- **Auth only.** Email/password (`signInWithPassword`, `signUp`), Google OAuth, `auth/callback`, `onAuthStateChange` in `user-context.tsx`.
- **No tables, no migrations, no RLS, no `.from()` queries anywhere.**
- `saveUser()` syncs stats into `auth.users.user_metadata`. The user can edit their own `user_metadata` with the anon key, so **these stats can't be trusted as scores**, which matters if progression (5.4) is a thesis claim.
- `types/database.ts` describes an older schema (`Prediction`, `GamePhase: 'prediction' | 'reveal'`). No query uses it.
- Known auth defects (from the earlier review):
  - Open redirect in `auth/callback` via `next`.
  - Default redirect to `/dashboard`, which doesn't exist.
  - No route protection since the middleware was deleted. *Worth checking:* Next 16 replaced `middleware.ts` with `proxy.ts` on the Node runtime, which may be the real fix for the Vercel Edge 500s. Verify in the Next 16 docs.
  - **Uncommitted** login/signup changes create a local account on any network error or `TypeError`, with no password check.
- The Supabase client falls back to a no-op stub when env vars are missing, which is good for CI and demos.

---

## 6. AI-assisted vs hand-written — what the code can and can't tell us

**Short answer: it can't be determined reliably from the repo, and I'd advise against making claims from it.** Here is the evidence:

- **Git can't answer it.** The whole app arrived in one `Initial commit` (2026-05-05) plus one large "full session" commit the next day. There are 12 commits across 3 authors, so no incremental history exists to attribute code.
- **Two distinct code styles exist.** Group A uses semicolons and 4-space indentation: `api/copilot`, `api/feedback`, `api/sentiment`, `lib/ai/groq-client.ts`, `lib/utils/localStorage.ts`. Group B has no semicolons and uses 2-space indentation: the engine, behaviour tracer, `api/chat`, `api/tutor`, `api/debrief`, data files. Group A is also the older, mostly orphaned code, so these are probably two generations of the codebase, whoever or whatever wrote them.
- **Uniform decorative banners** (`// ─── Section ───`) and long explanatory headers run through the engine, data, behaviour, prep and gameplay code. That fits one consistent author or generator, but it's weak evidence either way.
- **Comments sometimes describe behaviour the code doesn't implement:** short positions, IOC, circuit levels, a "realistic" price path. That pattern shows up in generated code and in rushed human code alike.

**What actually matters for the viva:** an examiner won't ask who typed a file. They'll ask you to explain it. The 10 engine findings in §1.4 make a good self-test: if you can explain why each one happens, you own the engine. I'd suggest you mark ownership yourself in this doc (a line per area) rather than rely on inference.

---

## 7. Reuse / refactor / missing

### Reusable as-is (or near)
- **Behaviour tracer + `TraceEvent` schema** (`lib/behavior/`): natural Monitor Agent input.
- **Mistake taxonomy** (`mistakes.ts`, 10 rules), `profile.ts`, `archetype.ts`: the basis of Coach tools (2.6) and behavioural metrics (5.2). They lack "averaging down".
- **Indicator math** (`sma`, `ema`, `computeRSI`, `computeATR`, MACD, Bollinger, VWAP) in `components/prep/tabs/tab-technicals.tsx`: the core of the text-first chart path (6.3). They need extracting out of the component into `lib/` and unit-testing.
- `equityCurve` (captured every minute): the input for Sharpe / max drawdown (5.1).
- Supabase client/server wrappers with stub fallback.
- Debrief page's loading → streaming → fallback states (7.5 pattern).
- `lib/rl/` bandit: optional, but already cross-session.

### Needs refactoring for V2
- Engine (yours): scenario-parameterised, pure reducer, stop-loss execution, news firing, cash reservation (§1.4).
- Scenario loading (yours): one registry keyed by `[id]` instead of direct `COV20_*` imports (§2.1).
- Groq access: one shared client with timeouts, schemas and budgets, replacing 6 copies.
- Auth flow (§5).
- Where state lives: at minimum, a server-side snapshot of the session for agents (see the gap below).

### Dead code needing a keep/delete decision
Portfolio mode (22 components + `use-portfolio-game.ts` + data + 2 routes), `components/gameplay/*` (5 of 6 unmounted), `/api/feedback`, `/api/sentiment`, `/api/copilot`, `lib/data/scenarios.ts` (revive for 7.3?), `lib/data/lehman-ohlcv.ts`, `types/database.ts`, and the `ai/` Python prototypes.
*Note:* `ai/vlm_finetuned_implementation.py` is a VLM prototype, which sits awkwardly next to an architecture whose thesis is "no VLM reads charts". Decide how the report frames it.

### Genuinely missing
- **Server-authoritative session state.** Today the client could send any portfolio to an agent.
- Database schema, RLS, any persisted game data.
- Agent runtime of any kind (loop, tool registry, schemas, budgets).
- Real historical OHLCV, for COV-20 as well.
- Any cross-session history of behaviour.
- Financial metrics (Sharpe, drawdown, win rate, hold time).
- Eval sets and tests (zero test files in the repo).
- Rate limiting / cost guardrails.

---

## 8. Roadmap mapping

`DONE` = already done · `PARTIAL` = reusable pieces exist (what's missing noted) · `NOT STARTED`

| Task | Status | Notes |
|---|---|---|
| 1.1 Execution-model decision | NOT STARTED | next, after audit review |
| 1.2 Agent base interface | NOT STARTED | `groq-client.ts` is a key-rotation helper, not an agent abstraction |
| 1.3 ReAct loop | NOT STARTED | |
| 1.4 Orchestrator | NOT STARTED | |
| 1.5 Structured output | NOT STARTED | `json_object` mode + `JSON.parse` in `debrief`; no schema validation anywhere |
| 1.6 Retries/timeouts/fallback | PARTIAL | 429 key rotation in every route; debrief client fallback. Missing: timeouts, backoff, per-agent fallback |
| 1.7 Token/latency budget | NOT STARTED | only `max_tokens` |
| 2.1 Monitor: detect decision events | PARTIAL | TraceBridge already derives order/SL/halt events. Missing: news firing (bug #2), "decision event" definition, server side |
| 2.2 Monitor tools | PARTIAL | selectors (`ltp`, `totalEquity`, positions) exist **client-side only** |
| 2.3 Research Agent | NOT STARTED | `/api/tutor` is the closest single-shot ancestor |
| 2.4 Research tools | PARTIAL | indicator functions + news timeline exist; locked in a component / static TS; data synthetic |
| 2.5 Coach Agent | PARTIAL | `/api/debrief` is a post-session single-shot coach |
| 2.6 Coach tools | PARTIAL | bias taxonomy exists (10 rules); no decision history beyond one session |
| 2.7 Per-agent eval set | NOT STARTED | zero tests in repo |
| 3.1 Supabase schema | NOT STARTED | `types/database.ts` is unrelated and unused |
| 3.2 Audit record design | PARTIAL | `TraceEvent {t, simMinute, kind, data}` is a start. Missing: state before/after, reasoning, feedback |
| 3.3 Off localStorage | NOT STARTED | 6 keys (§4); live state not persisted at all |
| 3.4 Supabase Auth | PARTIAL | email + Google work. Broken: redirect target, open redirect, no route guard, uncommitted bypass |
| 3.5 RLS | NOT STARTED | no tables |
| 3.6 Agent run logging | NOT STARTED | |
| 3.7 OHLCV cache | NOT STARTED | |
| 4.1 Audit COV-20, extract template | PARTIAL | findings in §1–2 of this doc; template not extracted |
| 4.2 Manifest format | PARTIAL | `Scenario` type + unused 10-scenario metadata; must add session calendar/currency/circuits |
| 4.3 Fetch/validate OHLCV (9) | NOT STARTED | **scope: also COV-20**; Polygon lacks NSE (verify) |
| 4.4 Event timelines | PARTIAL | COV-20 only |
| 4.5 Wire 9 end-to-end | NOT STARTED | blocked by engine hardcoding (§1.4 #6) |
| 4.6 QA replay | NOT STARTED | needs pure reducer (§1.4 #5) |
| 5.1 Sharpe/MDD/win rate/hold | NOT STARTED | input data (`equityCurve`, orders) exists |
| 5.2 Behavioural metrics | PARTIAL | panic-sell, overtrading, revenge, disposition exist; no averaging-down; two rules fed bad data |
| 5.3 Scorecard | PARTIAL | debrief page (archetype + mistakes + narrative); no financial metrics |
| 5.4 Cross-session progression | NOT STARTED | **no cross-session behaviour data exists** |
| 5.5 Baselines | NOT STARTED | |
| 6.1 No agent reads chart images | NOT STARTED | trivially true today (no vision calls) but nothing enforces it |
| 6.2 Document the response | NOT STARTED | |
| 6.3 Text-first chart path | PARTIAL | indicators computed in `tab-technicals.tsx` |
| 6.4 Justification section | NOT STARTED | |
| 7.1 Streaming coach UI | PARTIAL | streaming only in dead routes; live coach is scripted |
| 7.2 Audit timeline replay | NOT STARTED | |
| 7.3 Scenario selection | PARTIAL | Ledger browses 67 cases, but sim links are hardcoded to COV-20 |
| 7.4 Scorecard + progression dashboard | PARTIAL | debrief only; `/dashboard` linked but missing |
| 7.5 Latency states | PARTIAL | debrief loading/fallback states |
| 8.1 Next 16 verification | PARTIAL | on 16.1.6, `tsc --noEmit` passes; `next build`/lint not run in this audit; middleware→proxy question open |
| 8.2 Secrets | PARTIAL | Groq keys server-only (good); no Polygon key yet |
| 8.3 CI eval suite | PARTIAL | CI builds + lints; no evals |
| 8.4 Rate limiting / cost | NOT STARTED | key rotation multiplies quota; check it's within Groq's terms |
| 8.5 Vercel config | PARTIAL | `maxDuration = 30` on routes. A multi-step agent chain may exceed it |

**Nothing on the roadmap is fully DONE.**

---

## 9. Scope gaps and examiner questions you can't yet answer

1. **"Your agents run on the server and your engine runs in the browser. Where do the tool results come from, and what stops the client lying?"** This needs an answer in 1.1/3.3.
2. **"Is the price data real?"** Not today (§2.2).
3. **"Why is a three-agent pipeline better than one good prompt?"** The roadmap has no V1-vs-V2 comparison. Without an ablation on fixed cases (single-shot vs multi-agent, same inputs, scored outputs), "multi-agent" is an architecture choice, not a result. I suggest adding it to 2.7 / 5.5.
4. **"How do you show cross-session progression?"** Beyond code, 5.4 needs a study design: how many users, how many sessions each, what counts as improvement, and a comparison group. Without participants it's a feature, not a finding.
5. **Latency vs sim speed.** At 10× a simulated minute is 150 ms. Three sequential agents with multi-step loops on Groq will take seconds, so feedback lands dozens of simulated minutes late. That suggests a cheap deterministic Monitor, an async pipeline, and possibly pausing the sim on decision events. This is an input to 1.1.
6. **8B model and tool calling.** `llama-3.1-8b-instant` is small for reliable multi-step tool use. Also an input to 1.1.
7. **FinVQA-Chart.** I couldn't verify this benchmark or its "Fusion Efficiency" finding from the repo. Make sure the citation is exact. Also, if V2 never uses a VLM, then "we avoid the failure" is a design constraint, not a measured contribution. A small experiment (VLM reading your own charts vs tool-computed values) would turn it into evidence.
8. **Historical accuracy of COV-20 events** (circuit breaker; §1.4 #7).

---

## Addendum — 2026-09-23, after the first live run

- **`llama-3.1-8b-instant` is not available on the project's Groq key** (`404 model_not_found`). Listing the key's models returns 11, with no Llama chat models; the chat-capable ones are `openai/gpt-oss-20b`, `openai/gpt-oss-120b` and `qwen/qwen3.8-27b`. All seven V1 routes (§3) hardcode a Llama model (six use `llama-3.1-8b-instant`, `/api/debrief` uses `llama-3.3-70b-versatile`; neither is on the key), so V1's reachable AI features (chat, tutor, debrief) likely fail today. Roadmap P7.
- Evidence: `docs/evidence/2026-09-23-live-smoke-run.txt`.

---

## Addendum (2026-10-02): prep-room indicator maths

Found while building the Research tools (2.4). In `components/prep/tabs/tab-technicals.tsx`:
- `computeRSI` returns **50** when there are fewer than period + 1 closes. That's a fabricated "neutral" reading, not "unknown".
- `computeADX` returns **`20 + Math.random() * 10`** when data is short, so the prep room can show a random number as an indicator.
- RSI uses simple averages of the last 14 changes, not Wilder's smoothing, so values differ from standard charting tools.

The agents don't use this code. `lib/indicators/` has tested replacements that return null when data is short. Fixing the UI is proposal P9 (Bhavya's code).
