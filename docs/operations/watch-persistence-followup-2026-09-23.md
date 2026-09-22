# Watch persistence and request timing — September 23

## Scope and current conclusion

Continue feat-496 in the dedicated `codex/watch-latency-observability-20260923-k7p`
worktree. Fresh main was `f9354608715c3bf656e94dff8ec2c8bd33cc6fb7`; incorporate
`4384b8616` before release. Investigation remains internal. This work reduces a
measured recommendation-delivery persistence cost and adds bounded diagnostics.
It does not establish the historical selection-timeout cause or close feat-496.

The production Admin revision verified September 22 at 21:40 UTC was
`c98ec86bdd9a308f33b53d035084e8fd10e0e08d`, deployment
`dfbb23e1-98e5-4c80-9328-528f1192a80a`. This is the pre-change revision.

## Production evidence and hypothesis

At September 22 20:42:24 UTC, a Web response returned HTTP 200 and six fallback
cards with `delivery_timeout`. This is a semantic failure, separate from a
selection HTTP 503. [Trace 6ab2e82e000000002bd5afb121a0a6cd](https://app.datadoghq.com/apm/trace/6ab2e82e000000002bd5afb121a0a6cd)
has a 1,495.24 ms Admin request, a 651.90 ms persistence transaction and
611.72 ms candidate-stage `createMany`, ending in P2028 with 720 ms elapsed
against the unchanged 650 ms transaction limit. The underlying INSERT driver
span is 517.60 ms. Driver wall time does not identify PostgreSQL execution,
pool waiting, commit flush or application scheduling individually.

A bounded read-only production query at 21:53 UTC took 20.62 ms and found ten
recent runs with 6–315 stage-evidence rows, mean 123, maximum stored source JSON
103,098 bytes. It used the existing latest-run index and a small child aggregate;
no identifiers or content were exported. No production diagnostic settings were
changed. The hypothesis was that scalar parameter construction and processing
amplify the cost of these batches under concurrent application work.

## Reproduction and change

Use an owned PostgreSQL 18 container with all 98 migrations, the pinned Prisma
adapter, the production ten-connection main budget, real issuance transactions,
and synthetic retrieval/token providers. An initial 206-row workload measured
application `createMany` medians near 60–63 ms serial and 104 ms concurrent.
Session-local server duration logging on this owned database measured evidence
parse median 1.82 ms, bind 4.03 ms and execution 14.19 ms. These observations
establish overhead outside server execution; they do not attribute all of it to
one JavaScript function or reproduce production storage.

Replace only candidate-stage evidence `createMany` with one bound JSON payload
and typed `jsonb_to_recordset` INSERT. All rows stay in the original issuance
transaction with the same foreign keys, uniqueness, expiry and score checks.
Explicit creation timestamps preserve Prisma's write-time default. Non-finite
numbers fail closed before JSON can silently convert them to null. No migration,
index change, retry, deadline increase, budget change or asynchronous audit write.

Final alternating-order comparison, captured September 22 22:27:42 UTC, used
326 rows per delivery, ten concurrent requests and 200 requests per round:

| Round      | Persistence p50 | Persistence p99 | Full synthetic service p99 | Issued / attempted |
| ---------- | --------------: | --------------: | -------------------------: | -----------------: |
| Original 1 |       323.30 ms |       473.74 ms |                  518.66 ms |          200 / 200 |
| Bulk 1     |       184.16 ms |       241.20 ms |                  259.52 ms |          200 / 200 |
| Bulk 2     |       211.38 ms |       284.94 ms |                  311.34 ms |          200 / 200 |
| Original 2 |       385.26 ms |       539.73 ms |                  558.94 ms |          200 / 200 |

The machine-readable [paired results](../validation/watch-persistence-20260923/persistence-paired.json)
are authoritative, including every stage and exact distributions. All 800
deliveries issued and persisted exact request counts. Both variants succeeded;
the test does **not** reproduce the natural 650 ms expiry. The heaviest fixture
still exceeds 200 ms. Retrieval, signing, production transport and storage are
not represented by these full-service timings.

## Diagnostic coverage and limits

`recommendation.runtime` records seeded delivery, for-you delivery and selection
separately, including semantic timeout outcome, dependency and Prisma wall
times, input row counts, pending operations, sanitized error codes, transaction
callback/settlement and process event-loop context. Timings overlap and must
not be summed. Process loop activity is not request-specific CPU attribution.
Late settlement is logged as resolved/rejected, never as an inferred commit.

Real pool saturation proved Prisma's native engine loses the caller's async
context at acquisition. Missing correlation remains explicit (`poolPendingMax`
is null). Independent `database.pool_acquisition` records retain slow or failed
acquisitions and backend PID without assigning them to concurrent requests.
Acquisition includes connection establishment. Preserve the 10/5 budgets and
owned-pool recreation after disconnect. Existing Datadog console forwarding
supplies trace tags where its active context is available; production receipt
and correlation still require verification.

The four-thousand-call [overhead comparison](../validation/watch-persistence-20260923/observation-overhead.json)
uses real PostgreSQL SELECT 1, ten concurrent calls and ABBA order. Baseline
p50 was 2.11/1.60 ms; observed p50 2.22/1.89 ms. Warmup/order effects remain;
this is a small local overhead check, not an end-to-end production bound.
It includes JSON generation and excludes stdout/UDP delivery.

## Review and validation

Sequential Compound Engineering review covered correctness, integrity, failure
handling, security, contracts, performance, tests and project conventions.
Review fixes preserve write-time timestamps, reject non-finite JSON numbers,
avoid pg.Pool's internal `log` property, retain reconnect observation and cap
labels at 32 so escaped records fit the existing 16 KiB forwarding envelope.
No capabilities, viewer IDs, SQL parameters or raw Error objects enter new logs.

- Admin suite: 7,310 passed before the final bounded-envelope test; final
  targeted observation suite: six passed.
- Five real PostgreSQL tests pass: saturation, callback compatibility,
  disconnect/reconnect, complete field parity/constraints and blocked-write
  rollback. These injected waits validate diagnostics, not historical causality.
- Admin production build and both workflow registration checks passed.
- Final Admin lint, TypeScript and all changed-file formatting checks passed
  after incorporating the newer main revision. Release verification is pending.

Reproduce with `RECOMMENDATION_DB_TEST=1` and an owned migrated DATABASE_URL for
`src/db/observed-pool.db.test.ts` and
`src/services/recommendations/delivery-persistence.db.test.ts`. Opt-in benchmark
files use `WATCH_PERSISTENCE_BENCHMARK=1` and explicit absolute output paths
`WATCH_PERSISTENCE_BENCHMARK_OUTPUT` and `WATCH_OBSERVATION_BENCHMARK_OUTPUT`.
Do not run these fixtures against production or another task's database.

## Release and closure gates

Merge through normal PR/main automation; verify exact Admin and worker deployed
SHAs afterward. Count endpoint HTTP failures independently of semantic delivery
fallbacks, inspect runtime records and trace linkage, and compare actual batch
sizes and latency. A short healthy period cannot close recovery. Selection
capability-budget latency remains an independent investigation; no Redis
admission explanation is assumed. Keep homepage behavior and the default-off
LaunchDarkly flag unchanged. feat-464's installed alert/dashboard and canary
requirements, and dependent feat-459/447 gates, remain separate requirements.
