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
and correlation are verified in the release section below.

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
  after incorporating the newer main revision. Release verification follows below.

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

## Automatic release and first-hour production verification

[PR #2388](https://github.com/JesusFilm/forge/pull/2388) merged at September 22
22:45:10 UTC as `4ec1f98207d42a31187f51410fad3cfad7257746`. CI passed, including
**7,313 Admin tests**, the Admin build, lint, schema checks, format and CI gate.
Five real PostgreSQL tests and the final focused 50-test run also passed locally.
Main changes through `badb8cc2c` were incorporated before that release.

Railway automatically deployed Admin
`556baa11-cef1-4fc4-9d6f-b6b620fccaae` and worker
`96e5f9f9-769e-473b-b14c-48a121bcc4b2`; both reached SUCCESS. Independent process
reads at 23:05:14/23:05:12 UTC confirmed that exact SHA, health HTTP 200, and
the correct false/true workflow-runner roles. Web remained at
`1cccac03cec7ad4427d0c6f80443dd4d71b942e0`, deployment
`7e475679-fd30-4973-b92c-797a183147f3`. No local deployment or manual redeploy
was used. No persistent production diagnostic setting or homepage flag was changed.

The fixed **22:57–23:57 UTC** first-hour window has these complete Web HTTP
metric counts. Semantic envelopes are independently reconciled with primary
Railway logs; HTTP 200 does not imply recommendation delivery succeeded.

| POST endpoint    |   200 | 403 | Other HTTP errors | 5xx |
| ---------------- | ----: | --: | ----------------- | --: |
| Seeded delivery  |   337 | 291 | —                 |   0 |
| Selection        |    10 |   0 | 2×400             |   0 |
| Playback         | 3,625 | 310 | 1×401, 3×409      |   0 |
| Initial evidence | 1,081 | 350 | 7×400             |   0 |
| Profile          |   502 | 688 | —                 |   0 |

All 337 seeded HTTP 200 envelopes reconcile: **293 served, 43 non-timeout
fallbacks and one `delivery_timeout` fallback**. That last response contains
five fallback cards. The selection 400s are terminal `invalid_request`, not
timeouts. No for-you delivery occurred in this window. All 510 recognized
crawler evidence/playback observations are rejected 403; unrecognized
automation is outside that assertion. Playback has zero 5xx among 3,939 calls.
This one-hour check does not satisfy feat-464's minimum two-hour canary.

There are 337 matching seeded Admin completion records and twelve selection
records. Admin service latency, including failed outcomes, is seeded p50
230.96 ms / p95 546.70 ms / p99 853.79 ms / maximum 1,483.27 ms; selection
maximum is 94.78 ms across only twelve calls. These are service wall times,
not browser end-to-end or Web HTTP latency. They do not meet the proposed
sub-200 ms delivery objective. The aggregate artifact is
[production-hour.json](../validation/watch-persistence-20260923/production-hour.json).

Three ordinary browser recommendation clicks reached Medley, My Last Day -
Trailer and Paper Hats. Their Admin selection completion times were 57.14,
61.74 and 64.27 ms. The destination recommendation sections rendered six cards.
These small success samples do not negate the semantic failure above. A fresh
authenticated Admin page, database probe 23:50:07.229 UTC, showed zero affected
profile pointers, zero ineligible contributions and zero rebuild backlog;
its broader window still contained 112 terminal runs and a DEGRADED label.

## Fresh recurrence: narrower attribution, unresolved cause

At **23:28:54 UTC**, the deployed code returned another HTTP 200
`delivery_timeout`. The structured runtime record links by span ID to
[trace 6ab30f350000000061e42c90b52d0140](https://app.datadoghq.com/apm/trace/6ab30f350000000061e42c90b52d0140).
The pending operation was the new **220-row evidence INSERT**. It ultimately
rejected with P2028 after 1,230.41 ms; its underlying driver call took
1,186.19 ms and rollback took 37.31 ms. The transaction acquired a connection
in 5.97 ms. Retrieval and profile retrieval took 37.18 and 127.73 ms earlier
in the request. This incident is therefore narrower than an unspecified slow
retrieval, and is separate from a selection acknowledgment failure.

This transaction had **1,225 ms remaining** in the existing overall deadline,
according to its P2028 trace. Do not apply the earlier incident's 650 ms value
to this request. The shipped optimization did not change deadline policy.
Its success in the paired local benchmark does not prove that scalar-parameter
overhead caused this fresh failure.

The 1.19-second driver span still combines server execution/waiting, transport
and result handling. The process loop record shows 661.39 ms active and
821.87 ms idle, with recent-loop maximum 22.90 ms; these overlapping process
measurements do not identify request CPU or rule out every scheduling stall.
There was no slow-pool acquisition record in the surrounding seven seconds,
and the trace directly measures fast transaction acquisition. Missing async
context remains explicit; it is not a fabricated zero-wait measurement.

At 23:56:42 UTC, a bounded read-only metadata query found approximately
15.1 million live candidate-evidence rows. Statement-duration, lock-wait and
I/O timing logging were disabled. `pg_stat_statements` was preloaded but its
extension was not installed in this database, so historical per-statement
server timing is unavailable. A current activity snapshot cannot retrospectively
assign a wait event to the 23:28 failure. No setting was changed to manufacture
that missing evidence.

A subsequent read-only, approximately 100 ms activity sampler ran from
September 23 00:00:49 to 00:02:25 UTC. It stopped automatically at its three-second
aggregate query-overhead budget: 926 queries, 3,001.77 ms total wall overhead,
8.78 ms maximum query time. Four evidence-write observations included one
`IO / DataFileRead` at 16.66 ms statement age, one running statement and two
`ClientRead` waits while idle in transaction; none had a blocker. This is not
a measurement of wait duration and did not capture the earlier long insert.
The diagnostic connection closed and its session-only read/timeout settings
expired with it. No persistent diagnostic settings need restoration.

The first-hour logs also retain 465 acquisitions at or above the 50 ms logging
threshold, maximum 492.42 ms and maximum 95 pending at acquisition start.
These are selected slow process-wide observations, not the distribution of
all acquisitions or request-specific blame. There were none around the failing
insert, so this pressure does not explain that particular recurrence.

**Keep feat-496 in progress.** The release proves a narrower persistence
optimization and useful diagnostics, not complete runtime recovery. The next
causal experiment needs matching database waits and driver timing under the
production-sized evidence/index workload. Keep selection's durable-budget
investigation separate, and preserve every issuance and attribution constraint.

## Collector and measurement learnings

Production receipt and trace correlation are now verified. Both Railway and
Datadog parse these JSON events into attributes and may leave `message` empty.
Query Datadog with `service:forge-admin @event:recommendation.runtime`; a
plain message search can falsely suggest the new diagnostics are absent.
Railway attribute values themselves require JSON decoding. Use a retained
canonical 128-bit trace ID when the decimal log trace ID is only its low 64 bits;
the shared span ID confirms the match.

The Web primary-log hour exceeded Railway's 5,000-row response cap. The evidence
uses adjacent half-open 48-minute and 12-minute slices, neither capped, with
zero unparsed records. Their delivery and evidence populations reconcile with
the HTTP metrics. Do not silently accept capped or sampled log totals.

An unfinished timing has `inFlight: 1` and `elapsedMs: 0` at response time.
Exclude it from completed-operation latency distributions, but retain its
failed request and later rejection separately. Otherwise timeout writes appear
as zero-millisecond successes in the operation percentile calculation.
