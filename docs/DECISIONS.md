# Architecture Decision Records

One short ADR per architectural decision. Never edit an accepted ADR's decision. If it changes, add a new ADR that supersedes it.

Template:

```
## ADR-NNN — <title>
**Status:** proposed | accepted | superseded by ADR-XXX
**Date:** YYYY-MM-DD · **Roadmap:** <task id>
**Context:** the problem and constraints.
**Options:** what we considered, with tradeoffs.
**Choice:** what we picked, and who decided.
**Consequences:** what this makes easy, hard, or impossible.
```

---

## ADR-001 — Agent execution model: hybrid (deterministic Monitor, ReAct Research, single-shot Coach)
**Status:** accepted
**Date:** 2026-09-23 · **Roadmap:** 1.1 · **Decided by:** Bhavya Talwar

**Context:** V2 needs Monitor → Research → Coach under an orchestrator, with a per-step decision-audit log and no agent reading numbers off chart images. Constraints:
- Groq supports tool calling on all current models, including `llama-3.1-8b-instant`.
- Only `gpt-oss-20b/120b` and `qwen/qwen3.8-27b` support strict (schema-enforced) structured outputs.
- Structured outputs can't be combined with tool use or streaming in the same request.
- The simulation runs at up to 150 ms per simulated minute.
- The engine currently runs only in the browser.

**Options:**
- **A. Chained prompts.** Code gathers the data; one LLM call per agent. Fastest and most testable, but not meaningfully agentic, so it's hard to distinguish from V1.
- **B. Function calling with our own ReAct loop in every agent.** Fully agentic, but pays loop latency and small-model unreliability three times, including where there's no choice for the model to make.
- **C. MCP.** C1: Groq runs the loop against our MCP server, so we lose the per-step audit log and step limit, and the server must be public and authenticated. C2: our route acts as the MCP client, which is B plus a protocol layer with a single consumer.
- **D. Hybrid.** An LLM only where judgement is needed.

**Choice: D.**
- **Monitor**: deterministic TypeScript rules over the engine's action stream. No LLM.
- **Research**: a ReAct loop written by us, using native function calling, read-only tools and a hard step limit. It ends when the model calls a `submit_findings` tool, whose arguments are validated with Zod.
- **Coach**: one structured-output LLM call.
- **Orchestrator**: a plain TypeScript state machine, not an LLM supervisor.
- **Tool registry**: name, description and Zod schema per tool (the same shape MCP uses), so exposing tools over MCP later is additive.
- We write the loop ourselves rather than using the `ai` SDK's built-in loop, for control over audit logging and so the mechanism is ours to explain.

**Consequences:**
- The model has real choice in Research (which data windows and indicators to use). Detection and handoffs are deterministic and testable.
- Every step can be logged (3.6); step limits and budgets are enforced by our code.
- Research's final output can't use schema-enforced decoding, so we validate with Zod and allow one repair retry.
- Monitor is an "agent" only in the software sense: it has the same interface and appears in the audit log, but has no LLM. This must be stated plainly in the report.
- Tools need trusted session state on the server (see proposal P1). This is not decided by this ADR.
- Latency: roughly 2–5 s per decision event (to measure in 1.7), so feedback lags the sim at high speed. The UX answer (pause the sim on decision events vs. show feedback late) is deferred to 7.1/7.5.
- Model choice per agent is deferred to the eval set (2.7).

---

## ADR-002 — Orchestrator: fallback ladder, server re-check, split budget, client-side coalescing
**Status:** accepted
**Date:** 2026-09-23 · **Roadmap:** 1.4 · **Decided by:** Bhavya Talwar (approved design); implemented by Claude

**Context:** One decision event must flow Monitor → Research → Coach and always yield feedback, within a time limit. At the same time:
- Research can fail or stall (the live run showed 2–5 s per run).
- Session state is currently client-sent (untrusted, P1).
- Users can trigger several events per second at 10× speed.
- The app runs on Vercel, whose server instances don't share memory.

**Options considered:**
- *On failure:* fail the whole pipeline, or retry, or **degrade step by step**.
- *Event trust:* take the client's event as-is, or **re-run Monitor on the server first**.
- *Timing:* one timeout per agent, or **one deadline with a reserve for Coach**.
- *Bursts:* queue everything, run everything in parallel, or **coalesce (latest wins)**.
- *Where coalescing lives:* server memory (broken on serverless), a database lock, or **the browser**.

**Choice:**
- **Fallback ladder:** `full` → `monitor_only` (Coach without Research) → `template` (a deterministic message from Monitor's event). An event the server can't reproduce is `rejected` before any tokens are spent.
- **Trust the server's event:** the server re-runs Monitor's pure rules on its snapshot and uses *its* event, not the client's claimed facts.
- **Split budget:** Research gets `deadline − coachReserve`; Coach gets whatever is left. Each agent is raced against its budget, so a stalled agent can't hold the pipeline.
- **Coalescing in the browser:** one pipeline at a time per session. While one is running, only the latest new event waits; older waiting events are dropped and reported.
- **No streaming:** Coach uses strict structured output, which Groq can't stream.

**Consequences:**
- The user always gets feedback, and the audit log records which path produced it.
- The re-check is only as trustworthy as the snapshot. With `client_snapshot` it catches inconsistent or buggy events, **not** a client that lies consistently. Real trust needs P1 (server replay).
- Coalescing in the browser means a malicious client can bypass it, so the server still needs a rate limit (8.4).
- Dropped events get no AI feedback. They must still appear in the audit log (3.2).
- The template path means Monitor's `summary` must always be written as a sentence the user can read.

---

## ADR-003 — Persistence: event-sourced action log, server-written audit trail, RLS
**Status:** accepted
**Date:** 2026-09-23 · **Roadmap:** 3.1, 3.2, 3.5, P1 · **Decided by:** Bhavya Talwar; implemented by Claude

**Context:** V2 must persist sessions and a decision-audit trail, keep users' data private, and eventually give agents trustworthy state (P1). The engine is a reducer that runs in the browser, and the app is hosted serverless on Vercel.

**Options (P1):**
- (a) Trust client snapshots: simplest, but untrusted.
- (b) Store the action log and replay the reducer on the server: trusted once the reducer is pure; phased.
- (c) Run the engine on the server: not viable on serverless, and a rewrite.

**Choice:**
- **(b), phased.** `session_actions` is an append-only log of user decisions and the source of truth. Ticks aren't stored; replay regenerates them. Agents use client snapshots until the P2 engine fixes land, then switch to server replay. The schema is the same either way.
- **Six tables:** `profiles`, `sessions`, `session_actions`, `decision_events`, `pipeline_runs`, `agent_runs`. No `trades` table (derived from the log) and no `scenarios` table (scenario data stays in code).
- **`state_before` stored on each decision event** even though replay could rebuild it. After an engine change, replaying an old log through the new reducer gives different states; the snapshot records what the user actually saw. `sessions.engine_version` records which engine produced a session.
- **Security:**
  - Users read only their own rows, and may append only to their own *active* session.
  - The audit trail and session results are written by the server alone (service role).
  - Triggers make the log and audit rows immutable for every role, including the server.
  - A second trigger requires `seq` to be contiguous and `sim_minute` never to go backwards.

**Consequences:**
- One log serves audit (3.2), replay UI (7.2), QA (4.6) and cross-session analysis (5.4).
- **The client still chooses which actions to send.** Replay stops it inventing prices, fills or cash, but not leaving out an action. The contiguity trigger catches gaps from sync bugs, not deliberate omission. Say so in the report.
- The server needs `SUPABASE_SERVICE_ROLE_KEY` (8.2). Leaking it bypasses every policy.
- `consent_at` is in place, but the ethics question (consent, retention, clearance) is still open.
- The migration is tested only in PGlite with a minimal Supabase shim. Supabase-specific behaviour (real JWTs, the default grants on the `auth` schema) must be checked once it's applied to the real project.

---

## ADR-004 — Auth hardening: route guard in proxy.ts, demo mode behind a flag
**Status:** accepted
**Date:** 2026-10-02 · **Roadmap:** 3.4, P5 · **Decided by:** Bhavya Talwar; implemented by Claude

**Context:** Before this change:
- Login and signup created a local account with any typed email and no password check, on any network error *or any `TypeError`*. This was committed and pushed to `main`.
- `/auth/callback` had an open redirect (`?next=@evil.com`).
- Login, onboarding and the sidebar sent users to `/dashboard` (404); a failed callback went to `/auth/auth-code-error` (404).
- No page required login: the old Edge-runtime middleware was deleted after it crashed on Vercel.

**Options:**
- *Fallback:* delete it, or **keep it behind an explicit flag** for demos without Supabase.
- *Route guard:* per-page checks in every component, or **one Next 16 `proxy.ts`**.
- *`/dashboard`:* build a placeholder page, or **redirect temporarily to `/ledger`**.

**Choice:**
- **Demo mode:** `NEXT_PUBLIC_DEMO_MODE=true` is required, it triggers only on genuine connection failures (not a bare `TypeError`, which is also what bugs throw), and it uses one fixed identity, `demo@zeroday.market`. It lives in `lib/auth/demo.ts`, which replaces 8 pasted blocks.
- **`safeNext()`** for every post-login redirect. It accepts only same-origin paths, checked by resolving against a dummy origin.
- **`proxy.ts`:** it refreshes the Supabase session cookie and sends signed-out users from protected pages to `/login?next=…`. Next 16 runs proxy on the Node.js runtime only, which avoids the Edge crash. It's off when Supabase isn't configured or demo mode is on. It uses `getUser()` (verified with Supabase), not `getSession()` (trusts the cookie). The rules live in `lib/auth/access.ts`, as a pure, unit-tested function.
- **`/api` is excluded from the proxy:** API routes must answer 401 themselves, not redirect to a login page.

**Consequences:**
- Pages are protected once deployed. **Not yet verified on Vercel**, where the old middleware failed, so it needs a signed-out visit to a protected page after deploy.
- **The ORUS API routes are still callable anonymously (P8).** They are Bhavya's code, so they were left untouched.
- Every protected page load now makes one `getUser()` call to Supabase: a small latency cost per navigation.
- Demo mode turns the guard off entirely, so it must never be set on the production deployment.

---

## ADR-005 — Session sync: journal inside the reducer, direct RLS inserts, deterministic order ids
**Status:** accepted
**Date:** 2026-10-02 · **Roadmap:** 3.3, P1, P2 (#5) · **Decided by:** Bhavya Talwar; implemented by Claude, including the 3 engine edits (at Bhavya's request)

**Context:** `session_actions` exists (ADR-003), but nothing writes to it. Replay must apply each action at the same simulated minute the live reducer did. React can queue a timer `TICK` and a click before re-rendering, so the minute in the last rendered state can be one tick stale. Order ids came from `Date.now()`/`Math.random()`, so a replay created different ids and a logged `CANCEL_ORDER` pointed at nothing.

**Options:**
- *Where to record:* wrap `dispatch` and read the minute from the rendered state (can be one tick off), or **wrap the reducer** and record the minute it actually saw.
- *Order ids:* generate them in the two call sites, or **derive them from state** (`o${orders.length + 1}`; orders are never removed).
- *Transport:* an API route, or **direct inserts from the browser** under the existing RLS policy.
- *Ending a session:* a client update (no policy allows it), or **a server route**.

**Choice:**
- `withJournal(reducer)`: a pure wrapper that passes the engine's state through untouched and appends `{seq, simMinute, action}` for every action except `TICK`, including no-op actions.
- Deterministic order ids.
- Direct RLS inserts through an in-order sync queue. Sync failure never blocks the sim, and sync is off when signed out, in demo mode, or when Supabase isn't configured.
- `/api/sessions/end` (server, service role, ownership check).
- `replay()` regenerates ticks between entries, and throws on an inconsistent log rather than guessing.

**Consequences:**
- Replay fidelity is tested: 150 random sessions rebuilt exactly from their journals after a JSON round trip.
- Resume-after-refresh is not possible yet: ticks after the last action are unlogged, so it needs a heartbeat entry.
- No-op actions are stored, so log volume is user actions, not ticks: a few hundred rows per session.
- In development, StrictMode double-runs the mount effect, so a session may log two `START`s. Replay is unaffected.
- **Scope addendum (2026-10-02, Bhavya):** only the live session moves to Supabase. The other 5 localStorage keys stay:
  - `zdm_user_v2` is already mirrored to `user_metadata`. That metadata is *user-writable*, so its XP and streak are not evidence.
  - `zdm-trace` stays for the V1 debrief. 5.x computes behaviour from server replay of the journal instead.
  - The bandit is outside the V2 scope.
  - Help chat stays local for privacy/consent.
  - Prep telemetry is written but never read, and portfolio runs are orphaned: both go to P4.
- **For P1:** the reducer lives in a `'use client'` module. Server code (the replay for P1) can't call it from there; it will need to move to a plain module. That's a future proposal for Bhavya.

---

## ADR-006 — Monitor: rules over the journal, one event per action, isomorphic
**Status:** accepted (thresholds provisional; `panic_sell` threshold open)
**Date:** 2026-10-02 · **Roadmap:** 2.1, P1 · **Decided by:** Bhavya Talwar; framework and 4 rules by Claude, 2 rules by Bhavya

**Context:** Monitor (ADR-001: deterministic, no LLM) decides which user decisions trigger the Research → Coach pipeline. Each event costs a pipeline run, about 2–5 s plus tokens. The server must re-detect claimed events (ADR-002). Behavioural patterns (panic, revenge) depend on what came before, not on one state.

**Options:**
- *Input:* a single state snapshot (M1's `detect(snapshot)`), or **the action in context**: state before and after, plus the journal so far.
- *Volume:* every matching rule, or **at most one event per action** (by priority) **with a per-kind cooldown**.
- *Where it runs:* server only, or **both sides** (the browser decides when to ask; the server re-checks by replaying the stored journal).
- *Time unit:* wall-clock seconds (V1), or **sim minutes** (the log has no trustworthy wall clock).

**Choice:**
- `lib/monitor/`: a pure `Rule(ctx) → event | null` per kind; `monitorStep` (priority + 15-minute cooldown, accepted orders only); `monitorSession(journal)` replays and runs every step.
- Priority: `panic_sell` > `revenge_trade` > `averaging_down` > `news_reflex` > `oversized_position` > `overtrading`.
- `runPipeline` is generic over Monitor's input.
- The engine moved verbatim to `lib/engine/live-reducer.ts` (no `'use client'`).
- No stop-loss events until P2 #1 (stops never execute).
- News timing comes from scenario data, because the screen shows news by time even though `firedNewsIds` is never written.

**Consequences:**
- Browser and server get the same events from the same journal (tested, including the JSON round trip).
- The server re-check costs one replay, a few ms for a 375-minute session.
- **Thresholds are design parameters, not findings.** On COV-20, `panic_sell` at 3%/15 min never fires (max 2.08%).
- **`panic_sell` addendum (2026-10-02, Bhavya): "on-screen red".** Sell a ≥2%-underwater position while the stock is ≥5% below the previous close (the HUD's red % change) and lower than 15 minutes ago. Measured alternatives:
  - A lower absolute drop (1.5%/15 min) fires only in the first ~40 minutes and is tuned to synthetic data.
  - A baseline from the same session's earlier bars fails on opening crashes, because the crash becomes the baseline: only 5 minutes all day, none in the sell-off.
  - A pre-session volatility baseline (σ_daily·√(15/375)) is the most principled, but needs real history per stock (M4.2/4.3). **It is the planned upgrade.**
  - Tradeoff of the chosen rule: on a crash day, 4 of 6 stocks are "red and falling" for about half the session, so it detects context, not a sudden move. The user's losing sale is what makes it specific.
- `news_reflex` treats any PAUSE after the headline as "stopped to think", including the tutorial's automatic pause.
- Rejected orders are never judged, though `overtrading` counts them as attempts.

---

## ADR-007 — Research tools: lookback-only, capped market view, grounding enforced in the loop
**Status:** accepted (tools); **the agent's capacity/cost is open** (see Consequences)
**Date:** 2026-10-02 · **Roadmap:** 2.3, 2.4, 6.1, 6.3 · **Decided by:** Bhavya Talwar; implemented by Claude

**Context:**
- Research (ADR-001: our own ReAct loop) needs read-only market tools.
- The M1 smoke run showed qwen requesting future prices through range-based tools.
- The thesis claim (M6) is that agents use only numbers our code computed.
- V1's indicator code returns made-up values (RSI 50, a random ADX) when data is short.

**Choice:**
- **No lookahead, by construction:**
  - tools take a lookback, never a range;
  - they read the scenario only through `marketAt(scenario, simMinute)`, whose current bar exposes only its close (the displayed price);
  - a property test runs every tool on the scenario cut and poisoned at the decision minute and requires identical output, with 2 planted leaks shown to be caught.
- **Five tools:** price window, indicators, news (answer key withheld), market and position. Stop prices are omitted because stops never execute (P2).
- **`lib/indicators/`, written fresh rather than moved from the UI:** Wilder RSI, SMA and VWAP, returning null plus a reason when data is short.
- **Grounding inside the loop:** a new `AgentSpec.check` hook. A schema-valid submission containing numbers no tool returned is rejected as `failed_check` and gets one repair. Rounding is allowed and sign is ignored.
- **Symbol is an enum of the scenario's symbols** in the schema the model sees.
- **Loop fix:** a `tool_use_failed` retry no longer consumes a step, so a malformed forced submit on the last step can be retried.

**Consequences:**
- Lookahead and invented numbers are now enforced properties, not prompt requests. The report can say so, with the property test as evidence.
- **Grounding checks provenance, not meaning:** a right number on the wrong claim passes.
- **Cost:**
  - One ReAct run is 3.5–6.5k tokens, because every step re-sends the conversation.
  - The free tier allows 8,000 tokens/minute per model, so that's about 1 pipeline per minute, and a long run can hit 429 on its own.
  - Live: 1 of 8 runs ok across two runs.
  - Capacity options are recorded in LEARNINGS; the decision is Bhavya's.

---

## ADR-008 — Capacity: one model per agent, pause the sim on decision events
**Status:** accepted (model split done; the pause is built with the client wiring)
**Date:** 2026-10-02 · **Roadmap:** 2.3, 2.5, 7.1, 7.5, 8.4 · **Decided by:** Bhavya Talwar (Claude's recommendation)

**Context:**
- Groq's free tier on the one configured key allows 8,000 tokens/minute **per model** and 1,000 requests/day.
- A ReAct Research run costs 3.5–6.5k tokens, because every step re-sends the conversation. A Coach call costs about 1k.
- Live runs (2026-10-02): Research was ok 1 of 8 times, mostly because of 429s and gpt-oss failing forced submits.

**Options:**
- (a) Separate models per agent.
- (b) Fewer tokens: code pre-fetches a context bundle, so Research becomes 1–2 calls (less agentic).
- (c) Pause the sim on decision events.
- (d) A paid tier.
- Rejected: multiple free accounts, which likely breaks Groq's terms.

**Choice: (a) + (c).**
- Research uses `qwen/qwen3.8-27b`: parallel tool calls, the only ok live run, and no forced-submit failure.
- Coach uses `openai/gpt-oss-20b`: strict JSON, live 2/2 ok in under 1 s.
- Each draws on its own 8k/min.
- The sim pauses while a decision event is processed, so events arrive at human pace. This also settles the UX question deferred in ADR-001 ("pause vs. late feedback").

**Consequences:**
- Free, and Research stays agentic.
- Throughput is still about one full pipeline per minute per user, enough for a demo or a small study but not for many concurrent users. (d) or (b) remain the levers if needed.
- The pause changes the experience: the sim stops at a flagged decision until feedback arrives (≤12 s budget, ADR-002). That's the intended "teachable moment", and it must be described in the report.
- Model choice per agent is still provisional until the 2.7 eval set.

---

## ADR-009 — Scenario data: real daily bars, reconstructed intraday; four scenarios
**Status:** accepted
**Date:** 2026-10-03 · **Roadmap:** M4 (4.1–4.6), 3.7, P9 · **Decided by:** Bhavya Talwar (Claude's recommendation)

**Context:**
- The proposal promises real historical OHLCV via tools. The audit found COV-20 is synthetic: one shared curve plus noise.
- Probed 2026-10-03: free sources (Yahoo chart API, Stooq) serve **real daily** OHLC, including NSE (`^NSEI`, `RELIANCE.NS`). **Historical 1-minute data isn't free anywhere.** Yahoo answers *"1m data not available … must be within the last 30 days"*. Polygon's free tier is US-only and delayed.
- The engine runs an intraday session (375 minutes), so it needs minute prices.

**Options:**
- (a) Real daily bars, with a reconstructed intraday path that exactly hits each real open, high, low and close, labelled "reconstructed".
- (b) Daily-bar scenarios: fully real, but the sim becomes multi-day, which means a large engine change.
- (c) Paid 1-minute data: the most faithful, but it costs money and Polygon likely lacks NSE.

Scope options: all 9 remaining scenarios, 3 strong ones, or COV-20 only.

**Choice: (a), with COV-20 plus 3 scenarios that have clean free data.** The other 6 are shown as "coming soon", each with its documented reason:
- Lehman: LEH is delisted, so there's no free data;
- Flash Crash 2010: a 36-minute event that daily bars can't show;
- Crypto 2018: a 24/7 market with different rules.

**Consequences:**
- Every daily number an agent quotes (open, high, low, close, previous close, multi-day indicators) is real and traceable to a source file. Intraday shape is not: the report must say so, and the UI labels it.
- Research's minute-level claims (e.g. "fell 1.2% in 15 minutes") are about the reconstruction. This needs a limitation section, and the eval set should keep claims about daily facts separate from claims about intraday shape.
- COV-20 is re-anchored to the real 9 March 2020 NSE daily bars. Its intraday path stays reconstructed.
- The reconstruction must be deterministic (seeded), so replay and the server re-check stay exact (ADR-003/005).

---

## ADR-010 — Evaluation: fixed cases, four systems, an automatic rubric
**Status:** accepted; first results 2026-10-03
**Date:** 2026-10-03 · **Roadmap:** 2.7, 1.7, 5.5, 6.1, 8.3 · **Decided by:** Claude, under Bhavya's "complete all modules" instruction (reviewable)

**Context:**
- The proposal claims a multi-agent pipeline beats V1's single prompts. The audit (Q3) warned that without a controlled comparison this is "an architecture choice, not a result".
- Budget: Groq free tier, one key.

**Options:**
- (a) An LLM judge scores free-text answers. It adds its own errors and costs quota.
- (b) Human rating. That's the best measure of quality, but needs raters and time.
- (c) Automatic checks (regex, grounding matcher) on fixed cases. Transparent and cheap, but crude.

**Choice: (c)**, leaving (a)/(b) as optional extensions.
- **Cases:** 15 fixed decisions from scripted COV-20 sessions (2 per Monitor pattern + 3 harmless). They are *found* in the price data, and `cases.test.ts` asserts each still shows its intended pattern.
- **Four systems:**
  - **A**, the full pipeline;
  - **B**, Monitor → Coach;
  - **C**, one prompt that detects and coaches, given the same raw facts, definitions and guardrails;
  - **T**, the deterministic templates.
- **Rubric:** 7 checks: valid, grounded, no stop-loss advice, names the pattern, consistent with the stock's real direction, actionable, ends with a question.
- **Pacing:** each Research run waits for an empty token window, so rate limits don't distort the comparison.

**Results (run 2, after two fairness fixes; `docs/evidence/eval-2026-10-03.md`):**

| System | Detection | Mean rubric | Median latency | Mean tokens |
|---|---|---|---|---|
| A pipeline | 15/15 | 99% | 2.7 s | 7.2k |
| B no Research | 15/15 | 98% | 0.7 s | 0.7k |
| C single prompt | 13/15 | 89% | 0.7 s | 1.2k |
| T template | 15/15 | 100% (partly circular) | – | – |

- **Run 1** (`eval-2026-10-03-run1.md`) showed C at 63% and detection 9/15. Two of its failures were my bug: C's grounding ignored its own definitions. Strict-JSON failures got no repair. Both were fixed before run 2. **Reporting both runs is part of the result.**

**Consequences / findings:**
- **The measured advantage of the architecture is detection reliability and determinism, not answer quality on these checks.** C missed a revenge trade and once produced invalid output. A, B and T detect by construction. The audit trail can show why each event fired.
- **Research added no measurable rubric value** but cost about 10× the tokens and about 2 s. The rubric doesn't measure how rich the context is. A human or LLM-judge study of "does the feedback reflect the market situation" is the open measure.
- **Free-tier reliability:** Research completed 9/12 in both runs. A follow-up prompt asking for all tools in one turn scored 5/12: qwen produced malformed parallel calls, and the rejected calls still used input tokens. It was reverted (`docs/evidence/research-turns-2026-10-03.md`). Groq enforces **7,000 input tokens/minute** on qwen, and a Research run whose model takes a third turn exceeds it on its own (re-sent conversation). The fallback ladder covered every failure (path `monitor_only`).
- **The rubric found a real product bug:** 8/12 template answers gave no concrete action. Fixed. That's why T scoring 100% is partly circular.
- **Labels are our definitions** (ADR-006). This measures agreement with them.

---

## ADR-011 — Multi-market engine; the scenario mix
**Status:** accepted
**Date:** 2026-10-03 · **Roadmap:** 4.1–4.6, 7.3 · **Decided by:** Bhavya Talwar ("Mix"), implementation by Claude at Bhavya's request

**Context:**
- ADR-009 chose COV-20 plus 3 scenarios with real daily data.
- The engine and live UI assumed NSE everywhere:
  - ₹ hardcoded about 50 times;
  - the clock fixed at 9:15–15:30 IST in 18 places;
  - a 375-minute session;
  - COV-20's prices and circuits imported directly into the reducer.

**Options:**
- (a) Indian events only, so the engine barely changes.
- (b) The proposal's US/UK events.
- (c) A mix.

**Choice: (c).** The scenarios:
- **TAX-19:** the corporate-tax-cut rally, 20 Sep 2019, NSE. An *up* day, which tests the coach on rallies.
- **ELEC-24:** the election-results crash, 4 Jun 2024, NSE.
- **GME-21:** the GameStop squeeze, 27 Jan 2021, NYSE.

**Engine changes:**
- A `MarketSpec` per scenario: exchange, time zone, open time, session length, currency, locale.
- The reducer reads prices, session length and circuits from `state.scenarioId`.
- `initialState(scenarioId)`.
- Every replay (Monitor, server re-check, scorecard) starts from the session's own scenario (`engineFor`).
- The trading logic is unchanged. All 323 earlier tests pass, including the 150-session replay proof.

**Consequences:**
- **4 of 10 proposal scenarios are playable.** The other 6 are listed in the UI with reasons: delisted data (Lehman), an intraday-only event (Flash Crash), a different market model (crypto), and 3 cut for time.
- **New-scenario headlines** are documented facts with times marked "approximate" where not minute-exact. The invented noise items are labelled "Illustrative". **Nothing invented is presented as history.**
- **GME's single-stock volatility halts aren't simulated;** the manifest says so.
- **Not built for the new scenarios:**
  - a prep room (COV-20's dossiers are hand-written; new scenarios get a briefing instead);
  - ORUS whispers.

  The live tutorial's worked examples stay in ₹.
- **COV-20 is not re-anchored to real data** (amends ADR-009). Its headlines quote the synthetic levels ("NIFTY opens at 10,524"). Re-anchoring would mean rewriting Bhavya's scenario text and re-deriving its circuit timing. It stays synthetic, and the scenario picker says so.
- `ENGINE_VERSION` is now `v2.3`.

---

## ADR-012 — Rate limiting in the database; Coach history as input
**Status:** accepted (the migration must be applied to Supabase)
**Date:** 2026-10-03 · **Roadmap:** 8.4, 2.6 · **Decided by:** Claude, under Bhavya's "complete all modules" instruction (reviewable)

**Context (8.4):**
- The only guard on Groq spend was client-side coalescing. A signed-in user could script calls to `/api/pipeline` or the ORUS routes and exhaust the shared free tier.
- Serverless instances share no memory, so an in-process counter would reset per instance.

**Options:**
- (a) An in-memory limiter. It breaks across instances.
- (b) A hosted KV store (Upstash/Redis). That's a new service and a new secret.
- (c) A Postgres function on the database we already have.

**Choice: (c).** `consume_quota(bucket, max, window)`:
- **Atomicity:** `security definer`, so it acts only for `auth.uid()`; an advisory lock per user and bucket makes it atomic.
- **Table access:** RLS on with no policies, so the table can't be read or forged directly.
- **Limits:** the pipeline gets 40 runs/hour per user; the V1 ORUS routes 60 calls/hour.
- **Fails open** if the function is missing (e.g. the migration isn't applied yet), with a server warning. A broken limiter must not take the coach down.

**Context (2.6):** the proposal lists "Coach tools: past decision history, bias taxonomy". ADR-001 made the Coach a single call with no tools.

**Choice:** the server computes the same information and passes it as **input**:
- how often this pattern was flagged earlier in the session and in the user's past scored sessions;
- a bias taxonomy: each pattern → the behavioural-finance bias with its classic reference.

The Coach is told to name repetition ("the third time today"). The numbers are in its input, so the grounding check allows them.

**Consequences:**
- One more migration to apply (`20261003090000_api_quota.sql`).
- Per-user, not global: the free tier's per-minute limit is still shared by all users (ADR-008).
- "Tools" for the Coach became inputs, which keeps it at one call (latency, ADR-002).
- 2.2 "Monitor tools" is likewise met by the rule context (position, portfolio, clock, scenario). Monitor is deterministic and calls nothing.
