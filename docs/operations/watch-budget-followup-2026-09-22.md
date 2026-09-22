# Watch budget follow-up — September 22, 2026

## Decision

Do not add a workflow-history index as a selection-timeout fix. The owned
reproduction made history reads slow without making independently committed
selection-budget writes slow. No further application correction is established
by this investigation, and no whole ticket is closed. The deployed contextual
distance correction remains valid under its [original release evidence](watch-contextual-distance-release-2026-09-22.md).

This follow-up uses branch `codex/watch-workflow-history-20260922-r4m`, based on
freshly fetched main `0f7bbe19586df2456942ce929b62a8cef5792377`, in the task-owned
worktree. It changes evidence and learnings only. No direct production database
mutation, service-setting change, homepage edit or LaunchDarkly change was made.
The [aggregate artifact](../validation/watch-budget-followup-20260922/results.json)
excludes viewer, session, episode, capability and event lookup values.
At 04:15:49 UTC, independent runtime reads again verified Admin and worker at
`c98ec86bdd9a308f33b53d035084e8fd10e0e08d` with health 200 and their false/true
runner roles, and Web at `1cccac03cec7ad4427d0c6f80443dd4d71b942e0` with anonymous
homepage availability `enabled:false`.

## Workload hypothesis and falsification

Production has approximately 3.85 million workflow events. Its long-lived
reconciliation scheduler has 32,330 events, and finalization recovery has at
least 50,001. The pinned PostgreSQL workflow adapter fetches and decodes the
entire run history on replay. Bounded production samples caught history reads
approaching one second, alongside slower inventory and projection queries.
That suggests a testable competing-workload hypothesis; it does not attribute
selection latency to those reads.

The owned PostgreSQL 18 fixture contains 3,845,000 synthetic events, including
64,000 finalization events and 32,000 reconciliation events, plus 4,000 valid
recommendation requests, served items and independently durable budgets. Three
history readers run in a separate Node process. The actual Admin budget service
uses Prisma's PostgreSQL adapter with its ten-connection pool and submits one
attempt about every 40 ms. Each phase lasts 30 seconds.

| Phase                             | History reads | History p95 / max | Budget calls | Budget p95 / max | Budget calls >=700 ms |
| --------------------------------- | ------------: | ----------------: | -----------: | ---------------: | --------------------: |
| Idle                              |             0 |                 — |          656 | 6.58 / 104.07 ms |                     0 |
| Three history readers             |            60 |  1,325 / 1,376 ms |          687 |  5.81 / 95.80 ms |                     0 |
| Readers plus `(run_id, id)` index |            60 |  1,287 / 1,418 ms |          683 |  5.99 / 67.79 ms |                     0 |

All 2,026 budget calls succeeded. A separate database check verified all 4,000
rows against the exact expected per-row attempt counts: 10,026 total attempts,
zero mismatches. The index exists only in the owned fixture. It did not improve
full-history latency meaningfully and is not proposed for production. This
fixture does not reproduce Railway storage; the result rejects this tested
workload as a demonstrated cause, not every possible workload interaction.

## Database execution, waits and scheduling

Four bounded read-only activity captures completed between 03:32 and 04:05 UTC.
Their statement and lock limits were 1.5 seconds and 100 ms, with automatic
overhead stops. No sampled row/advisory blocker was found. Slow workflow,
inventory and projection queries still occurred. The 04:03:26–04:05:26 capture
included ordinary browser selections: its sampled delivery-budget statement
was 0.209 ms old and running, while another sampled query reached 1,965 ms.
This does not measure every native pool acquisition or explain historical
selection failures.

The independent 03:50:31–03:52:31 database-volume capture completed 1,199 samples
and used 269 ms of sampling work in total, at most 0.54 ms per sample. The volume
completed about 54 MB of reads and 254 MB of writes. At 03:52:12, I/O pressure
continued across intervals with no newly completed I/O; one interval records
100 ms of full I/O pressure. No slow completed budget event was retained in the
overlapping interval, so this cannot be attributed to a budget request.
An autovacuum backend sampled in `WalSync` was 1,215 ms old; that is query age,
not measured WAL-wait duration.

A later resource snapshot reports a 24-CPU quota, a 24 GB memory limit, no CPU
throttling periods and no memory-limit/OOM events. The volume limits remain
70 MB/s and 3,000 IOPS in each direction. Configured limits alone do not prove
throttling. PostgreSQL I/O timing is disabled; zero timing counters are unknown,
not evidence of fast storage. The [previous matched WAL observations](watch-runtime-release-verification-2026-09-22.md#independent-budgetcommit-investigation)
remain the stronger evidence for specific 212–312 ms commit-path delays. Neither
those observations nor this workload test explains the historical 701 ms call
or proves the underlying storage cause. Provider-side storage scheduling and
flush latency are the next missing measurements; changing durability, pools or
deadlines would not answer that question.

## Two-hour production outcomes

The fixed September 22 **01:39–03:39 UTC** metric window uses scalar sum of
`trace.web.request.hits`, grouped by endpoint, status and revision. An explicit
ten-second rollup returns the same totals. No traffic is excluded.

| POST endpoint    |   200 |   403 |    Other HTTP errors | Total |
| ---------------- | ----: | ----: | -------------------: | ----: |
| Seeded delivery  |   868 |   562 |                1×503 | 1,431 |
| Selection        |    11 |     0 |                    0 |    11 |
| Playback         | 5,746 |   689 | 5×401, 4×400, 19×503 | 6,463 |
| Initial evidence | 2,163 | 1,280 |               12×400 | 3,455 |
| Profile          | 1,503 | 1,390 |                1×503 | 2,894 |
| For you delivery |     1 |     0 |                    0 |     1 |

Playback 5xx is **19 / 6,463 = 0.294%**, meeting the numeric acceptance threshold
for this window. The nineteen failures remain the recorded Redis-update burst;
the wider window does not erase the 1.093% rate in its earlier forty-minute
subset or prove general recovery.

Independent delivery logs contain **1,430** seeded outcomes: 707 served HTTP
200s, 159 coverage/admission fallbacks, one empty 200, 562 rejected 403s and one
`admission_unavailable` 503. There are zero observed `delivery_timeout` or
`retrieval_timeout` envelopes. **One HTTP 200 is not reconciled by those logs**;
do not classify its envelope from its HTTP status or a committed database row.
Playback and initial-evidence 200 logs are respectively eight and six below
their metric counts. Boundary checks did not fully reconcile these differences.
All sixteen observed 400 logs are terminal `invalid_request`, not timeouts.
All 1,590 recognized-crawler evidence/playback observations are rejected 403s;
no recognized-crawler success is present in the captured logs. Unrecognized
automation and unobserved provenance remain outside that claim.

The same fixed window has 865 persisted requests, 864 candidate runs, 403 newly
created episodes, and eleven committed selections. The episode cohort has 6,521
assigned fact sequences and zero conflicts at the 04:08 snapshot. Those episode
counters may include facts arriving after the window; they are not HTTP receipt
counts. Recent pending/claimed projection work is empty. The fresh authenticated
Admin page at approximately 04:09 has zero affected pointers, zero ineligible
contributions and zero rebuild backlog. Its degraded label still includes 117
terminal runs in the page's broader window; do not report that as overall green.

The current durable reconciliation scheduler has **23 completed batches and 23
heartbeats** within the two-hour window. Decoded outputs have zero classification
failures, exhausted attempts or dispatch failures. The first broader diagnostic
query hit its 1.5-second statement limit; an explain-checked query restricted to
the running scheduler succeeded. Completed-step evidence does not establish
absence of unfinished work across every historical scheduler run.

## Actual browser terminal-response evidence

A retained real Chrome view on September 20, Web revision
`964c1e3cde7ecd2ea1f3253817770527213ac11f`, contains seven resource events, matching
the final view's reported resource count of seven. Its playback fetch returns
HTTP 409 at 05:47:57.983 UTC in 283.3 ms. Another Mux telemetry fetch starts at
05:48:08.817. No further playback resource occurs in that view: the captured
network activity extends **10.55 seconds after the 409 completed**.

This supplies a real browser non-retry example. It is not a newly forced error,
continuous-foreground proof or complete population audit. The retained response
does not expose its body or claim/facts action, and no matching server trace/log
was retained. The playback recorder and definitive-response mapper are unchanged
between that revision and deployed Web `1cccac03…`; the observability helper
change only extracts network error codes. The mapper's 409 binding response and
terminal handling are consistent with the observed behavior, but the domain
reason is inferred from code, not independently observed in this response.

Six additional ordinary recommendation clicks during this continuation reached
their selected Watch pages. This is navigation evidence only; no per-click
acknowledgment bodies were captured. It does not establish timeout recovery.

## Ticket consequences

- **feat-496:** keep in progress. The tested competing workload does not explain
  the selection stall; storage/commit and native-pool attribution remain open,
  as does the separate delivery-persistence timeout.
- **feat-464:** the latest numeric two-hour playback threshold and fresh Admin
  audit pass. Credit the bounded real-browser non-retry example without claiming
  an action/body match. Installed alerts/dashboard, full outcome reconciliation
  and remaining production transport proof are still required.
- **feat-459:** its authorized audit and exact repair trace retain credit. Its
  feat-464 dependency still prevents completion.
- **feat-447:** its matching qualified-feedback/hybrid Admin trace retains
  credit. Independent operational last-known-good fallback evidence and the
  feat-459 dependency remain open. No fake fallback or privileged identity was
  created to satisfy acceptance.

All diagnostic connections close in `finally`; the cleanup probe reports zero
remaining task observers. No temporary production settings need restoration.
The authored English homepage block remains behind the default-off flag, per
the owner's latest instruction. No local code was directly deployed.
