# 5.4 Study design: does the coach reduce behavioural mistakes?

**Status:** the protocol, the consent flow and the analysis are ready (2026-11-04); the study itself needs participants (your task). Written 2026-10-03.

## Running it, step by step

1. In Vercel, set `NEXT_PUBLIC_STUDY_MODE=true` and redeploy.
2. Send participants the link. Each signs in (Google), sees the information sheet before their first session, and answers. Only people who agree are randomised; everyone else plays with the coach on and is never counted.
3. Ask each participant for **at least 4 sessions**, on different days if possible, rotating scenarios.
4. Export the data with the query in **Data export** below (Supabase → SQL editor → Download CSV). Keep the CSV out of git: it holds user ids.
5. Run `STUDY_CSV=~/Downloads/study.csv npm run study` in `frontend/`. It writes `docs/evidence/study-<date>.md`: sample sizes, medians, the Mann–Whitney test, effect sizes and a per-participant table (numbered, no ids).
6. Turn study mode off afterwards if you want everyone coached again.
**Thesis claim:** *users who receive in-the-moment agent feedback make fewer behavioural mistakes over repeated sessions than users who don't.*

## Why a control group is needed

Fewer mistakes in session 5 than in session 1 doesn't show the coach worked. People also improve through **practice** and by **learning the scenario**: after one run they know COV-20 crashes. Only a comparison between two groups with the same practice, coached and not coached, isolates the coach's effect.

## Design

- **Between-subjects, two arms, randomised by user id.** `lib/study/condition.ts` hashes each user id (FNV-1a) to *coached* or *control*. The same person always lands in the same group, on any device.
  - **Coached:** today's product. Monitor → pause → feedback panel.
  - **Control:** the same sim. Monitor still detects every pattern (so the scorecard measures both groups identically), but **no panel and no pause**.
- **Switch:** set `NEXT_PUBLIC_STUDY_MODE=true` in Vercel and redeploy. When it's off, everyone is coached.
- **Each participant:** at least **4 sessions** of the available scenarios, ideally on different days. Rotate scenarios (once M4 adds them) so improvement isn't just memorising one day.

## Measures (all computed by the server by replay; `sessions.result`)

| Measure | Role | Where |
|---|---|---|
| Flagged orders per 10 orders | **Primary outcome** (mistake rate) | `behaviour.flaggedPer10` |
| Discipline score (0–100) | Secondary | `behaviour.disciplineScore` |
| Events by pattern | Secondary: which mistakes change | `behaviour.events` |
| Return vs buy-and-hold, max drawdown | Secondary: did the trading improve, or just the behaviour? | `financial`, `vsBuyAndHoldPts` |
| Study group | Grouping | `condition` |

## Hypotheses

- **H1:** the coached group's mistake rate falls more across sessions than the control group's. Specifically, the coached group's within-person slope of `flaggedPer10` over session number is more negative.
- **H0:** no difference in slopes.

## Analysis plan (fixed before collecting data)

1. **Per participant:** compute the OLS slope of `flaggedPer10` over session number. Skip sessions with no orders. This is `olsSlope` in `lib/scoring/progression.ts`.
2. **Compare slopes between groups.** Use a **Mann–Whitney U test** (no normality assumption, suits small samples), one-sided for H1, α = 0.05. Report the **effect size** (rank-biserial correlation) and the medians of both groups.
3. **If the sample allows** (≥ 15 per group), fit a mixed model as a robustness check: `flaggedPer10 ~ session × condition + (1 | user)`.
4. **Report everything,** including null results and how many people dropped out.

**Rough power:** detecting a medium effect (d ≈ 0.5) at 80% power needs about 50 people per group. That's unlikely for a student project. **Plan for a pilot** (e.g. 10–20 people per group) and state in the thesis that it is underpowered: the result is an effect-size estimate plus a feasibility demonstration, not a confirmed effect.

## Data export

Run in the Supabase SQL editor (it runs as the database owner, so it can read `auth.users`), never in the browser. One row per completed session of a **consenting participant**: the join drops anyone who declined or **withdrew**, including their earlier sessions.

```sql
select s.user_id, s.id as session_id, s.ended_at, s.scenario_id,
       s.result->>'condition'                          as condition,
       (s.result->'behaviour'->>'flaggedPer10')::float  as flagged_per_10,
       (s.result->'behaviour'->>'disciplineScore')::int as discipline,
       (s.result->'financial'->>'returnPct')::float     as return_pct,
       (s.result->>'vsBuyAndHoldPts')::float            as vs_bh_pts
from public.sessions s
join auth.users u on u.id = s.user_id
where s.status = 'completed'
  and s.result ? 'condition'
  and u.raw_user_meta_data->'study_consent'->>'status'  = 'given'
  and u.raw_user_meta_data->'study_consent'->>'version' = '2026-11'
order by s.user_id, s.ended_at;
```

`npm run study` expects exactly these column names.

## Threats to validity (write these up)

- **Small sample.** See the power note above.
- **Labels are our definitions** (ADR-006 thresholds). A pattern Monitor doesn't define can't be counted.
- **Contamination.** Participants who know each other may share tips across groups.
- **Synthetic intraday prices** (ADR-009) limit how far results generalise to real markets.
- **Scenario learning.** Repeating the same scenario rewards memory. Rotate scenarios and note which ones each participant played.
- **The coach pause itself** may help, separately from the feedback text: the coached group gets thinking time. If time allows, a third arm with *pause only, no text* would separate the two effects.

## Ethics

- **Consent before data** (built 2026-11-04, `lib/study/consent.ts`, `components/study/consent.tsx`). In study mode the live room shows an information sheet before the first session: purpose, what participants do, the two groups, what data is used, no real money, and the right to withdraw. The answer is stored in the user's own `user_metadata.study_consent` with the sheet's version (`CONSENT_VERSION`); changing the sheet means bumping the version, and everyone is asked again.
- **Declining costs nothing:** non-participants are always coached and their sessions carry no condition.
- **Withdrawal:** a button on `/progress`. The export filters on current consent, so a withdrawal removes all of that person's sessions from the analysis. To delete their data entirely, delete the user in Supabase Auth (`on delete cascade` removes their rows).
- **Anonymity:** no names or emails in exports, only Supabase user ids; the report numbers participants P1, P2, …
- **Check your university's rules.** Some require ethics-board approval even for a low-risk pilot with classmates.
