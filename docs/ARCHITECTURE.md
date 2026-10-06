# Zero Day V2: Architecture and its Justification

*Draft text for the thesis (roadmap 6.2 and 6.4), 2026-10-03. Every claim points to an ADR, a test or an evidence file. Where a citation or a figure from the FinVQA-Chart study is needed, it is marked **[cite]** for the authors to fill in. This document does not restate that study's numbers.*

---

## 1. The problem V2 addresses

V1 ("ORUS") was a set of independent single-shot LLM calls. Of seven Groq routes, three could be reached from the UI, and **none ran during trading**. The in-simulation coach was scripted text (`docs/AUDIT.md` §3). V1 had no multi-step reasoning, no tools, no persistent memory beyond the browser, and no server-side copy of the trading state. A model asked about a trade had nothing trustworthy to reason about.

V2's goal is **feedback at the moment of decision**, grounded in verifiable market facts, with every step auditable.

---

## 2. Response to the FinVQA-Chart finding (6.2)

**The finding.** The FinVQA-Chart benchmark **[cite]** evaluated vision-language models on questions about financial charts. Models failed at *cross-modal binding*: they did not reliably link a value read from the chart image to the right element of the question, and they tended to confirm what the text suggested rather than what the chart showed (text-driven confirmation bias). We refer to this as the Fusion Efficiency finding **[cite]**.

**The design consequence.** If a model can't be trusted to read numbers off a chart, a trading coach must not depend on it doing so. V2 removes that dependency structurally rather than hoping a prompt prevents it:

| Risk the finding implies | V2's mechanism | Enforced by | Evidence |
|---|---|---|---|
| A model misreads a value from a chart image | **No agent receives any image** (ADR-007). Charts exist only in the UI for the human | Architecture: agent inputs are text and JSON | `lib/agents/*` types; no vision calls exist |
| A model invents a plausible number | **Every number an agent states must appear in a tool result or its input** (grounding check). A violation is rejected and the agent gets one repair attempt | `checkGrounding` (Research), `checkCoach` (Coach) | Unit tests; eval: A and B grounded on 12/12 and 12/12 cases (`docs/evidence/eval-2026-10-03.md`) |
| A model "reads" an indicator from a chart | **Indicators are computed in code** from OHLCV (Wilder RSI, SMA, VWAP, ADX). They return *null* rather than a guessed value when data is short | `lib/indicators/` (tested); P9 removed a random ADX and a default RSI from the V1 UI | `indicators.test.ts` |
| A model uses information from the future | Tools see a **market view capped at the decision minute**. Arguments are lookback-only | A property test over every tool × 54 minutes × 6 symbols × 3 lookbacks against a poisoned future | `lib/agents/research/tools.test.ts`; 2 planted leaks caught |
| Confirmation bias from text | The Coach's claims about direction are checked against the stock's real move | Rubric `directionConsistent` (eval only, not yet a runtime check) | Caught the production answer "buying at a peak" on a −7.9% day |

**What this does not solve (state it):**
- **Binding errors survive grounding.** A correct number attached to the wrong claim passes, because grounding checks *provenance*, not *meaning*.
- The direction check is an eval-time lexicon, not a runtime guard.
- New scenarios have real daily bars but a **reconstructed** intraday path (ADR-009). Minute-level claims describe the reconstruction.

---

## 3. Architectural justification (6.4)

### 3.1 Three agents, three execution styles (ADR-001)

| Agent | Style | Why this style |
|---|---|---|
| **Monitor:** detects a risky decision | Deterministic rules over the action log | Detection must be **reproducible** (the server re-runs it), **cheap** (every action) and **explainable** ("you sold 3.6% under cost while the stock was 8.4% red and falling"). An LLM adds nothing here and costs determinism. |
| **Research:** gathers market context | ReAct loop with 5 tools | The needed context depends on the event (a news reflex needs headlines; a panic sell needs the price window). Choosing tools is genuinely agentic work. |
| **Coach:** writes the feedback | One strict-JSON call with an enforced content check | Writing is one step. A loop would add latency without adding information. |

**Rejected alternatives:**
- **One LLM for everything:** see §4. It measured lower on detection.
- **MCP / dynamic agent routing:** no routing decision exists that the fixed order doesn't already make. Dynamic routing adds latency and failure modes.

### 3.2 A fixed pipeline with a fallback ladder (ADR-002)

The orchestrator runs Monitor → Research → Coach in a fixed order, under a time budget. A failure degrades the answer instead of dropping it:
- **full:** Research and Coach both succeed;
- **monitor_only:** Research failed, so the Coach works from Monitor's facts;
- **template:** the Coach failed too, so a deterministic message is used;
- **rejected:** the server couldn't reproduce the claimed event.

The user always gets feedback, and the UI says which kind. In the evaluation, the ladder caught every Research failure (9/12 Research runs succeeded on the free tier; ADR-010).

### 3.3 Server-authoritative state by event sourcing (ADR-003, ADR-005)

- **The problem:** the trading engine runs in the browser, so a client could claim any portfolio to an agent.
- **The design:**
  - every user action is journaled inside the reducer (with the exact simulated minute) and appended to Supabase under row-level security;
  - the server **replays** the log through the same pure reducer to rebuild the state, then **re-runs Monitor** on it;
  - it spends tokens only if the claimed event reappears *for that exact action*.
- **Evidence:** replay reproduces the live state exactly on 150 random sessions (COV-20) and on 5 per new scenario (`lib/data/scenarios/scenarios.test.ts`).
- **The same replay produces:**
  - the scorecard (5.3): the client never sends its own score;
  - the study measures (`docs/STUDY.md`).

### 3.4 An audit trail for every decision (ADR-003, 3.6)

For every flagged decision, the database holds:
- the triggering action;
- the state before it;
- the event's facts;
- the pipeline path;
- each agent's full trace: every model turn, tool call and result, with tokens, latency and errors.

These are written in one transaction by the server, and the log and audit rows can't be updated (triggers). Users can replay their own (`/progress/[id]`).

### 3.5 Capacity on a free tier (ADR-008, ADR-010)

Groq's free tier allows, per model, 1,000 requests/day, 8,000 tokens/minute and (measured on qwen) **7,000 input tokens/minute**. Because a ReAct loop re-sends its conversation each turn, a Research run of three turns can exceed the input limit by itself. The responses:
- one model per agent (separate limits);
- the simulation **pauses** on a flagged decision, so feedback arrives at human pace;
- 429s carry and honour `retry-after`;
- per-user hourly quotas are enforced in the database (ADR-012).

### 3.6 Data (ADR-009, ADR-011)

Free sources provide real daily OHLC (including NSE) but no historical minute data. Three new scenarios use **real daily bars**, un-adjusted for later splits, with a **seeded, deterministic intraday reconstruction**. That reconstruction hits each real open, high, low and close exactly and co-moves with the index. COV-20 remains a synthetic reconstruction and is labelled as such.

---

## 4. Does the multi-agent design beat one good prompt? (evidence)

Fifteen fixed decisions were each run through four systems and scored by seven automatic checks (ADR-010, `docs/evidence/eval-2026-10-03.md`):

| System | Detection (15) | Rubric (12 positives) | Median latency | Mean tokens |
|---|---|---|---|---|
| A: Monitor → Research → Coach | **15/15** | 99% | 2.7 s | 7.2k |
| B: Monitor → Coach | **15/15** | 98% | 0.7 s | 0.7k |
| C: one prompt (detect + coach) | 13/15 | 89% | 0.7 s | 1.2k |
| T: templates | 15/15 | 100%* | – | – |

\* Partly circular: the templates were fixed using the rubric.

**Interpretation (stated as the thesis should state it):**
- **The architecture's measured advantage is reliable, deterministic detection and auditability.** One prompt, given the same facts and definitions, missed a revenge trade and once produced invalid output.
- **Feedback quality on these checks is similar.**
- **Research did not raise the rubric score** while costing about 10× the tokens. The rubric doesn't measure how well feedback reflects the market context, so that remains an open question for a human-rated study.
- **The first evaluation run was unfair to the baseline** (a grounding bug of ours). Both runs are reported.

---

## 5. Limitations

- **Labels:** behavioural labels are our operational definitions (ADR-006), and the eval measures agreement with them.
- **Prices:** COV-20 is synthetic; the intraday paths of the other scenarios are reconstructed.
- **Thesis claim:** the cross-session improvement claim (5.4) needs the study in `docs/STUDY.md`, which has not been run. As designed (a pilot) it is underpowered.
- **Free-tier limits:** Research succeeds about 75% of the time under the free-tier limits.
- **Not simulated:** stop-loss orders don't execute in the engine (AUDIT P2), so the Coach is forbidden from recommending them. GME's volatility halts are also not simulated.
