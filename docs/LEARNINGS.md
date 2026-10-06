# Learnings Log

Append-only. One entry per substantive task.

---

## [2026-09-23] 0.1 — Auditing V1 before building V2

**What we built:** `docs/AUDIT.md`, a map of the existing engine, scenario pipeline, all Groq call sites, browser storage and Supabase usage, with each roadmap task tagged PARTIAL or NOT STARTED. No code was changed.

**Why this approach:** We needed to know what V1 *actually does*, not what its docs say. The alternative, trusting `PROJECT_CONTEXT.txt`, would have been wrong in several places: it lists five ORUS calls where the code has seven routes and only three are reachable, it calls the data "real price data" when it's generated, and it describes features that are stored but never executed.

**How it actually works:**
- *Reachability analysis.* A file existing doesn't mean it runs. For each API route we traced its callers, then each caller's importers, up to a page in `app/`. If the chain never reaches a page, the code is dead. That's how portfolio mode (22 components) and 4 of 7 Groq routes turned out to be unreachable.
- *A reducer is a state machine.* `useReducer(reducer, init)` gives you `state' = f(state, action)`. The "states" are the values of `status`; the "transitions" are which actions change it. Drawing that table is how you check an FSM has no dead or unreachable states (`PRE_OPEN` lasts one render).
- *Event sourcing.* If a reducer is pure (same input, same output, no clock or randomness inside), then the list of actions *is* a complete record of the session: replaying them rebuilds every intermediate state. That's the cheapest possible decision-audit log. Our reducer is *almost* pure; `Date.now()`/`Math.random()` in `PLACE_ORDER` break it.
- *Derived vs emitted events.* The engine doesn't emit events; `TraceBridge` infers them by diffing state between renders. It works, but anything the state doesn't record can't be inferred, which is why `news_dropped` never fires (`firedNewsIds` is never written).

**Gotchas:**
- "Wired end-to-end" meant direct `COV20_*` imports in 5+ files, with the `[id]` route param ignored. Adding scenario 2 isn't adding data; it means changing the engine.
- A UI control can update state without changing behaviour: the stop-loss button sets `stopPrice`, which nothing ever reads during matching. Look for a *reader* of every field, not just a writer.
- Supabase `user_metadata` is writable by the user with the anon key, so it's no place for scores you want to trust.

**Open questions:**
- Where does trusted session state live once agents run server-side? (Input to 1.1.)
- Real OHLCV source for NSE scenarios, if Polygon doesn't cover them.
- Keep or delete portfolio mode and the orphaned routes?
- Are the COV-20 circuit-breaker events historically accurate?

---

## [2026-09-23] 1.1 — Choosing the agent execution model (hybrid)

**What we built:** A decision (ADR-001), not code. Monitor is deterministic rules. Research is a ReAct loop we write ourselves, using native function calling. Coach is one structured LLM call. A plain TypeScript orchestrator sits over all three.

**Why this approach:** We used an LLM only where there is a real choice to make: which data should Research look at? Chained prompts (A) were rejected as too close to V1 to defend. "Every agent loops" (B) pays latency and small-model unreliability where no choice exists. Groq-hosted MCP (C1) hands the loop to Groq, which breaks our per-step audit log and step limit. We rejected the SDK's built-in loop because it hides the mechanism we need to log and explain.

**How it actually works:**
- *Function calling.* The model never executes anything. We send tool definitions (name, description, JSON Schema). The model replies with a structured call, e.g. `{name, arguments}`. Our code validates the arguments, runs the function, appends the result as a `tool` message, and calls the model again.
- *ReAct* = that exchange in a loop (reason, act, observe), ended by us. It stops on a step limit, a timeout, or the model calling a designated "submit" tool.
- *MCP* sits one layer down. It standardises where tools live and how clients discover them across processes. The model still reaches them through function calling. MCP helps when many clients share tools; we have one client.
- *Why "submit" is a tool:* on Groq, schema-enforced output can't be combined with tool use in the same request. So a looping agent returns its final answer as the arguments of a `submit_findings` tool call, which we validate with Zod ourselves.

**Gotchas:**
- "Structured outputs" on Groq has two levels. `strict: true` means the decoder is constrained to the schema, and only some models support it. `strict: false` means best effort: the JSON may parse but not match the schema. Never trust model output without validating it.
- The 8B model supports tool calling, but "supported" ≠ "reliable". Which model each agent uses gets settled by the eval set, not by the docs.
- Latency multiplies: each loop step is a full round trip. Three agents × several steps is seconds, while the sim ticks every 150 ms at 10×.

**Open questions:**
- P1: where trusted session state comes from (client snapshot vs. replaying the reducer on the server).
- Whether the sim pauses on decision events (UX, 7.1).
- The model for Research (2.7).
- How the report defends a rule-based "Monitor Agent".

---

## [2026-09-23] 1.2 (part 1) — Agent contracts, tool schemas, and a test runner

**What we built:** In `frontend/lib/agents/`:
- `types.ts`: the contracts for tools, agents, runs and steps.
- `groq-tools.ts`: turns a Zod schema into a Groq tool definition.
- `registry.ts`: `createRegistry`, plus an `executeTool` stub with its spec.

Tests use vitest (`npm test`). Pending: `executeTool`, which Bhavya implements against 10 spec tests.

**Why this approach:** One Zod schema per tool is the single source of truth. It generates the JSON Schema the model sees *and* validates what the model sends back, so the two can't drift apart. Runs return a `status` instead of throwing, because the orchestrator needs to know *how* a run failed to choose a fallback, and the audit log must record failures too. `SessionSnapshot.source` records whether state came from the client (untrusted) or a server replay (trusted). That lets us ship M1 on client snapshots without hiding the weakness.

**How it actually works:**
- *Input vs output schemas.* A Zod schema describes two shapes. `z.number().default(3)` is optional in what the model *sends* (input) but always present after parsing (output). Tools are described to the model with `io: 'input'`, and run with the parsed data.
- *Tool-call arguments arrive as a JSON string*, not an object. Parsing can fail, which is a different failure from "parsed but wrong shape". `ToolErrorKind` separates the two so evals can count how often each model makes each mistake.
- *`server-only`* makes the build fail if a client component imports agent code, which would leak prompts and keys into the browser bundle. It throws outside Next's server build, so tests alias it to an empty module.

**Gotchas:**
- vitest 5 requires `@types/node` 22 or newer; we're on 20, so we used vitest 4.
- npm 10.9 crashed (`Cannot read properties of null (reading 'edgesOut')`) resolving vitest's optional peers. The obvious fix, `--legacy-peer-deps`, **silently broke the lockfile**: peers were left out, and `npm ci` in CI would have failed. We caught it by running `npm ci --dry-run`, and confirmed the committed lockfile was fine by testing it in a scratch directory. The fix: restore both files and install with npm 11 via `npx npm@11`. Lesson: after any dependency change, run `npm ci --dry-run` before pushing.
- `z.number().int()` puts ±9007199254740991 bounds into the JSON Schema. That's pure token noise on every request, so the converter strips it.

**Open questions:**
- Add `npm test` to CI now (it fails until `executeTool` exists) or after? (8.3)
- P1 is still on client snapshots. The switch to server replay waits on the P2 engine fixes.

---

## [2026-09-23] 1.3 (prep) — Model transport and a scripted fake model

**What we built:** `lib/agents/model.ts`:
- `ModelCaller`, a function type for one chat-completion call.
- `createGroqCaller`, the real implementation: request format, 429 key rotation, typed errors.
- `scriptedModel`, a fake that replays pre-written model turns and records every request.

There are 8 tests, none of which touch the network.

**Why this approach:** The ReAct loop depends on the *type* `ModelCaller`, not on Groq. This is dependency injection: the caller passes in the thing that talks to the model. Tests and evals can then script exact model behaviour, including the bad kind (broken JSON, unknown tools, never submitting), deterministically and for free. We rejected mocking `fetch` inside loop tests: that would tie the loop's tests to Groq's wire format, which is the transport's job and already has its own tests.

**How it actually works:**
- The transport makes *one* call and throws a typed `ModelCallError` (`rate_limited`, `tool_use_failed`, `http`, `network`, `aborted`, `bad_response`). Converting errors into a run `status` is the loop's job. The transport doesn't know what a "run" is.
- It returns the assistant message in two forms: *wire format*, to append to the conversation (tool results must follow the exact message that requested them, matched by `tool_call_id`), and *audit format* (`ModelStep`).
- Key rotation state is kept per caller, not in a module global as in V1's routes. That means tests don't leak state into each other.

**Gotchas:**
- Groq deprecated `max_tokens` in favour of `max_completion_tokens`. V1's routes still use the old name.
- `parallel_tool_calls` is only sent when explicitly set, because Groq lists the gpt-oss models as not supporting parallel calls.
- `tool_use_failed` (a 400 when the model emits a malformed tool call) is observed Groq behaviour, not in the API reference we read. It's classified by string match, which is fragile.
- The fake copies `messages` on each request, because the loop keeps appending to the same array after the call returns.

**Open questions:**
- Is the key rotation within Groq's terms? (8.4)

---

## [2026-09-23] 1.3 (spec) — Loop decisions, spec tests, and testing the tests

**What we built:** The 1.3 loop design was agreed as six decisions:
1. `tool_choice: required`, with a nudge on prose.
2. Submit wins within a turn.
3. One repair attempt for an invalid submit.
4. Submit is forced on the last step.
5. One run-wide timer.
6. Retry `tool_use_failed` once.

`react-loop.ts` holds the stub and spec; `react-loop.test.ts` has 16 tests against the fake model. `ToolChoice` now accepts a named tool.

**Why this approach:** Each decision closes one way the loop could end ambiguously, so "how does your agent terminate?" has an exact answer. The alternatives were: allowing prose answers (we'd have to parse free text), running every call in a turn even when one is a submit (wasted work and unclear ordering), and no forced final step (more `step_limit` failures that return nothing).

**How it actually works:**
- *Forced finalisation.* On the last allowed step, `tool_choice: {type:'function', function:{name:'submit_findings'}}` removes every option except answering. The model must turn whatever it has gathered into an answer. Graceful degradation: a partial answer we can validate beats no answer.
- *Racing a promise against a timer.* `AbortController.abort()` only *asks* code to stop; a promise that ignores the signal keeps running. So the loop races each await against a "timed out" promise. Whichever settles first wins, and the loser's result is ignored. Clearing the timer afterwards stops it firing later and keeping the process alive.
- *Testing the tests.* A spec test can be wrong: it can demand something impossible, or depend on an accident of one implementation. Before handing over the tests, we wrote throwaway reference implementations *outside the repo* and ran the real test files against them: 41/41 passed. So a failing test means a bug in the implementation, not in the test.

**Gotchas:**
- The run timer must reach tools as well as model calls. And because a tool can ignore its signal, the loop has to race tool execution too, not just pass the signal on.
- The submit call isn't a registry tool. It's validated against the agent's *output* schema, but recorded as a `ToolStep` so the audit trail shows every submit attempt, failed ones included.

**Open questions:**
- Do the nudge messages (prose reply, `tool_use_failed`) confuse the 8B model more than they help? Measure it in 2.7.
- Should a forced final step that still fails count as `step_limit` or `invalid_output` in the eval metrics? It's currently `invalid_output` if the submit was invalid, `step_limit` otherwise.

---

## [2026-09-23] 1.2 — executeTool: the trust boundary (1.2 complete)

**Authorship note:** Bhavya asked Claude to write this function, which waives the working agreement for this one piece. We designed rule 2 together (error kind, `args` handling, error message), and Bhavya chose the options. Claude wrote the rest. Bhavya should be able to answer the viva questions below before this counts as understood.

**What we built:** `executeTool` in `lib/agents/registry.ts`. It takes a raw tool call from the model and always returns a `ToolStep`, success or a classified failure, and never throws. All 10 spec tests pass.

**Why this approach:** It's a straight line of early returns, one per failure, in order of "biggest mistake first": wrong tool, then broken JSON, then wrong arguments, then the tool failing, then our own bad output. A small `fail(kind, message)` helper builds every failed step, so the six failure paths can't drift apart in shape. We rejected catching everything in one big `try` block because it would lose *which* thing failed, and that's exactly what the evals need to count.

**How it actually works:**
- *Success and failure kept apart.* `parseJson` returns `{ok: true, value}` or `{ok: false}`, not "the value or the raw string". `'"TCS"'` is valid JSON that parses to the string `"TCS"`, so checking `typeof x === 'string'` would call valid JSON broken.
- *Racing against a timer.* `Promise.race([tool.run(...), timedOut])` returns whichever finishes first. The timer also aborts the signal given to the tool (combined with the run's signal via `AbortSignal.any`), so a well-behaved tool can stop its work. The race is what guarantees we return on time even if the tool ignores the signal. `finally { clearTimeout }` stops the timer from firing later.
- *Sentinel values.* Timeout is signalled by a unique `Symbol`, not a string like `'timeout'`, so no genuine tool result can be mistaken for one.
- *Error messages are written for the model:* what went wrong, plus the valid options. For `invalid_output` (our bug), the message tells the model it isn't at fault, so it doesn't waste steps "fixing" arguments that were correct.

**Gotchas:**
- A tool that ignores its signal still keeps running in the background after we return. The race protects *our* latency, not the server's resources. It's fine for our in-memory tools; a real network or database tool must honour the signal.
- `args` is filled even for an unknown tool (we try parsing anyway), so the audit log always follows rule 9's single rule.

**Viva check (answer these without looking):**
1. Why look up the tool *before* checking the JSON?
2. Why does `Promise.race` still need `clearTimeout` afterwards?
3. What goes wrong if we run the tool with `parsed.value` instead of `input.data`?

**Open questions:** none new.

---

## [2026-09-23] 1.3 — The ReAct loop (1.3 complete)

**Authorship note:** Bhavya asked Claude to write this too. The six design decisions were agreed with Bhavya; the code is Claude's. Bhavya should be able to answer the viva questions below.

**What we built:** `runReactAgent` in `lib/agents/react-loop.ts`: the loop that calls the model, runs the tools it asks for, feeds the results back, and stops on a valid `submit_findings` call, the step limit, the run timeout, or an error. It never throws. 17 tests pass against the fake model. It has **not yet been run against the real Groq API**.

**Why this approach:** One `finish(status, output)` function is the only exit, so every ending clears the timer, sums the token usage, and returns the same `AgentRun` shape. The model call and each tool call race against one run-wide timer. We rejected a separate timeout per await, because separate budgets would add up past the run's limit.

**How it actually works:**
1. Build the registry and the tool list (every tool + `submit_findings`); start with `[system, user]` messages and start the timer.
2. Each step: call the model with `tool_choice: 'required'`. On the last step, force `submit_findings`.
3. Add the model's message to the conversation *unchanged*, then act on it:
   - no tool calls → nudge;
   - a submit → validate it: done, or one repair attempt;
   - otherwise → run each call with `executeTool` and add one `tool` message per call.
4. Out of steps → `step_limit`.

**Gotchas:**
- **Every tool call must be answered.** The OpenAI/Groq format rejects a request if any `tool_call_id` from the previous assistant message has no `tool` reply. So when a turn has an invalid submit *plus* other calls, the skipped calls still get an "ERROR (skipped)" reply. The first spec missed this; a fake model doesn't enforce the rule, so only a test written for it catches it. That test now exists.
- `continue` after a nudge still counts toward `maxSteps`, because the `for` loop's counter advances. That's intended: nudges cost a real model call.
- The `messages` array is mutated in place. That's fine for the real transport, which serialises it immediately, but it's why the fake model copies it on each request.
- Shell tip from this session: a `sed` replacement containing `/` fails with "unknown option to `s'", and `&&` then skips every later command in the chain. Check what actually changed before retrying.

**Viva check:**
1. Name the four ways the loop can end, and the `status` each one produces.
2. Why is `submit_findings` a tool rather than a normal text answer?
3. What would break if we didn't reply to the skipped tool calls?
4. Why force `submit_findings` on the last step, and what's the risk?

**Open questions:**
- First live run against Groq, with the 8B model vs `qwen/qwen3.8-27b`. How often do nudges, repairs and `tool_use_failed` actually happen? (2.7)
- The nudge wording is untested on real models.

---

## [2026-09-23] 1.3 (live) — First run against real models

**What we built:** A live smoke test, `lib/agents/research.live.test.ts`, run with `npm run test:live`; it's excluded from `npm test` and CI. It runs our loop on real COV-20 data with two throwaway tools and three models, and prints each trace plus a grounding check. `AgentRun` gained an `error` field. The trace is saved in `docs/evidence/`.

**Why this approach:** Everything before this was proven only against a fake model. A fake shows the loop handles the behaviours *we imagined*; a real model shows behaviours we didn't. This run found five problems that no offline test could have found.

**What the real models did:**

| Model | Status | Time | Tokens | Notes |
|---|---|---|---|---|
| `llama-3.1-8b-instant` | error | — | — | **404, not available on this key** |
| `qwen/qwen3.8-27b` | ok | 2.8 s | 4.0k + 0.7k | 2 tool calls in one turn; **read future prices**; one number bound to the wrong claim |
| `openai/gpt-oss-20b` | ok | 5.4 s | 2.1k + 0.7k | narrow, sensible windows; one approximation ("near 1150") flagged |

Both working models chose the same tool calls on both runs (temperature 0.2).

**How it actually works (what each finding teaches):**
- **Look-ahead leakage.** qwen asked for minutes 95→375 and reported the closing price, *after* the decision it was explaining. In a replay sim, any tool that can see beyond "now" leaks the outcome, which breaks the premise and makes feedback hindsight-biased. Fix belongs in the tools (2.4): every data tool caps its window at `session.simMinute`. The prompt can't enforce this; the tool can.
- **Grounded ≠ correct (binding errors).** qwen wrote "fell 7.91% vs previous close (from 1182.63 open to 1148.81)". Every number came from a tool, but 7.91% belongs to a different comparison than the two prices beside it (those give −2.86%). A per-number grounding check can't catch that. This is the *text* version of the cross-modal binding failure in the FinVQA-Chart motivation. Structured data removes misreading the chart, **not** mismatching facts. That's an honest limit for the M6 report.
- **Grounded ≠ true.** Both models repeated the "5% lower circuit" headline, which is faithful to our data, which may be historically wrong (AUDIT §1.4 #7). The check measures faithfulness to the tools, not truth.
- **Strict number matching flags approximations.** "near 1150" was flagged though it's a fair rounding of 1149.47–1152.21. The metric needs a tolerance, or the prompt must forbid rounding.
- **Test the checker too.** The first grounding check counted the model's own submitted answer as a source, so it could never fail. We caught it because `[]` for every model looked too good.

**Gotchas:**
- Provider docs go stale: the tool-use page listed `llama-3.1-8b-instant`, but the key can't use it. Check `GET /models` for the key you'll actually deploy with.
- Without `AgentRun.error`, the first failure showed only "error, 0 tokens". Always keep *why* a run failed.
- vitest's `mergeConfig` concatenates arrays, so a "live" config merged from the base inherited the rule excluding live tests. Override the fields instead.

**Open questions:**
- Research model: `gpt-oss-20b` (cheaper prompts, slower, narrower) or `qwen3.8-27b` (faster, broader, leaked the future)? Decide in 2.7 on the eval set, once tools clamp to `simMinute`.
- Should the grounding metric compare numbers with a tolerance, and can binding errors be checked at all without an LLM judge?
- V1 is likely broken in production (P7). Fixing it is your change to make in the ORUS routes.

---

## [2026-09-23] 1.4 — The orchestrator (1.4 complete)

**Authorship note:** Bhavya approved the design (five decisions); Claude wrote the code, as with 1.2 and 1.3.

**What we built:**
- `lib/agents/pipeline.ts`: `runPipeline(claimedEvent, snapshot, deps, budget)` runs Monitor → Research → Coach for one decision event and returns a `PipelineRun` recording the path taken (`full` / `monitor_only` / `template` / `rejected`), all runs, notes and timings.
- `lib/agents/coalesce.ts`: a browser-side helper that allows one pipeline at a time.

There are 15 tests, all with fake agents. ADR-002 records the decisions.

**Why this approach:** The pipeline is plain TypeScript with the agents *passed in*, so its control flow is testable without any LLM, the same dependency-injection idea as the fake model. The fallback ladder was chosen over "fail or retry" because a coaching product that sometimes shows nothing is worse than one that sometimes shows a simpler message.

**How it actually works:**
- *Graceful degradation.* Each rung needs less: `full` needs both agents; `monitor_only` needs only Coach; `template` needs nothing but the deterministic event. The run records which rung it landed on, so you can later *measure* how often each happens: a reliability metric for the report.
- *Re-checking the event.* The browser runs Monitor's rules to decide *when* to call the server. The server runs the same pure rules on its snapshot and uses its own result. Same code, run twice, is cheap insurance, but it's only as trustworthy as the snapshot. With `client_snapshot` it catches bugs and careless tampering, not a consistent liar.
- *Split budget.* Research's cut-off is `deadline − coachReserve`, not "whatever it needs", so a slow Research eats its own time, never Coach's.
- *Coalescing* (latest wins): while busy, a new event replaces any waiting one. Dropped events are still known to Monitor; they just get no AI feedback.

**Gotchas:**
- **Serverless has no shared memory.** Each request may hit a different short-lived instance, so "one pipeline per session" can't be a server variable. It lives in the browser (the one place a session persists), and server-side rate limiting is still needed (8.4).
- **Mutation testing.** Passing tests prove little if they'd also pass on broken code. We broke the pipeline three ways (ladder always `full`, no deadline race, no server re-check); each time 2–3 tests failed. Then we restored the file and checked it was byte-identical.
- Groq can't stream strict structured output, so Coach's feedback arrives whole. The UI needs a waiting state (7.5).

**Viva check:**
1. Walk through what the user sees when Research times out.
2. Why can't coalescing live on the server here?
3. What does the server re-check protect against today, and what doesn't it protect against?

**Open questions:**
- Real Monitor rules (2.1) and the Coach output schema (2.5) replace the fakes.
- Where the pipeline is exposed (an API route) and how the client sends snapshot + event is part of 2.x/3.x wiring.
- Values for `deadlineMs` and `coachReserveMs`: measure in 1.7. The live run suggests Research ~2–5 s.

---

## [2026-09-23] 1.5 — Structured output: constrained decoding + validation (1.5 complete)

**Authorship note:** written by Claude at Bhavya's request (same pattern as 1.2–1.4).

**What we built:**
- `lib/agents/single-shot.ts`: `runSingleShot`, one LLM call with no tools. The output is enforced twice: by Groq's strict `json_schema` mode, then by our Zod check, with one repair attempt.
- `zodToStrictSchema` in `groq-tools.ts`: rejects schemas strict mode can't express.
- `response_format` support in the transport.
- `run-support.ts`: shared deadline and usage helpers, now also used by the loop.

12 new tests; 69 in total. Checked live on two models.

**Why this approach:** Constrained decoding and validation catch *different* failures, so we use both. We rejected "strict mode alone": it doesn't enforce our Zod refinements (e.g. `min(10)` on a string is checked by Zod; whether Groq enforces `minLength` isn't documented) and can't prevent truncation. We rejected "Zod alone": without constraints, a small model's structure errors cost a repair round-trip every time.

**How it actually works:**
- **Constrained decoding.** When generating each token, the provider masks out every token that would make the output break the schema. The model *can't* produce a missing required field or a wrong enum value. Structure is guaranteed; content (is the message sensible? is it long enough?) isn't.
- **Why strict mode needs every field required.** The decoder must know at each point which keys may come next. "Maybe present" fields make that ambiguous, so strict mode bans them. The equivalent is `.nullable()`: the key is always there, and its value may be `null`. `zodToStrictSchema` throws on `.optional()` *when the agent is defined*, naming the field and the fix, instead of every live call failing with a 400.
- **Input vs output view, again.** Tool schemas use Zod's *input* view (what the model sends; defaulted fields are optional). Structured outputs use the *output* view (what we get back; defaulted fields are present). `default` keywords are dropped for strict schemas.
- **Truncation is named.** If `finish_reason` is `length`, the error says the reply was cut off by the token limit, so the audit log points straight at `maxTokens`.

**Live check:** `gpt-oss-20b` answered in 567 ms and `qwen3.8-27b` in 711 ms. Both were valid first time, and Groq accepted `enum`, `nullable`, `minLength` and `maxLength` in strict mode. Evidence is in `docs/evidence/2026-09-23-live-single-shot.txt`. What the answers *said* matters for 2.5:
- gpt-oss advised "consider using a stop-loss", but stop-losses don't execute in the engine (AUDIT §1.4 #1). The Coach would be recommending a broken feature.
- qwen stated unsourced market generalisations ("often locks in the worst price", "wait 5–10 minutes"). The Coach needs a rule: no market facts beyond its inputs.

**Gotchas:**
- vitest hides `console.log` from passing tests unless you use `--reporter=verbose`. One live run was wasted learning that.
- Refactoring the loop onto `run-support.ts` was safe *because* its 17 tests existed: change, run, all green.

**Viva check:**
1. What does constrained decoding guarantee, and what doesn't it?
2. Why does strict mode forbid optional fields, and what do you use instead?
3. Why validate with Zod when the decoder is already constrained?

**Open questions:** none new. The Coach's content rules belong to 2.5.

---

## [2026-09-23] 1.6 + 1.7 — Retries with backoff, and budgets (M1 complete)

**Authorship note:** written by Claude at Bhavya's request.

**What we built:**
- `lib/agents/retry.ts`: `withRetry(caller)` wraps any `ModelCaller` and retries only temporary failures, with exponential backoff and full jitter.
- `lib/agents/budgets.ts`: every time and token limit in one place, derived from the live runs.
- A total-token cap per ReAct run (`maxRunTokens`) and a new run status, `budget_exceeded`.

12 new tests (81 total), including tests that the budgets are consistent with each other.

**Why this approach:**
- *Retry as a decorator* (a function that takes a caller and returns a caller): the transport stays "exactly one call", the runners don't know retries exist, and each piece is tested alone. We rejected putting retries inside the transport, which would mix two jobs, and inside the runners, which would duplicate them.
- *Retry only what waiting can fix.* A 404 (model not found, as in the live run) or a 400 fails identically every time. Retrying just burns the deadline.
- *A separate `budget_exceeded` status* rather than reusing `step_limit`: "too expensive" and "ran out of turns" have different fixes (a bigger budget vs. a better prompt), so evals must tell them apart.

**How it actually works:**
- **Exponential backoff:** wait longer after each failure (250 ms cap, then 500 ms, …, at most 2 s), so a struggling server gets breathing room.
- **Full jitter:** each wait is a *random* amount between 0 and that cap. Without jitter, every client that failed at the same moment retries at the same moment, and the spike repeats (the "thundering herd").
- **Waits are cancellable:** the sleep listens to the run's abort signal, so a run that times out mid-wait stops immediately instead of sleeping on.
- **Why prompt tokens grow:** each ReAct step re-sends the whole conversation so far. Step 3 pays for steps 1 and 2 again, so cost rises faster than the number of steps. `maxRunTokens` caps the total: the first time a run is over, the next call is forced to submit (the same "last chance" as the final step); still over after that → `budget_exceeded`.
- **Budgets as a system:** every number has a stated source (e.g. Research timeout 9 s ≈ 1.7× the slowest observed 5.4 s). Tests enforce the relationships: Research fits inside the pipeline's share, Coach fits inside its reserve, and worst-case backoff still leaves Coach time for a real call.

**Gotchas:**
- The budgets rest on **two live runs per model**. That says nothing about variance or tail latency (the slow 5% of runs). They're provisional until the eval set (2.7) gives proper distributions. Don't quote them in the report as measured performance.
- `withRetry` isn't wired in anywhere yet. It's applied when the real agents are assembled (2.3/2.5): `withRetry(createGroqCaller(...))`.
- gpt-oss is a reasoning model: its hidden reasoning tokens count toward `max_completion_tokens`, hence Coach's larger `maxTokens` (800).

**Viva check:**
1. Why is a 404 never retried, but a 503 is?
2. What problem does jitter solve?
3. Why does the token cost of a ReAct run grow faster than its number of steps?

**Open questions:**
- Real latency distributions (p50/p95) per model: 2.7.
- Groq's rate limits for this key (tokens per minute) aren't known yet. They cap how many decision events per minute the app can afford: 8.4.

---

## [2026-09-23] 3.1 / 3.2 / 3.5 — Event-sourced schema and RLS, tested in a real Postgres

**Authorship note:** design decided by Bhavya (P1 = b phased, six tables, snapshots); SQL and tests written by Claude at Bhavya's request.

**What we built:**
- `supabase/migrations/20260923120000_v2_core.sql`: six tables, RLS policies, and two integrity triggers.
- `frontend/test/supabase-shim.sql`: the minimum of Supabase needed to run the migration in tests.
- `frontend/lib/db/migration.test.ts`: 16 tests running the real migration in PGlite, acting as users A and B, a signed-out visitor, and the server.
- Run statuses, agent names and pipeline paths are now runtime constants, and tests check them against the database's CHECK lists.

ADR-003 records the decisions. The migration has **not** been applied to the real Supabase project yet.

**Why this approach:** Event sourcing fits an engine that's already a reducer. One append-only log gives audit, replay, QA and cross-session analysis, and makes server-side trust possible once the reducer is pure. We tested RLS in a real Postgres rather than trusting it by reading: security rules that were never run are the likeliest thing to be wrong.

**How it actually works:**
- **Row Level Security:** Postgres attaches a condition to every query on a table, per role. `using (...)` filters which rows you can *see or change*; `with check (...)` decides which rows you may *write*. Blocked reads and updates silently match 0 rows; blocked inserts raise an error. Supabase's `service_role` has `BYPASSRLS`, which is why only the server may hold that key.
- **Append-only, in two layers.** RLS gives users no update/delete policy at all. A `BEFORE UPDATE` trigger raises an error for *everyone*, including the service role, which RLS can't restrict.
- **`(select auth.uid())`** in policies, instead of bare `auth.uid()`: Postgres evaluates it once per statement instead of once per row. This is Supabase's documented performance advice.
- **Drift tests.** The allowed values exist twice, in TypeScript (`RUN_STATUSES`) and in SQL (`CHECK (status in ...)`). A test reads the constraint back from the database catalogue (`pg_get_constraintdef`) and compares, so adding a status in one place and forgetting the other fails CI.

**Gotchas:**
- **Triggers run before RLS checks.** A `BEFORE INSERT` trigger fires before the policy's `with check`, and runs *as the calling user*, so RLS also filters what the trigger itself can see. User B, inserting into A's session, got the trigger's "expected seq 0" error, not an RLS error. Still blocked, but by a different rule. The test proves both: seq 1 is stopped by the trigger, and seq 0 (which passes the trigger) is stopped by RLS.
- `user` is a reserved word in Postgres (`set app.user = ...` is a syntax error).
- Mutation-tested: allowing appends to ended sessions, disabling RLS on `agent_runs`, and dropping the no-update trigger each broke exactly one test. The restored file was byte-identical.
- The honest limit: replay stops a client inventing prices, fills or cash, but it still *chooses which actions to send*. Omission is possible, and the contiguity rule catches sync bugs, not malice.
- Shell tip: a very long bash command mixing heredocs and quotes failed to parse ("unexpected EOF"), and nothing ran. Checked, then moved the edit into a script file.

**Viva check:**
1. What's the difference between RLS `using` and `with check`?
2. Why is the no-update rule a trigger and not just "no update policy"?
3. Why store `state_before` when replay could rebuild it?
4. What can a malicious client still do under this design?

**Open questions:**
- Apply the migration to the real project and re-check with real JWTs.
- The server code that writes `AgentRun` / `PipelineRun` rows (3.6), and the client sync of actions (3.3).
- Ethics: consent, retention and deletion policy.

---

## [2026-09-24] 3.6 — Writing the audit trail atomically

**Authorship note:** written by Claude at Bhavya's request.

**What we built:**
- A database function, `record_pipeline_run(p jsonb)` (migration `20260924090000`), that writes a pipeline run's decision event, pipeline run and agent runs in one transaction. Only the server may call it.
- `lib/db/audit.ts`: `toAuditPayload` (pure TypeScript → SQL mapping) and `recordPipelineRun`, which never throws.
- `lib/db/admin.ts`: the service-role Supabase client.
- `test/pglite.ts`: shared test-database setup.
- `AgentRun` gained a `model` field.

8 new tests (105 total); 2 mutation checks.

**Why this approach:** One audit record spans three tables. Three separate API calls can fail halfway and leave an event with no feedback, and supabase-js has no client-side transactions. A Postgres function *is* a transaction: all inserts succeed or none do, in one round trip. We rejected sequential inserts with manual cleanup: more code, and still not safe if the process dies mid-way.

**How it actually works:**
- **Transactions:** a plpgsql function body runs inside the calling transaction. Any error aborts it and rolls back every insert already made. The atomicity test sends one agent run with an invalid status and checks that *no* rows remain, not even the event inserted before it.
- **RPC exposure:** Supabase publishes every `public` function at `/rest/v1/rpc/<name>` and grants `EXECUTE` to everyone by default. Server-only functions must `revoke execute ... from public, anon, authenticated`.
- **Two layers of protection:** the function is `security invoker`, so it runs with the *caller's* rights. Even without the revoke, a signed-in user calling it would hit RLS on the tables inside. The mutation check showed exactly that: removing the revoke changed the error from "permission denied" to "row-level security", and the forgery was still blocked. The revoke is the outer wall; RLS is the inner one.
- **`security definer` was rejected:** it would run with the function *owner's* rights (bypassing RLS for everyone who can call it), turning any grant mistake into a hole.

**Gotchas:**
- **JSON null is not SQL NULL.** `p->'feedback'` for `{"feedback": null}` returns the jsonb value `null`, which `IS NULL` does not match, so the "rejected pipelines have no feedback" CHECK failed. `nullif(p->'feedback', 'null'::jsonb)` converts it. (`->>`, which returns text, gives SQL NULL directly, so `symbol` and `error` were fine.) The mutation check confirmed the test catches this.
- `recordPipelineRun` returns `{ ok, error }` rather than throwing, because losing an audit row is bad but blocking the user's coaching over it is worse. Failed writes are not retried here yet: they must at least be logged by the caller.
- The new migration exists only locally until you apply it to Supabase.

**Viva check:**
1. Why a database function instead of three inserts from TypeScript?
2. What does `security invoker` vs `security definer` change?
3. Why did `{"feedback": null}` break a CHECK constraint?

**Open questions:**
- Where the pipeline API route lives, and how it gets `actionSeq` and `stateBefore` from the client (2.x / 3.3).
- Retrying or queueing failed audit writes (currently: log and move on).

---

## [2026-10-02] 3.4 — Auth hardening: open redirects, a route guard, and an honest demo mode

**Authorship note:** plan approved by Bhavya; code written by Claude at Bhavya's request.

**What we built:**
- `lib/auth/redirect.ts` (`safeNext`), `lib/auth/demo.ts` (demo mode) and `lib/auth/access.ts` (route rules), with 19 tests.
- `proxy.ts`, Next 16's replacement for middleware.
- Fixes in the auth callback, the login and signup pages (8 pasted blocks → 1 helper call each) and `next.config.ts` (`/dashboard` redirect).

Verified by a full `next build`: `ƒ Proxy (Middleware)` appears in the output. ADR-004 records the decisions.

**Why this approach:** One proxy guards every page from one place, where per-page checks would be easy to forget on a new page. The rules are a pure function (`decideAccess`), so they're tested without running Next. We kept the demo fallback rather than deleting it because it had a legitimate purpose (demos when Supabase is unreachable), but it now needs an explicit switch and can't use a real person's typed email.

**How it actually works:**
- **Open redirect:** a login page that redirects to `?next=` is a phishing tool if `next` can point off-site. `https://site.com` + `@evil.com` = `https://site.com@evil.com`, which a browser reads as *user* `site.com` at *host* `evil.com`. Other tricks: `//evil.com` (protocol-relative), `/\evil.com` (browsers treat `\` like `/`), and `/<tab>/evil.com` (browsers strip tabs and newlines, leaving `//`). `safeNext` blocks the known patterns, then does the robust check: resolve the path against a dummy origin and require the origin to be unchanged.
- **Session refresh in the proxy:** Supabase sessions live in cookies that expire and get refreshed. Server components can't set cookies, so the proxy refreshes them on each request and must copy any new cookies onto *both* the request (for this render) and the response, including redirect responses.
- **`getUser()` vs `getSession()`:** `getSession()` just reads the cookie, which the client controls. `getUser()` asks Supabase to verify the token. For an access decision, only the verified one counts.
- **Proxy runtime:** Next 16 runs `proxy.ts` on Node.js *only*. Its build code rejects a `runtime` export there. The old middleware ran on the Edge runtime, which is where `@supabase/ssr` crashed on Vercel.

**Gotchas:**
- **A plain `TypeError` is not a network error.** The old fallback treated any `TypeError` as "offline", but that's also what `undefined.user` throws. A bug in the login code would have logged someone in.
- **Flaky Turbopack builds from Google Fonts.** The first build failed (`next/font/google queries have exactly one entry`) on the Cinzel font URL, which contained `&skey=…`. We didn't assume it was pre-existing: the last commit built clean in a fresh copy, then the same tree passed on retry. So it's transient, depending on what Google Fonts returns, and CI or Vercel can fail at random. Self-hosting fonts removes the dependency (8.1).
- Turbopack refuses a `node_modules` that's a symlink or junction pointing outside the project ("points out of the filesystem root"). The copy needed a real `npm ci`.
- A long bash heredoc was cut off silently. Python then refused the truncated script, so nothing was half-applied. Script files are more reliable for long edits.

**Viva check:**
1. Why is `https://site.com@evil.com` an open redirect?
2. Why does the guard call `getUser()` and not `getSession()`?
3. Why are API routes excluded from the proxy, and what protects them instead?

**Open questions:**
- Verify on Vercel: a signed-out visit to `/ledger` must land on `/login?next=%2Fledger`.
- P8: auth checks inside the ORUS API routes (your code).
- Should `/welcome` and `/onboarding` stay protected? They are, because they come after login.

---

## [2026-10-02] 3.3 — Session sync: a journal inside the reducer, and replay you can trust

**Authorship note:** design approved by Bhavya. All code was written by Claude at Bhavya's request, **including the 3 edits to the engine** (`live-session-context.tsx`: deterministic order ids, exports, journaled reducer) and the 2-line mount in `app/sim/[id]/live/page.tsx`.

**What we built:**
- `lib/session/journal.ts`: `withJournal(reducer)`.
- `replay.ts`.
- `sync.ts`: the in-order upload queue.
- `supabase-transport.ts`.
- `session-sync.tsx`: mounted beside `TraceBridge`.
- `end-session.ts` + `lib/db/sessions.ts` + `app/api/sessions/end/route.ts`.
- `lib/agents/backoff.ts`: shared backoff maths.

Tests: 38 new (161 in total), including a fidelity test that rebuilds 150 random sessions from their journals. ADR-005.

**Why this approach:** Event sourcing only works if replay reproduces what the user saw, and that needs two things: each action applied at the *same minute*, and a reducer that's *pure*. Recording inside the reducer gives the first. Deterministic ids give the second.

**How it actually works:**
- **Where the minute comes from.** React doesn't apply a dispatch immediately: it queues it, and the next render runs the reducer over the queue in order. A component reading `state.currentMinute` sees the last *rendered* state, which can be one tick behind the state the reducer will apply the click to. A wrapper reducer receives the exact state, so its `simMinute` is exact.
- **Replay regenerates time.** TICKs aren't stored. Replay ticks until the clock reaches the next entry's minute, then applies it. It never needs to know the engine's states: if a tick doesn't move the clock (paused, closed) and the next entry is later, the log is inconsistent, and replay throws rather than guessing.
- **Purity is testable.** A property-style test plays 150 seeded random sessions (orders of every type, cancels, pauses, the circuit halt, skipping the halt, early end, the bell) through the journaled reducer, round-trips the journal through JSON as the database would, and replays it. With the old `Date.now()` ids, it fails at seed 1. With deterministic ids, all pass. A second test checks the random sessions actually reach those hard paths, so "all pass" isn't vacuous.
- **The sync queue.** One request in flight at a time. Network errors (no error code) retry forever with capped full-jitter backoff. Any *database* error triggers a resync: ask the server for its last seq. If the server is ahead, a previous batch landed but its response was lost, so adopt the server's position. Otherwise stop as `failed`. An incomplete log is never marked completed.

**Gotchas:**
- **The re-sent batch fails in the trigger, not the primary key.** BEFORE triggers run before constraint checks, so a duplicate batch fails with `P0001 expected seq N`, not `23505 duplicate key`. Code keyed on `23505` would never fire. PGlite test pins it.
- **`next build` caught what tests can't.** `sync.ts` (browser) imported `backoffDelay` from `retry.ts`, which is `server-only`. Vitest stubs `server-only`, so only the real build saw it. Fix: move the pure maths to `backoff.ts`.
- **The Supabase stub client "succeeds".** When Supabase isn't configured, `createClient()` returns a stub whose inserts return no error. Sync is gated on a real signed-in user, which also covers demo mode.
- **StrictMode** re-runs effects but keeps refs, so the sync object lives in a ref, giving one database session per mount. Two `START` entries can appear in dev; replay is unaffected.
- **The service-role route's filters are the access control.** RLS doesn't apply to the service role, so `completeSession` filters by id *and* `user_id` *and* `status = 'active'`, with the user id from `getUser()`, never from the body. Tested.

**Viva check:**
1. Why can wrapping `dispatch` record the wrong minute, when wrapping the reducer can't?
2. Why did the replay test fail with timestamp-based order ids, and which logged action breaks?
3. After a lost response, how does sync know the rows landed?
4. Why does `/api/sessions/end` exist at all, if users can insert rows directly?

**Open questions:**
- Not yet verified against real Supabase.
- Tab closed mid-session: unsent entries are lost and the session stays `active`. Should a server job mark stale sessions `abandoned`? Use `sendBeacon` on unload?
- Resume after refresh needs a heartbeat entry (ticks after the last action are unlogged).
- For P1 (server replay), the reducer must move out of the `'use client'` module.
- The other 5 localStorage keys: keep/move list still owed.

---

## [2026-10-02] 2.1 — Monitor: deterministic rules over a journal, and a dataset that can't panic

**Authorship note:** design approved by Bhavya. Claude wrote the framework, the engine move (at Bhavya's request) and 4 rules: `revenge_trade`, `news_reflex`, `oversized_position`, `overtrading`. **Bhavya writes `averaging_down` and `panic_sell`** (`lib/monitor/rules-bhavya.ts`).

**What we built:**
- `lib/engine/live-reducer.ts`: the engine, moved verbatim (diff-checked against the last commit).
- `lib/engine/cov20-dataset.ts`.
- `replaySteps()`: replay that exposes the state before and after each action.
- `lib/monitor/`: thresholds, the rule context and helpers, rules, and `monitorStep`/`monitorSession`.
- `runPipeline` made generic over Monitor's input.

Tests: 20 Monitor tests (9 of 9 deliberate breaks caught, after one gap was found and fixed), plus the averaging-down spec. ADR-006.

**Why this approach:**
- A decision is judged in context: what you held, what just happened, what you did recently.
- A pure function of the journal runs identically in the browser and on the server, so the server's re-check is a replay, not trust.
- One event per action with a cooldown bounds the LLM cost.

**How it actually works:**
- **Rule context:** each rule gets the order the engine just created, the state *before* it (for "were you underwater?"), the journal so far (for "did you pause?" and "how many orders lately?"), and the engine's own pricing.
- **Realised P&L per sale isn't stored, so it's reconstructed.** `sellResults` replays the engine's average-cost accounting over the fills, in fill order: by minute, then by position in the order list. A test checks it against the engine's `realisedPnL` across 150 random sessions.
- **Priority and cooldown:** a decision usually *is* one thing. A huge BUY right after a loss is revenge first; the size is secondary. The cooldown stops a burst of orders producing a burst of pipelines.
- **Fixtures come from the data.** Tests search COV-20's real price path for a moment that fits (e.g. "a 5-minute loss"), rather than hard-coding prices. If the data changes, the fixture follows, and if no such moment exists, the test says so.

**Gotchas:**
- **COV-20 can't panic.** The steepest 15-minute fall of any stock is 2.08% (INDIGO); the worst fall from any earlier price is 4.61%. A circuit breaker fires at 10:32, but the six stocks are only around 2–4% down. So a 3%-in-15-minutes `panic_sell` never fires. This is the synthetic-data problem from AUDIT TL;DR #2, showing up as a dead rule. Thresholds tuned to this data would be tuned to fiction.
- **Tests collided with real news.** COV-20 has a headline at minute 2, so "5 orders at minutes 1–5" correctly fired `news_reflex` instead of `overtrading`. Fixtures need quiet windows, which only exist after the halt (no news between minutes 193 and 240).
- **A survived mutation found a weak test.** "Judge rejected orders" passed because the rejected order in the test matched no rule anyway. The fix was a rejected order that *would* match (an oversized BUY beyond the cash).
- `'use client'` turns a module's exports into client references on the server, so the reducer had to leave the React context file before the server could replay sessions.
- Long bash heredocs were truncated again; doc scripts now go in scratchpad files.

**Viva check:**
1. Why does Monitor take the journal, not a state snapshot?
2. How do browser and server agree on events without trusting each other?
3. Why can't you tune `panic_sell` on COV-20, and what would you do instead?
4. Why is at most one event per action a cost decision, and what does it lose?

**Open questions:**
- `panic_sell` threshold (decision pending).
- Wiring: a browser hook that runs `monitorStep` as entries arrive and calls the pipeline through the coalescer, plus the pipeline API route (2.3/2.5).
- Should `overtrading` count rejected orders? It does now (attempts).

---

## [2026-10-02] 2.1 — panic_sell: measure before you choose a threshold

**Authorship note:** decision by Bhavya, from options and measurements prepared by Claude. Spec by Claude. The rule itself is Bhavya's to write.

**What we built:**
- The `panic_sell` definition, "on-screen red": `panicDayDropPct: 0.05` vs `prevClose`, plus "still falling" over 15 minutes.
- `prevClose(symbol)` in the rule context.
- A 4-test spec, validated against a scratch reference implementation: it passes all tests, and removing any one condition fails exactly that condition's test.

**Why this approach:** I first recommended a threshold relative to the stock's own moves earlier in the session. Measuring it on COV-20 showed it **fails on opening crashes**: the crash *is* the early history, so it becomes the baseline. It fired on 5 minutes all day (TCS, minutes 40–44), never in the sell-off. COV-20's crash is in the *opening gap* (INDIGO opens −5.2%, RELIANCE −6.8% vs the previous close), and that's exactly what the HUD shows in red. So the chosen rule keys on what the user sees.

**How it actually works:** price now ≤ avg cost × 0.98 (a loss), ≤ prevClose × 0.95 (deep red), and < price 15 minutes ago (still falling).

**Gotchas:**
- **Volatility-relative thresholds assume a stable regime.** On a regime shift (a crash), a baseline from the same window adapts to the shock and stops detecting it. A baseline from *before* the session doesn't, but needs data we don't have yet.
- **"Red and falling" is common on a crash day** (4 of 6 stocks for about half the session). The rule is specific only because the user's own losing sale is required. Say so in the report.
- **Testing the spec:** a negative test ("stays quiet when…") is only useful if *some* wrong implementation fails it. We checked each one by removing exactly its condition.

**Viva check:**
1. Why does a same-session volatility baseline miss an opening crash?
2. What does `panic_sell` detect on a crash day, and what makes it specific?
3. What would the pre-session baseline need, and why is it the upgrade path?

**Open questions:**
- Re-derive with real data (M4.3): σ_daily per stock before each scenario date.

---

## [2026-10-02] 8.1 — Flaky builds: a network fetch hidden inside a font import

**Authorship note:** written by Claude, as planned in 8.1.

**What we built:** `app/layout.tsx` now loads 11 fonts with `next/font/local` from Fontsource npm packages (`@fontsource/*`, `@fontsource-variable/*`), which ship the same Google Fonts files with their licences. Pirata One, Bodoni Moda and Special Elite were removed: nothing referenced their CSS variables.

**Why this approach:** `next/font/google` downloads fonts from Google *at build time*, so every build depended on a third party's HTTP responses. The failure (2 of 4 builds) was a known Turbopack bug: Google sometimes returns font URLs without a file extension, containing `&skey=`, and Turbopack splits the import query at the `&` ("next/font/google queries have exactly one entry", vercel/next.js#99114). Self-hosting removes the network from the build entirely, which is the fix the Next.js issue and other projects converge on.

**How it actually works:**
- `next/font` (local or Google) emits the font files into `.next/static/media` and generates a CSS class that sets a CSS variable (`--font-inter`, …). Our CSS uses those variables, so swapping the loader doesn't change any component.
- Variable fonts are one file per style covering a weight *range* (`weight: '100 900'`). Static fonts need one file per weight.

**Gotchas:**
- The "latin" subset is unchanged, so glyphs outside it (e.g. ₹, U+20B9) fall back to another font, exactly as before.
- Verified: the build output has no Google URLs (the only match was our own comment in a source map), and all 11 CSS variables are defined. A visual check in the browser is still owed.
- npm 11 now reports packages whose install scripts it hasn't approved (sharp, unrs-resolver). These are existing dependencies, already installed; nothing changed.

**Open questions:** none.

---

## [2026-10-02] 2.3/2.4 — Research tools that can't see the future, and what one live run costs

**Authorship note:** design approved by Bhavya. All code written by Claude at Bhavya's request.

**What we built:**
- `lib/agents/research/`:
  - `market-view.ts`: the market capped at the decision minute.
  - `tools.ts`: 5 tools, plus `researchTools(symbols)`.
  - `grounding.ts`.
  - `research.ts`: spec, prompt, `runResearch`.
- `lib/indicators/`.
- `AgentSpec.check` + the `failed_check` error kind.
- A loop fix (a `tool_use_failed` retry doesn't consume a step).
- A live test, and evidence in `docs/evidence/2026-10-02-live-research-agent.txt`.

Tests: 28 new (Research 25, loop 5, indicators 9, minus overlaps), 227 in total.

**Why this approach:** "Don't look ahead" in a prompt is a request. A tool with no way to express "later", reading a view that doesn't contain "later", is a guarantee. The same for numbers: the check rejects any number no tool produced, so "no agent reads numbers off charts" is enforced in code.

**How it actually works:**
- **What's visible at minute m:**
  - The engine shows the close of the current 5-minute bar, so that close is visible.
  - The current bar's high, low and volume describe minutes that haven't happened yet, so they're hidden.
  - Earlier bars are fully visible.
- **Testing a negative property:** you can't test "never looks ahead" by example. So each tool runs twice per case, on the full scenario and on one cut at the decision minute with the unknowable parts *poisoned* (absurd values) rather than removed, and any difference is a leak. This covers 5 tools × 54 minutes × 6 symbols × 3 lookbacks. Two deliberately leaky tools (one peeks at the current bar's high, one reads a bar ahead) are caught, so the test can fail.
- **Wilder's RSI:** seed with simple averages of the first 14 gains and losses, then smooth: avg = (prev × 13 + current) / 14. A hand-computed 3-period case pins the smoothing. A test shows the unsmoothed version gives a different answer, so the test would notice the difference.
- **Grounding with rounding:** a claimed number with d decimals matches a source number that rounds to it at d decimals, ignoring sign. "Fell 2.1%" is grounded by `changePct: -2.08`; "1100" is not grounded by 1143.25.

**Gotchas (mostly from the live runs):**
- **Free-tier limits decide the architecture.** The response headers show 8,000 tokens/minute per model and 1,000 requests/day. A ReAct run re-sends the whole conversation on every step: prompts grew from 1.4k to 1.9k to 2.3k tokens, so 3–4 steps cost 3.5–6.5k tokens. That's about one pipeline per minute, and a run can trip the limit by itself (qwen hit 429 inside one run).
- **gpt-oss fails forced tool calls.** With `tool_choice` naming `submit_findings`, gpt-oss sometimes returns no call, and Groq answers 400 `tool_use_failed`. Our retry then used up the last step → `step_limit` (both gpt-oss runs). The loop is now fixed, but whether gpt-oss *succeeds* on the retry is untested live. One suspicion: `maxTokens` 600 may be eaten by gpt-oss's hidden reasoning.
- **qwen hallucinated a symbol ("TRO") twice;** the error message listing the valid symbols didn't fix it. A schema enum makes it impossible instead.
- **The one ok run was poor research:** the summary was just a copied headline. Grounded isn't the same as useful, which is why the eval set (2.7) has to score quality, not only status.
- **qwen makes parallel tool calls** (3 in one turn), which saves round trips. gpt-oss calls one at a time.
- Test-harness bugs on the way: comparing whole tool steps included `latencyMs`, so everything "leaked". Planted leaky tools sent the wrong arguments, so nothing was caught. Both fixed, and both are why the test-the-test cases exist.
- `vitest run <folder>` also matched the old smoke test, so two live files ran at once and shared one key's per-minute budget.

**Viva check:**
1. Why is "lookback only" stronger than clamping a range to `now`?
2. How does the poisoned-dataset test prove a negative property, and how do you know the test itself works?
3. Why does a ReAct run's token cost grow faster than its step count?
4. What does grounding *not* catch?

**Open questions (decision needed):**
- **Capacity.** Options:
  - (a) **Use separate models per agent:** limits are per model, so Research on one and Coach on another doubles headroom.
  - (b) **Spend fewer tokens:** pre-fetch a standard context bundle in code, so Research makes 1–2 calls instead of 4. This is less agentic, and closer to ADR-001's option A.
  - (c) **Pause the sim on decision events** (the deferred UX question), so events come at human pace.
  - (d) **A paid Groq tier.**
  - Not recommended: multiple free accounts to multiply limits, which likely breaks Groq's terms.
- Whether gpt-oss succeeds on a forced-submit retry; try a larger `maxTokens` or a lower reasoning effort.
- Research output quality: the prompt and a quality rubric in 2.7.

---

## [2026-10-02] 2.5 — Coach: content rules as code, and a fallback that obeys them

**Authorship note:** design approved by Bhavya (capacity: ADR-008). Code written by Claude at Bhavya's request.

**What we built:**
- `lib/agents/coach/coach.ts`:
  - the `CoachFeedback` schema (message, severity, question);
  - the prompt;
  - `checkCoach`;
  - `runCoach`;
  - `coachTemplate`.
- `AgentSpec.check` now also works in the single-shot runner.
- Research moved to `qwen/qwen3.8-27b`.
- Evidence appended to `docs/evidence/2026-10-02-live-research-agent.txt`.

Tests: 21 Coach + 1 runner.

**Why this approach:** The M1 live run produced two rules: Coach must not state market facts it wasn't given, and must not recommend stop-losses (they never execute). A prompt can ask for both; only a check guarantees them. Numbers are the checkable part of "no new facts", so Coach gets the same provenance check as Research: every number must appear in its inputs.

**How it actually works:**
- **`checkCoach`:** a regex for stop-loss vocabulary (stop-loss, stop loss, SL, stop order, trailing stop, with word boundaries so "stop and breathe" and "slowly" pass), plus `ungroundedNumbers` against the rendered input text. Either failure triggers one repair, with the reason sent back.
- **Without research** (the `monitor_only` path), Coach's input says "unavailable", and numbers that only Research had are rejected.
- **The template is held to the same rules.** A test runs `checkCoach` on the template for every event kind, and for every event Monitor emits across 40 random sessions. The safety net can't violate the rules it backs up.

**Gotchas:**
- **The answer key can leak through Monitor.** Research withholds the scenario's signal/noise labels, but Monitor's `news_reflex` facts include `classification`, so Coach (live) told the user the headline "was actually noise". Revealing it *after* the decision may be good teaching, but it's a choice. **Open for Bhavya.**
- Coach is cheap and reliable: about 1k tokens and under 1 s, 2/2 ok live. Research is where the cost and failure live.

**Viva check:**
1. Why is "no new market facts" enforced on numbers specifically?
2. Why must the fallback template pass the same check, and how is that tested?
3. What does ADR-008's model split buy, given Groq's limits are per model?

**Open questions:**
- Keep or hide `classification` in Monitor's facts?
- Wiring: the pipeline API route, plus the browser hook that pauses the sim and shows feedback.

---

## [2026-10-02] 7.1 — Wiring: from a click in the live room to coach feedback

**Authorship note:** design approved by Bhavya (ADR-002/008). Code written by Claude at Bhavya's request, including the 2-line change to the live page.

**What we built:**
- `app/api/pipeline/route.ts` + `lib/agents/pipeline-request.ts` (handler with injected dependencies).
- `lib/session/decision-coach.ts` (browser logic) + `components/live/live-agents.tsx` (React glue and the panel).
- `useSessionSync()`, which replaces the `SessionSync` component so the coach can see the sync's progress.
- `lib/monitor/templates.ts`: client-safe fallback messages.
- `lib/engine/scenarios.ts`: a scenario registry.

Tests: 21 new (268 in total). The build passes, and a local production-server smoke test returned 401 from both routes to an anonymous caller and redirected a signed-out visit to the live sim to login.

**Why this approach:** The server trusts only what it can rebuild. It ignores the client's state and facts: it reads the stored log under the user's own RLS, replays it, re-runs Monitor, and requires the claimed event to reappear *for that action*. The browser runs the same Monitor only to decide *when* to ask.

**How it actually works:**
1. A user action is journaled, and the effect runs `monitorSession` on the journal (a few ms).
2. If there's a new event, the sim pauses (only if it was LIVE; the coach remembers that it paused it), a "reviewing" card shows, and the event goes to the coalescer (one request at a time; the newest waiting event wins).
3. `requestFeedback` waits until the sync has stored that action (`sync.sent() > actionSeq`), POSTs the claim (kind, minute, symbol), and retries 409 "not synced".
4. On the server: auth → session (an RLS read) → actions up to that seq → replay (422 if inconsistent) → `runPipeline` with `detect` limited to events of that action → audit (a failure doesn't block feedback) → response.
5. The panel shows the message, the reflective question and an honest source line ("AI coach · with market research", "… research unavailable", "Standard feedback · …"). "Continue trading" resumes the sim.

**Gotchas:**
- **The coach's own PAUSE is journaled like a user's.** The `PAUSE` action has no "who" field, which is part of your FSM's types. So Monitor's `news_reflex` will read a coach pause after a headline as "the user stopped to think". Minor, but it's a measurement artefact for 5.x, worth knowing. A fix needs an `Action` change (yours).
- **Why the claim includes `actionSeq`:** without it, a client could re-claim an old event at a later action and get fresh LLM feedback for free. The server only accepts events triggered by that exact action.
- **Fetch has no timeout by default.** A stalled request would leave the panel on "reviewing" forever, so the client now aborts after 20 s and shows standard feedback.
- **The pipeline route still works without Groq keys or the service-role key:** the agents fail cleanly → template feedback; the audit fails → `audited: false`.

**Viva check:**
1. What does the server refuse to trust from the client, and how does it get each thing instead?
2. Why does the browser run Monitor at all, if the server re-runs it?
3. What happens, step by step, if Groq is down during a session?

**Open questions:**
- An end-to-end test with a signed-in user on the deployed site.
- Tag coach-initiated pauses (needs an `Action` change in your engine).

---

## [2026-10-03] 2.1 / 1.6 / P7 / P8 / 8.3 — Production fixes after the first live run

**Authorship note:**
- `panicSell` and `averagingDown`: specs and thresholds by Bhavya; implementations by Claude at Bhavya's request.
- V1 route changes (ORUS code): by Claude at Bhavya's request.

**What we built:**
- Groq 429s now record *which* limit was hit and honour Groq's suggested wait.
- CI runs all 275 tests.
- The two remaining Monitor rules.
- The V1 AI routes work again (new models) and require sign-in.
- The README no longer claims real price data or ten scenarios.

**Why this approach:**
- The first production run (2026-10-02) showed Research failing with "All 1 Groq keys returned 429", and nothing more. We couldn't tell a per-minute token limit from a daily cap, because the transport threw away the body and headers.
- Retrying blind after 0.25–2 s just burns a second 429 when Groq has said "wait 3 s".
- **Rejected:** retrying for longer regardless. Research's whole budget is 9 s, so a wait longer than 4 s now fails fast instead of eating the Coach's time.

**How it actually works:**
- **429 path:**
  - On a 429, `model.ts` keeps the error message (e.g. *"…tokens per minute (TPM): Limit 8000, Used 7000, Requested 2400"*) and the wait. The wait comes from `retry-after` (seconds) if present, else from `x-ratelimit-reset-tokens` (a duration like `1m3.5s`).
  - `withRetry` waits exactly that (plus a little jitter) when it's at most `maxRetryAfterMs` (4 s), and otherwise rethrows at once.
  - The message ends up in `agent_runs.error`, so the audit row now explains itself.
- **panic_sell** fires on a SELL of a position that is all three of:
  - ≥2% underwater against its average cost;
  - ≥5% below the previous close (what the HUD shows as red);
  - lower than 15 minutes earlier.

  `lookbackMinutes` is the *actual* window, clamped at minute 0, so the summary's numbers always match the facts. That matters because the Coach's grounding check only allows numbers that appear in the facts.
- **averaging_down** fires on a BUY into a position that is ≥2% underwater.
- **gpt-oss on small budgets:** it's a reasoning model, and hidden reasoning tokens count against `max_tokens`. With a 40-token budget it spent all 40 thinking and returned `""` (`finish_reason: length`). `reasoning_effort: 'low'` + `include_reasoning: false` + 256 tokens of headroom fixes it (31 tokens, a real answer).

**Gotchas:**
- **Rule priority can hide a bug from end-to-end tests.** Mutation testing showed that deleting averaging_down's "BUY only" check survived: the spec's SELL fixture also triggered panic_sell, which outranks averaging_down, so `monitorSession` never showed the bug. Fixed with a test that calls each rule directly. **Lesson:** when a system picks one result by priority, test each candidate in isolation as well.
- **CI ran no tests.** It only linted and built. A broken rule or replay would have deployed green.
- **The V1 routes were silently down** in production since the key changed models. They return HTTP 200 with an error message as the "reply", so nothing alerted.
- **Signed-out visitors lose help chat.** That's the price of protecting the quota (P8). An anonymous, IP-rate-limited chat would need shared state (8.4).

**Viva check:**
1. Why does honouring `retry-after` beat exponential backoff for a 429, and when should you give up instead of waiting?
2. Your panic_sell rule has three conditions. Give a trade that meets two of them and explain why it shouldn't count.
3. Why can a reasoning model return an empty answer, and how do you stop it?

**Open questions:**
- What caused the 2026-10-02 429 at ~3k tokens? The next production run will record the reason.
- Which limit does Groq count, prompt + `max_tokens` or actual usage? This affects the budget design (ADR-008).

---

## [2026-10-03] 2.7 — The eval set, and what it actually showed

**Authorship note:** design and code by Claude, under Bhavya's "complete all modules" instruction (ADR-010). Open to review.

**What we built:**
- `lib/eval/`:
  - 15 fixed cases (`cases.ts`, tested);
  - a 7-check rubric (`rubric.ts`, tested on the real production answer from 2026-10-02);
  - a single-prompt baseline (`baseline.ts`);
  - a token pacer (`pacing.ts`);
  - a report builder (`report.ts`);
  - a live runner (`npm run eval`).
- Two runs are recorded in `docs/evidence/`.

**Why this approach:**
- An examiner's first question about a multi-agent system is "why not one good prompt?". That needs the same cases run through both designs and scored the same way.
- Automatic checks are crude but every point can be explained. An LLM judge would add a second model's errors.

**How it actually works:**
- **Cases:**
  - each case is a scripted journal;
  - the decision under test is its last action;
  - its label is what Monitor's rules say;
  - its "truth" is the stock's real move on the day (for the direction check).
- **The four systems:** A/B/T use Monitor's event. C gets the same raw facts and the pattern definitions, and must detect and coach in one strict-JSON call with the Coach's guardrails.
- **Pacing:** the pacer waits *before* each agent run (never inside a model call, which would turn waiting into false timeouts) until the model's token window has room.

**Gotchas:**
- **My first run was unfair to the baseline.** Its grounding check only accepted numbers from the user message, but its pattern definitions ("2%", "5 orders") were in the system prompt. Two "failures" were the check's fault. Lesson: the evaluator must give each system credit for everything it was given.
- **Strict JSON can fail on the provider's side** (`json_validate_failed`, once because hidden reasoning used up the tokens). It's an HTTP 400 with no output, so the runner gave up. It now counts as a failed attempt and retries, and Coach runs with `reasoning_effort: low`.
- **Groq's real limit on qwen is 7,000 *input* tokens/minute.** We only learnt this because the 429 body is now kept (the 2026-10-03 fix). A ReAct agent re-sends its whole conversation every turn, so input tokens grow roughly with turns². One three-turn run can exceed the per-minute limit by itself.
- **The rubric found a product bug:** templates gave no action. Fixing it makes T's 100% partly circular. Say so.

**Results in one line:** detection 15/15 (pipeline) vs 13/15 (one prompt); rubric 99% / 98% / 89%. Research adds cost but no measurable rubric gain; on the free tier it succeeds about 75% of the time, and the fallback covers the rest.

**Viva check:**
1. What exactly does your eval show the multi-agent design is better at, and what doesn't it show?
2. Why did the baseline score 63% in run 1 and 89% in run 2? What does that say about evaluating your own system?
3. Why does a ReAct loop hit an input-tokens-per-minute limit faster than its total token count suggests?

**Open questions:**
- A human-rated or LLM-judged measure of context quality, to test whether Research helps.
- Repeated runs (variance).
- Cases on the new scenarios.

---

## [2026-10-03] 5.1–5.5 — Scoring: metrics, behaviour, baselines, scorecard, progression, study design

**Authorship note:** by Claude at Bhavya's request. The study protocol (`docs/STUDY.md`) is a proposal for Bhavya to adopt or change.

**What we built:**
- `lib/scoring/`:
  - financial metrics;
  - behaviour metrics;
  - baselines through the real engine;
  - a scorecard computed by the server at session end and stored in `sessions.result`;
  - progression across sessions.
- `/progress` (dashboard) and `/progress/[id]` (audit timeline replay).
- A study mode with a control group.

**How it actually works:**
- **Max drawdown:** the largest fall from a running peak, (peak − equity)/peak. It shows the worst loss you sat through, which the final return hides.
- **Session Sharpe:** mean/std of per-minute equity returns × √n, with a risk-free rate of 0 for a single day. It's undefined when equity never moves. It is **not** annualised, so compare it only between sessions of the same scenario.
- **Hold time:** FIFO lots (each sell closes the oldest buy first), weighted by quantity. The engine itself uses average cost; FIFO is only a reporting convention.
- **Discipline score:** the share of accepted orders with no Monitor event. Deliberately simple.
- **Baselines:** buy-and-hold, a "sell anything 3% under cost" rule, and cash. All run through the same reducer, so fills, prices and the square-off at the bell are identical; only the decisions differ.
- **Replay to the bell:** TICKs aren't logged, so a session that reached the close is replayed with `untilMinute = sessionMinutes`. One ended with END stops where it ended.
- **Progression:** the OLS slope of flagged-orders-per-10 over session number, plus first-half vs second-half means. It's descriptive only.
- **Study mode** (`NEXT_PUBLIC_STUDY_MODE`): a hash of the user id assigns *coached* or *control*. Control users are still scored but see no coach. **Without a control group, improvement could just be practice.**

**Gotchas:**
- A scorecard needs the scenario's own engine. Replaying a TAX-19 log from `initialState()` would silently use COV-20 prices. Hence `engineFor(scenarioId)` everywhere.
- The scorecard is computed from the log read through the **user's** RLS client, so the server can only score the caller's own session, even though the write uses the service role.

**Viva check:**
1. Why is a session Sharpe not comparable to a fund's Sharpe ratio?
2. Why does the thesis claim need a control group, and how is assignment kept stable without a table?
3. Your discipline score is 67. What does that number mean, exactly?

**Open questions:**
- The study itself (participants, consent screen).
- Whether flagged-per-10 is the right primary outcome.

---

## [2026-10-03] M4 — Real daily bars, reconstructed intraday, three new scenarios

**Authorship note:**
- Scenario choice: Bhavya ("Mix").
- Data pipeline, reconstruction, manifests and the engine/UI generalisation: Claude at Bhavya's request.
- Edits to Bhavya's FSM and live UI are marked in the files.

**What we built:**
- `scripts/fetch-scenario-daily.mjs`: real daily bars from Yahoo, with provenance and split un-adjustment.
- `lib/data/scenarios/reconstruct.ts`: a seeded intraday path.
- The manifest format, with TAX-19, ELEC-24 and GME-21.
- The `MarketSpec` and a scenario-aware engine and live UI.
- `/scenarios`, the picker.
- 51 QA tests.

**How it actually works:**
- **Un-adjusting prices:** Yahoo returns prices *adjusted* for later splits (GME 4:1 in 2022, so Yahoo says 86.88). Traders on 27 Jan 2021 saw $347.51. The script multiplies back by every split after the date and records the factor.
- **The intraday path:**
  - anchors at the real open (minute 0), close (last minute), high and low, with seeded times inside hint windows (e.g. after the 10:30 tax announcement);
  - between anchors, a **Brownian bridge**: x_i = a + S_i − (i/n)(S_n − (b − a)). Cumulative noise S, pinned so each segment starts at a and ends at b;
  - folded back inside (low, high), so only the anchors touch the extremes.
- **Co-movement:** each stock's noise is ρ·(the index's move) + √(1−ρ²)·(its own). VIX gets ρ = −0.7.
- **Result:** every daily number is real and the shape is plausible, which the tests check exactly.

**Gotchas:**
- **A gap-down crash opens at its high** (ELEC-24, NIFTY), so the high anchor is minute 0. The reconstruction handles open = high, close = low and similar cases explicitly.
- **The validator flagged KOSS (+480%) as a possible bad print.** It was real. A heuristic validator needs a human decision; we left KOSS out.
- **Free data has no history of 1-minute bars** (Yahoo: last 30 days only). This is the hard limit behind ADR-009.

**Viva check:**
1. Which numbers in TAX-19 are real, and which are reconstructed? How would a user know?
2. Why must the reconstruction be deterministic?
3. Why are split adjustments a trap for historical simulation?

**Open questions:**
- Re-anchoring COV-20.
- Prep rooms for the new scenarios.
- Simulating LULD halts on GME.

---

## [2026-10-03] 2.6 / 8.4 / P9 / 1.3 — Coach history, database rate limits, honest indicators, fewer Research turns

**Authorship note:** by Claude at Bhavya's request. P9 edits Bhavya's prep-room UI, marked in the file.

**What we built:**
- **Coach history and bias taxonomy** (`lib/agents/coach/history.ts`).
- **`consume_quota()`**, a migration plus `lib/db/quota.ts`, wired into `/api/pipeline` and all 7 ORUS routes.
- **Wilder ADX** in `lib/indicators`. The prep room now uses it and Wilder RSI, showing "—" instead of invented values.
- **A Research prompt change:** all tool calls in one turn, measured by `npm run eval:research`.

**How it actually works:**
- **Atomic quota:** `pg_advisory_xact_lock(hash(user:bucket))` serialises concurrent requests from one user, so two parallel calls can't both see "one left". The lock is released when the transaction ends.
- **Why `security definer` is safe here:** the function uses `auth.uid()` (the caller), never a user id passed in. So it can only spend the caller's own quota, while still writing a table the caller can't touch directly.
- **Fail open vs fail closed:** for a *cost* guard, failing open (allow when the check breaks) keeps the product up. For an *access* guard (auth), you fail closed.
- **Wilder ADX:**
  - smooth TR, +DM and −DM (seed = the sum of 14, then S − S/14 + x);
  - DI = 100·DM/TR, DX = 100·|DI+ − DI−|/(DI+ + DI−);
  - ADX = the mean of the first 14 DX values, then smoothed.
  - It needs 28 bars; with fewer it returns null. The old version averaged unsmoothed DX and fell back to `20 + Math.random()·10`.

**Gotchas:**
- **Test the rule in isolation, not only through priority** (again): the history counts use Monitor's events, which are one per action by priority.
- **CRLF line endings broke a scripted edit:** the repo has mixed line endings. Direct edits avoid it.

**Viva check:**
1. Why can't an in-memory rate limiter work on Vercel?
2. What stops a user calling `consume_quota` to burn someone else's quota?
3. Why did the "tools" for the Coach become inputs?

**Open questions:** global (all-users) per-minute budgeting.

---

## [2026-10-03] 1.3 — A prompt "fix" that made things worse (reverted)

**What happened:** to stay under Groq's 7k input-tokens/min, I changed Research's prompt to "request every tool in ONE turn, then submit". **Measured** on the 12 eval cases (`npm run eval:research`, `docs/evidence/research-turns-2026-10-03.md`): **5/12 ok, against 9/12 before.**
- 3 runs: qwen attempted larger parallel calls and Groq rejected them as malformed (`tool_use_failed`).
- 4 runs: hit a 429 at the start. The rejected calls had still used input tokens, and the pacer only counts tokens from *successful* calls, so it under-estimated the window.

**Decision:** reverted to "at most 3 tool calls, then submit".

**Lessons:**
- A plausible prompt change is a hypothesis. Measure it on the same cases before keeping it.
- Failed provider calls still cost quota. A pacer or budget that only counts successes undercounts.

**Viva check:** why is reporting a reverted change worth a line in the thesis?

---

## [2026-10-03] P7 follow-up — ORUS help chat: raw markdown and an out-of-date product map

**What happened:** in production, ORUS answered "how to use this" with literal `**` markers and a V1 tour: only COV-20, "3 retrieval-style coaching prompts", and no `/scenarios`, `/progress` or live coach.

**Two causes:**
- **The prompt said "plain text only", but gpt-oss writes markdown anyway,** and the widget printed text raw (`white-space: pre-wrap`). A prompt instruction about format is a request, not a guarantee, so the renderer should accept what the model actually produces.
- **The system prompt hard-codes the product map,** so it went stale when V2 added routes. No test catches this.

**Fix:**
- The widget renders a safe markdown subset with `react-markdown`: bold, lists, inline code and links; headings are unwrapped and raw HTML is never rendered.
- The prompt now describes V2 (4 scenarios, the coach pipeline, `/progress`) and says "never invent pages".

**Lesson:** a hard-coded description of the app is documentation, and it rots the same way docs do. Update it whenever a route is added.
