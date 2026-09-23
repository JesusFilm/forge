# Watch database wait correlation — September 23, 2026

## Purpose and limit

Continue feat-496 after PR #2388. The September 22 23:28:54 UTC delivery
failure spent 1,186 ms in a 220-row candidate-evidence INSERT's driver span.
Transaction acquisition was about 6 ms. That identifies the delayed boundary;
it does not separate PostgreSQL execution/locks/storage from network and Admin
result processing. The separate selection capability-budget failure remains
unproven. This diagnostic change is not a timeout fix or a closure claim.

Plan: `docs/plans/2026-09-23-watch-database-wait-correlation.md`.

## Correlation and bounded collection

`recommendation.runtime` now includes a random `observationId` and at most
eight `{ordinal, backendPid}` transaction entries. Late-operation records retain
the same observation ID. Missing PID means unavailable, not zero wait. Excess
transactions are counted as `omittedTransactions`.

The existing delivery transaction setup SELECT returns `pg_backend_pid()` and
sets transaction-local `application_name` to `watch:<observationId>:<ordinal>`.
There is no additional database round trip or application pool. PostgreSQL
restores the previous name on commit and rollback. The tag contains no viewer,
capability, content or durable ledger identity. Retrieval and standalone
selection-budget calls do not use this delivery transaction helper and are not
covered by this tag.

Run the observer from a separate OS process with existing authorized database
access, after checking ownership and confirming no other observer is active:

```sh
pnpm --filter @forge/admin exec tsx src/scripts/sample-recommendation-db-waits.ts 120000 250
```

Arguments are duration and polling interval in milliseconds. The process uses
the configured `DATABASE_URL` without logging it. It opens one disposable
read-only connection named `watch-wait-observer`; session settings disappear
when it closes. It never changes persistent logging or database settings.

Limits: 1–900 seconds duration, 100–5,000 ms interval, 3-second connection
timeout, 750 ms statement timeout, 50 ms lock timeout, 32 tagged backends,
5,000 emitted samples. Stop after a poll exceeding 100 ms or cumulative poll
wall time exceeding the smaller of 15 seconds and 2.5% of requested duration.
SIGINT/SIGTERM abort sampling and close the connection. These are elapsed query
wall-time limits, not measurements of database CPU utilization.

Save stdout privately and inspect the final
`recommendation.database_wait_summary`. Its stop reason, requested window,
actual start/end, polls, samples and query overhead determine collection
coverage. An `overhead`, `error`, output or backend limit means incomplete
coverage. Do not silently restart indefinitely or report that as a clean window.

The observer emits only correlation, state, wait category/event, query start,
state change, query age, blocker count and a fixed statement category. SQL text
is classified inside PostgreSQL and never returned; parameters, credentials and
identities are absent. No Datadog write permission is needed. Structured Admin
events can be read with `service:forge-admin @event:recommendation.runtime`.

## Interpret a natural failure

Join the runtime observation ID and ordinal to the sampler, check backend PID,
then group samples by `queryStartedAt`. Reconcile that interval with the driver
span and late settlement. Database timestamps and query age provide context;
do not subtract clocks from different machines as exact durations.

| Matched observation                                      | Supported conclusion                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active INSERT, `Lock`, blockers present                  | PostgreSQL was blocked at those samples; investigate the blocker and lock owner.                                                                     |
| Active INSERT, `IO`/WAL event                            | PostgreSQL was waiting on that I/O event at those samples; this alone does not explain the storage device's cause.                                   |
| Active INSERT, no wait event                             | The statement was active; samples do not distinguish CPU execution from all unsampled waits.                                                         |
| Idle in transaction, `ClientRead`, last statement INSERT | PostgreSQL finished that statement by `stateChangedAt` and awaited the client. Check result transport and Admin scheduling before blaming execution. |
| No matched sample                                        | Attribution unavailable: possible sampling gap, transaction acquisition/setup delay, missing privilege, cap or collector stop.                       |

`queryAgeMs` is the age of the current or last query, **not elapsed time in the
reported wait**. A single idle sample is normal between statements. Several
matched idle samples during a long driver/application interval are more useful.
Sampling cannot prove absence of shorter waits. Selection HTTP 503 and delivery
HTTP 200 timeout fallback counts must remain separate from ordinary fallbacks
and successful HTTP responses.

## Reproduction and overhead

All local writes ran in task-owned PostgreSQL 18 container
`codex-watch-m4q-pg`, after applying all 98 migrations. No shared database,
service or production setting was changed for these reproductions.

Nine real PostgreSQL checks passed: the new four-case discriminator, existing
two-case issuance integrity suite, and three native-pool checks. The real PostgreSQL tests are opt-in and were run locally with file parallelism
disabled so injected table locks remain confined to the fixture. Existing CI
runs the ordinary unit regressions. The configured GitHub credential cannot
edit workflow files, so this PR leaves the workflow unchanged and does not
claim that CI runs these additional PostgreSQL cases.

| Injected case                   | Actual path                                                                                                             | Independent observation                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Held table lock                 | Full issuance, 326-row attempted evidence batch                                                                         | `Lock/relation`, blocker count 1; semantic timeout and zero partially issued requests.                                                   |
| 400 ms statement-trigger sleep  | Actual 220-row bulk INSERT                                                                                              | `Timeout/PgSleep`; 431 ms evidence operation.                                                                                            |
| 400 ms blocked application loop | Actual 220-row INSERT held initially by a 300 ms trigger sleep; application pauses while the driver call is outstanding | Evidence operation takes 507 ms; PostgreSQL finishes in 311 ms and enters `idle in transaction/ClientRead` during the application pause. |
| Connection reuse                | Commit and rollback on the same named one-connection pool                                                               | Exact original application name restored after both outcomes.                                                                            |

Machine-readable evidence:
`docs/validation/watch-wait-correlation-20260923/wait-discrimination.json`.
These injected mechanisms validate the instrument; none recreates the complete
natural production incident or proves its cause.

The setup overhead comparison uses 2,000 measured transactions at concurrency
10 in ABBA order, plus 100 warmups per phase. Original p95 values are
15.95/12.55 ms; tagged p95 values are 12.55/11.91 ms. P99 is mixed:
original 22.33/19.89 ms versus tagged 19.76/30.35 ms. All complete, maximum
30.36 ms. This shared-host result supports a bounded setup cost, not a latency
improvement or production SLO. It excludes stdout serialization and the external
sampler; production collector overhead must be recorded separately. Artifact:
`docs/validation/watch-wait-correlation-20260923/setup-overhead.json`.

Reproduce the PostgreSQL checks only against an owned migrated database:

```sh
RECOMMENDATION_DB_TEST=1 pnpm --filter @forge/admin exec vitest run \
  src/db/recommendation-wait-sampler.db.test.ts \
  src/db/observed-pool.db.test.ts \
  src/services/recommendations/delivery-persistence.db.test.ts \
  --no-file-parallelism
```

## Review and release gate

Sequential Compound Engineering review covers correctness, failure/abort
cleanup, data integrity, privacy, TypeScript, performance, testing and repository
standards. Review strengthened pooled-name restoration, exact output caps,
expensive-poll abort checks, child-process cleanup and benchmark warmups; the
real PostgreSQL cases are reproducible with the documented opt-in test command.
No schema, retry, deadline, pool limit,
durability, authorization or homepage behavior changes.

The pre-main-update full Admin suite passes 7,318 tests; the production build
and typecheck pass. Fresh main `5b571268d` (PR #2392) was then incorporated,
preserving the other agent's short-watch feedback work. The relevant rerun
passes 575 recommendation/diagnostic unit tests and nine real PostgreSQL tests,
including the stronger outstanding-driver-call application-pause case above.
[PR #2393](https://github.com/JesusFilm/forge/pull/2393) passed all checks,
including **7,338 Admin tests**, production build, lint/typecheck, formatting,
and CodeQL. The standalone auth/RAG PostgreSQL integration jobs were skipped
by CI's affected-scope rules; the nine recommendation PostgreSQL checks above
were run locally. Fresh main was checked
again immediately before merging at 00:58:05 UTC. The normal automatic
deployment uses revision `4583c4ece1f1bba93660bd52d4f80cc618414fc8`.

Admin's running process was independently verified at 01:07:06 UTC:
deployment `0310fb49-69fd-4512-a097-b320283b7880`, exact revision above,
health HTTP 200 and workflow runner disabled. At 01:07:17, a natural seeded
request emitted a diagnostic observation ID and four concrete transaction/PID
entries through the existing Railway/Datadog log path. The collector script
exists in that deployed image. Preflight found no other Watch observer, and
the independent bounded capture started afterward. Worker was independently
verified at 01:13:50 UTC on the same revision, deployment
`28732351-f6ce-4b7d-827b-1542fbf1157d`, health HTTP 200 and runner enabled.
Neither health HTTP 200 nor one served request establishes recovery.

## Capture coverage and cleanup

All timestamps below are September 23 UTC; each observer polled every 250 ms
from its own process and read-only connection.

| Host   | Actual interval           | Polls / samples | Query wall total / maximum | Stop reason                                   |
| ------ | ------------------------- | --------------- | -------------------------- | --------------------------------------------- |
| Admin  | 01:07:49.363–01:13:25.234 | 1,322 / 18      | 4,957 / 288.9 ms           | `overhead`: incomplete requested 15 minutes   |
| Worker | 01:21:57.676–01:23:57.681 | 473 / 8         | 1,646 / 7.6 ms             | `duration`: full two minutes                  |
| Worker | 01:27:00.210–01:42:00.219 | 3,548 / 26      | 11,955 / 18.3 ms           | `duration`: full 15 minutes, CPU profiler off |

The first observer stopped at its single-poll safety threshold. Moving the
next bounded capture to worker reduced its observed overhead, but that does
not establish why the first poll was slow or fix an application failure.
Collection is sparse and has explicit gaps; none is a continuous incident log.
The 52 samples cover 49 distinct delivery observations. No sample contains a
blocking backend. A separate 01:42:32 connection check shows no remaining
observer, only that check's own disposable connection; the earlier checks also
verified closure after each capture. The inspector remains closed at 01:42:35.
The owned local PostgreSQL fixture is stopped. No persistent production
diagnostic setting, index or service configuration changed.

## Fixed-window request outcomes

The half-open **01:08–01:43 UTC** window uses seven uncapped five-minute
primary-log slices, reconciled with Datadog `trace.web.request.hits` sums.
All 379 seeded-delivery envelopes reconcile by HTTP status, including all
224 HTTP 200s with an Admin completion. All 49 sampled observations match a
completed runtime record, including one before the fixed request window.

| Endpoint        | HTTP 200 | Other observed HTTP statuses | HTTP 5xx |
| --------------- | -------- | ---------------------------- | -------- |
| Seeded delivery | 224      | 155 × 403                    | 0        |
| Selection       | 4        | none                         | 0        |
| Playback        | 1,858    | 1 × 401, 170 × 403, 2 × 409  | 0        |
| Evidence        | 793      | 6 × 400, 147 × 403           | 0        |
| Profile         | 364      | 416 × 403                    | 0        |
| Content actions | 1        | none                         | 0        |

Of the **224 delivery HTTP 200s**, 182 served the recommendation result and
42 used an ordinary fallback: 26 `no_candidates`, 13
`seed_embedding_unavailable`, and three `cooldown`. There were **zero
`delivery_timeout` or `retrieval_timeout` fallbacks** and zero selection HTTP
503s in this window. Delivery 403s split into 100 invalid-fetch-metadata and
55 invalid-origin rejections. No for-you delivery occurred. These zeros do
not establish recovery, particularly with only four selection requests.

Admin seeded service latency is p50 197.72 ms, p95 398.42 ms, p99 454.35 ms,
maximum 514.24 ms. These are service durations, not Web end-to-end latency.
The 195 completed evidence INSERT wrappers have p95 43.63 ms, p99 82.65 ms,
maximum 96.72 ms; pending operations are excluded rather than treated as zero.
No late-operation events occurred. Four Admin selection durations span
51.62–70.67 ms; that small sample cannot validate the historical failure path.

The same window records 105 slow native-pool acquisitions, maximum 112.92 ms,
and as many as 60 pending calls at acquisition start. All report
`requestCorrelated: false`; their durations also include connection setup.
These are evidence of pool pressure to investigate, not attribution to the
historical evidence-write or selection timeout. The old evidence-write trace's
transaction acquisition was about 6 ms.

Web's independently read process revision remains
`1cccac03cec7ad4427d0c6f80443dd4d71b942e0`, deployment
`7e475679-fd30-4973-b92c-797a183147f3`. Its configured `/watch` health route
returned 200 at 01:41:33. An earlier diagnostic mistakenly probed Admin's
`/api/health` path on Web and returned 404; this separate GET is retained in
the artifact and is not a recommendation POST failure.

Sanitized machine-readable population, samples, matched natural write and
cleanup evidence: `docs/validation/watch-wait-correlation-20260923/production-verification.json`.
Raw CPU profiles and unfiltered logs remain private. No traffic, including
traffic during the profiler or collector-overhead interval, is excluded from
the request population.

## Natural database/application discrimination

At 01:12:46 UTC, observation `b00a72fc-eb91-4b1b-a06e-4de19630f820`,
transaction 4, backend 1460983 provides a useful narrow result. PostgreSQL
started the 122-row INSERT at `01:12:46.248Z` and changed to idle in transaction
at `.254Z`: about **6 ms** on the database clock. The independent observer
sampled that same last statement at `.358Z`, still waiting for the client,
about **104 ms after PostgreSQL finished it**. Admin measured **82.65 ms**
around the evidence write and 81.95 ms in its raw-driver wrapper; the request
ultimately served recommendations in 414.53 ms.

This proves time outside PostgreSQL execution for this successful request.
It does **not** place all 104 ms inside the INSERT driver span: later application
work and dispatch of the next statement can contribute. Result transport,
native-engine processing and JavaScript scheduling remain candidates. The
individual APM span was not retained, so exact trace alignment is unavailable.
This is not the earlier 1.19-second timeout and does not establish its cause.

The captures also include active data-file reads and WAL waits, with no
sampled blockers. Those samples show the database sometimes waits on I/O;
their query ages are not measurements of the wait duration. They do not
justify calling the intermittent incident a PostgreSQL fault.

## Bounded CPU capture and rejected inference

A separate 30-second Admin CPU capture ran from 01:22:07.282 to 01:22:37.382
UTC while the worker hosted the independent database observer. Preflight found
no existing inspector. A task-owned cleanup watchdog bounded the temporary
inspector; completion and a separate 01:23:12 check confirmed it closed. No
persistent service setting changed. The later observer capture runs without
CPU profiling. Profiled traffic remains in the request accounting, with this
instrumented interval identified because profiling can perturb scheduling.

The profile contains 27,092 samples: about 20.93 seconds idle, 594 ms garbage
collection and 225 ms Prisma response parsing. A compiled hot frame maps to
GraphQL Yoga's `plugins/result-processor/stringify.js`. Its aggregate inclusive
sample time is 227 ms across the profile, but its longest contiguous sampled
burst is only 8.6 ms. Summed CPU samples are **not one 227 ms blocking pause**.
No specific competing workload was shown to cause a recommendation timeout.
The Admin cgroup reported no CPU throttling or OOM events before/after capture.

A retained, overlapping `GetWatchLanguageInventory` trace contains a 2,117 ms
raw query, with 2,106 ms in its engine query and 0.8 ms response serialization.
It began near the end of the CPU capture. This neither explains the historical
evidence-write timeout nor supports attributing that inventory query's delay
to JSON serialization. No inventory code was changed.

## Storage hypothesis retained for testing

A bounded read-only metadata check at 00:59:27 UTC took 23.63 ms across its
three queries. The evidence table reports approximately 15.15 million live rows,
9,244,327,936 heap bytes and 15,486,353,408 total bytes. PostgreSQL 18.6 uses
128 MiB shared buffers, with I/O timing disabled and synchronous commit enabled.
Shared buffers are not the entire cache: these settings alone cannot establish
physical I/O pressure, and zero I/O timings are unavailable evidence.

The live index definitions at 01:03:33 confirm two valid default B-tree indexes
on exactly `(run_id, stage, ordinal)`: the uniqueness-enforcing
`recommendation_candidate_stage_ordinal_key` (1,775,058,944 bytes) and the
non-unique `recommendation_candidate_stage_run_stage_idx` (1,776,680,960 bytes).
That is a concrete candidate for reducing write amplification. It is **not**
yet a demonstrated cause of the 1.19-second incident, and neither index was
changed. Do not drop the uniqueness guarantee or claim a performance effect
without a representative comparison and natural attribution.

The existing PostgreSQL checkpoint-completion logs from 22:57–23:57 UTC do
not place an active checkpoint over the 23:28:54 incident. The adjacent server
completion times are 23:26:25 and 23:31:39; their reported checkpoint durations
are 1.835 and 15.921 seconds. These are whole-checkpoint durations, not per-call
flush measurements. Log ingestion timestamps lag PostgreSQL's own timestamps
by varying amounts; use the source timestamp and causal identifiers. These
logs do not resolve independent WAL/data-file waits or application scheduling.

## Remaining causal work

Keep feat-496 in progress. The immediate discriminator for the next natural
delivery timeout is now deployed: join the operation's observation/ordinal/PID
to PostgreSQL state while it is outstanding. A long active statement requires
its execution/lock/I/O evidence; a statement already idle requires investigation
of native-engine/result transport and application scheduling. Do not repeat an
unjoined CPU profile and call its busiest frame the cause.

The standalone selection capability-budget call still needs its own natural
failure correlation; these delivery tags cannot resolve it. Preserve the
existing durable budget and deadline while testing that path. Any candidate
fix, including evidence-index write amplification or competing pool workload,
needs a representative controlled comparison plus production recurrence
evidence. Quiet capture windows cannot establish recovery or consistent
sub-200 ms delivery.
