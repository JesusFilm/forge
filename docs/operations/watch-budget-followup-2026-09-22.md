# Watch budget follow-up — September 22, 2026

## Decision

Do not add a workflow-history index as a selection-timeout fix. The initial
three-reader reproduction did not delay independently committed budgets. A later
production-volume comparison below raises budget p95 to 38 ms and reaches
407 ms, but does not reproduce a 700 ms timeout. No further application correction
is established by this investigation, and no whole ticket is closed. The deployed contextual
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

The connector lists dashboard creation, but a direct attempt to validate the
five prepared widgets is rejected by Datadog: **MCP write operations are disabled
for the organization**. The dashboard and feat-464-tagged monitor searches
return no matching installation. No dashboard write was attempted after that
explicit policy rejection. This is an organization-level connector restriction,
not a missing Railway token and not a prerequisite for database diagnosis.

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

## Internal storage investigation

The owner directed this investigation to remain internal. No provider contact
was made or is scheduled. The unresolved storage question is specific: correlate
PostgreSQL volume flush
completion, queueing and throttling with September 21 **23:15:38 and 23:18:44
UTC**, when naturally slow budget calls matched WAL waits and volume I/O
pressure. Separately inspect **23:23:27**, when 1,708/406/677 ms calls had no
concurrent wait capture; do not label their cause as established. These
observations do not justify changing volume quotas or availability topology.
Database reads verify `data_directory=/var/lib/postgresql/data/pgdata` and
`wal_sync_method=fdatasync`. The current observations do not establish a wrong
data mount, CPU quota exhaustion or a large competing writer. This prepared
investigation has not been sent to the provider.

## Internal continuation: workload volume and reconciled outcomes

The continuation branch `codex/watch-budget-internal-verification-20260922-r4m`
starts from freshly fetched `a57725066d41d50b554657f0f2befdffa935c7a8`, the normal
merge of PR #2380. Its automatic Roadmap deployment was independently verified
at 04:41:56 UTC. Admin/worker remain `c98ec86b…` and Web `1cccac03…`; the evidence
merge does not constitute another API release.

A 30-second statistics comparison, 04:37:36–04:38:06 UTC, reads PostgreSQL's
relation counters twice without scanning application tables. The two reads take
16.1 and 10.8 ms. Workflow events account for 13,075,075 index-fetched tuples and
641,814 heap/index blocks read, the largest relation total in this sample.
`mux_video` and `video_dub` follow at 132,774 and 120,103 blocks. PostgreSQL block
reads can be served by the operating-system cache; these are not physical volume
bytes or proof of a particular blocked commit. `pg_stat_statements` is absent.

That measured volume exceeds the original fixture's 3.84 million returned
history rows per loaded phase. Four separate reader processes, with three
readers each, return **12.8 million rows** in the new 30-second phase. The actual
Admin budget service still uses ten connections. Budget p95 rises from
**3.82 ms idle to 38.05 ms loaded**, then returns to **3.56 ms idle**. Maximum
latencies are 89.10, **407.27**, and 61.54 ms respectively. The 407 ms call records
function time rounding to zero. All 1,954 attempts commit correctly; a separate
before/after comparison finds zero mismatches across 4,000 rows. No call reaches
700 ms. This supports workload amplification at the tested volume, while the
provider storage and historical timeout remain unproven. It does not justify
the previously rejected index or weaken the budget contract.

A three-minute repetition returns 73.8 million history rows. Budget p95 is
37.71 ms under load versus 3.58/3.30 ms in the surrounding idle phases; its
maximum is 235.05 ms. All 4,100 attempts persist exactly, with zero calls at
700 ms. A local ten-millisecond observer samples both data reads and WAL waits,
but misses the two longest calls. Its 14,690 query round trips accumulate 49.7
seconds of elapsed time and peak at 414 ms; this is neither CPU overhead nor an
unintrusive production diagnostic. The earlier unobserved phase supplies the
independent load comparison. These results distinguish workload amplification
from a reproduced selection failure and do not isolate the longest remainders.
The owned database is stopped; a production cleanup probe at 04:48:50 reports
zero remaining task observers. No temporary production setting was changed.

The fixed **02:34–04:34 UTC** window supplies a complete later transport cohort.
Datadog HTTP metrics and Railway's primary outcome logs reconcile every delivery,
selection, playback and initial-evidence status group. Four half-hour log reads
return fewer than 5,000 entries each and are filtered to disjoint half-open
intervals. Railway supplies the events absent from Datadog: one served-six
delivery, six accepted fact batches, one context, one claim, and six initial
successes. No request is excluded, and no missing envelope is inferred from
HTTP 200 or a database row.

| POST endpoint    |   200 | 400 | 401 |   403 | 5xx | Total |
| ---------------- | ----: | --: | --: | ----: | --: | ----: |
| Seeded delivery  |   813 |   0 |   0 |   511 |   0 | 1,324 |
| Selection        |    17 |   0 |   0 |     0 |   0 |    17 |
| Playback         | 6,489 |   5 |   8 |   683 |   0 | 7,185 |
| Initial evidence | 2,101 |  27 |   0 |   886 |   0 | 3,014 |
| Profile          | 1,461 |   0 |   0 | 1,352 |   0 | 2,813 |

Delivery contains **651 served responses and 162 coverage/admission fallbacks**,
with **zero `delivery_timeout` and zero `retrieval_timeout`**. PostgreSQL stores
809 requests: 651 served, 115 empty/no-candidates, 32 seed-unavailable fallbacks,
and eleven empty/seed-unavailable. The remaining four HTTP 200s are pre-Admin
admission fallbacks, three session-hour and one cooldown. Initial-evidence
successes reconcile to 1,871 render and 230 impression audits; selection
successes reconcile to seventeen committed selection audits. Profile HTTP counts
are reported without claiming a profile-envelope reconciliation.

All 1,208 recognized-crawler observations are 403s, with no recognized-crawler
success. All 32 observed 400s have terminal `invalid_request` disposition. Known
receipt-collision/exhausted-transaction log indicators return zero matches.
There is no `invalid_binding` response in this window, so it does not expand the
bounded real-browser non-retry proof above. Eighteen stored timestamp rejections
remain distinct from transport timeouts and the previously repaired receipt race.
The episode cohort's 7,809 assigned facts and 124 transport replays are as-of
counters, not counts of HTTP batches in the window.

At 04:43 UTC, the current scheduler has 24 completed batches and 24 heartbeats,
39 classification attempts, eleven affected pointers and eleven queued rebuilds,
with zero classification, dispatch, exhaustion or step errors. The queue snapshot
has two pending runs with no expired lease. The subsequent authenticated Admin
refresh shows zero affected pointers, zero ineligible contributions and zero
backlog; its broader historical terminal-run count is 118 and its overall label
remains degraded. No overall-green claim is made.

Credit the complete later HTTP/outcome cohort, delivery/initial/selection durable
reconciliation and fresh current-pointer audit. They do not erase older failures,
prove the historical selection cause, install the missing monitoring, or supply
the independent operational last-known-good fallback. No whole ticket closes.
