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
real PostgreSQL cases are reproducible with the opt-in test command below. No schema, retry, deadline, pool limit,
durability, authorization or homepage behavior changes.

The pre-main-update full Admin suite passes 7,318 tests; the production build
and typecheck pass. Fresh main `5b571268d` (PR #2392) was then incorporated,
preserving the other agent's short-watch feedback work. The relevant rerun
passes 575 recommendation/diagnostic unit tests and nine real PostgreSQL tests,
including the stronger outstanding-driver-call application-pause case above.
Release remains subject to final checks and normal PR-to-main automation.
After deployment, verify the exact Admin and worker revision and collect a
bounded independent sample alongside natural delivery traffic. Retain HTTP
failures and semantic timeout fallbacks separately. A quiet capture cannot
establish recovery; feat-496 stays in progress pending causal evidence and its
acceptance gates.
