# Watch production verification — September 22, 2026

## Verdict and scope

The sustained check does **not** establish recovery or close content-discovery
feat-464, feat-459, feat-447 or platform feat-496. It verifies deployment,
reconciliation work and a fresh integrity snapshot, but finds a new selection
timeout and a separate playback failure burst. All timestamps below are UTC;
the report date follows the operator's Pacific/Auckland date.

The fixed observation window is **September 21, 06:35–19:45 UTC**: 13 hours
10 minutes after Web's diagnostic release. Counts are primary Web APM request
metrics, grouped by endpoint/status/revision, independently compared with final
application observations. No production fault injection, viewer canary, data
write, configuration change, inspector or redeploy was performed in this check.
The [aggregate evidence](../validation/watch-production-verification-20260922/outcomes.json)
contains the derived denominators, batch results and retained discrepancies.

Fresh `origin/main` was fetched before creating
`codex/watch-prod-verification-20260922-m4q` in its own worktree.
This continues the [existing closure plan](../plans/2026-09-21-watch-4xx-closure-plan.md).
The [previous release record](watch-transport-cause-release-2026-09-21.md)
remains valid for its short window, not a sustained-recovery claim.

## Running deployments and preserved launch state

Railway's project-scoped deployment inventory and independent SSH reads still
identify **`d0c749b981b8c3cf777c6e62bd9e5eae1abbd2bf`**:

| Service | Deployment                             | Verification                           |
| ------- | -------------------------------------- | -------------------------------------- |
| Admin   | `35e6abff-3f59-464e-8769-fbed87659e67` | 19:57:53 UTC; runner false; health 200 |
| Worker  | `f8f3e18a-1d61-4db0-a5cc-7411886d9bcf` | 19:57:53 UTC; runner true; health 200  |
| Web     | `ca4c2f1c-30d6-493e-9e87-82dbb7460991` | Independent revision/deployment read   |

Admin and worker retain the exact `@mastra/core`/`@mastra/memory` externalization.
The documentation revision `de9ebcb69…` was skipped by runtime deployment
automation. Health is initialization evidence, not a request-latency check.

At 20:05:55 UTC, read-only SQL finds one published English homepage and **zero
authored recommendation blocks**. Web availability returns
`{enabled:false}` at 20:05:56 UTC. The registry default remains false.
No Mobile/TV UI, account linking or curation changed.

## Complete HTTP population

| Endpoint             |    200 | 400 | 401 |    403 | 409 | 503 |  Total |
| -------------------- | -----: | --: | --: | -----: | --: | --: | -----: |
| Delivery POST        |  4,283 |   0 |   0 |  5,059 |   0 |   2 |  9,344 |
| Selection POST       |     70 |   4 |   0 |      0 |   0 |   1 |     75 |
| Playback POST        | 44,395 |  26 |  35 |  5,226 |  16 |  65 | 49,763 |
| Evidence POST        | 15,468 | 279 |   9 |  3,514 |   0 |   0 | 19,270 |
| Profile POST         |  7,123 |   0 |   0 | 13,592 |   0 |  12 | 20,727 |
| Content actions POST |     22 |   0 |   0 |      0 |   0 |   2 |     24 |

There are additionally five availability GET 200s and three evidence GET 405s.
They are not selections, deliveries or valid evidence submissions.

Playback's 5xx fraction is **65 / 49,763 = 0.130619%**, with zero exclusions.
It passes the ticket's under-1% aggregate criterion while retaining the real
burst and its correctness/availability questions. Do not use the overall rate to
erase the single selection timeout or infer browser receipt success.

## Semantic delivery outcomes and collection coverage

Both independent collectors contain the same **4,280 HTTP 200 envelopes**:

- 3,455 served responses.
- 824 fallbacks: 388 `no_candidates`, 407 `seed_embedding_unavailable`,
  18 `cooldown`, five `session_hour`, six `profile_lineage_ineligible`.
- One `unavailable / delivery_unavailable` response with zero cards.
- **Zero observed `delivery_timeout` or `retrieval_timeout` envelopes.**

Primary metrics contain **three additional HTTP 200s** whose final semantics
remain unknown. Therefore zero observed timeout envelopes is not an exact
zero for the complete population. A separate final five-minute boundary slice
reconciles all 40 calls; this does not explain the broader discrepancy.

Railway has all 5,059 HTTP 403 outcomes; Datadog has 5,057, missing two
fetch-metadata rejections. Both retain the two HTTP 503
`admission_unavailable` outcomes. Railway returns 9,341 unique observations,
one exact repeated row and zero unrecognized rows; bounded five-minute reads
cover the complete fixed window without a row-limit truncation.
Datadog has 9,339 observations. No collector is designated universally complete.

The admission log's six worker-unavailable diagnostic rows are not six failed
delivery requests; several belong to other endpoints or failure stages.
Selection still does not use Redis admission.

## New selection timeout: capability-budget path

At **08:37:29.017 UTC**,
[trace `6ab0ecc9…`](https://app.datadoghq.com/apm/trace/6ab0ecc9000000002cc67b5b00886e66)
records selection HTTP 503 after **706.20 ms**, with the unchanged 700 ms
upstream timeout. Admin's resolver runs **759.40 ms**.

The independently committed
`consume_recommendation_capability_submissions` call takes **701.12 ms**.
Its Prisma adapter `js:query:sql` child takes **697.29 ms**; serialization and
result spans are negligible. Prisma's separate `connection` span is about
0.003 ms, but that is not proof of native pg-pool acquisition time. The adapter
SQL span includes client-side work and waiting, not pure PostgreSQL execution.

Existing Node metrics around 08:36:30–08:38:30 show maximum loop samples
below 78 ms and maximum GC samples below 15 ms. They do not support assigning the
whole budget delay to one 700 ms scheduling pause. No contemporaneous native
pool/lock/WAL measurement establishes the full cause. Keep that question open;
do not inflate deadlines, combine the independent budget with the selection
transaction, or retry an ambiguous mutation.

## Separate playback burst: catalog error and scheduling stall

Of the 65 playback 503s, **63 occur in the 12:49–12:50 minute buckets**:
62 facts calls and one context call exceed the upstream boundary. The remaining
facts timeout is at 07:58; a context admission failure is at 10:17.

A sampled
[playback trace](https://app.datadoghq.com/apm/trace/6ab127fe000000004c8289a5a588971e)
starts Web fetch at 12:50:06, expires after 3,000.13 ms, and begins retained
Admin processing near 12:50:09. The Admin resolver continues for 1,095.92 ms.
This is a deadline failure, not a proven socket reset or connection refusal.
The new bounded network field is present but reports `unknown`; its label alone
does not establish the cause or whether a mutation committed.

The earlier initiating evidence is concrete:

- At **12:49:27.277 UTC**, `videoMuxPlaybackIdByIdAndLanguageSlug`'s
  `prisma.video.findMany()` reports PostgreSQL **53100**:
  shared-memory allocation cannot resize to 8 MiB because no space remains.
- One Prisma log is followed by **206 identical Yoga error logs** from
  12:49:28.061 to 12:50:06.539, associated with the same retained log trace ID.
  This is error fan-out, not evidence of 206 independent failed SQL executions.
  The initiating full trace is unavailable.
- Non-interpolated runtime metrics on the exact revision record a **38.55-second
  maximum event-loop delay** at 12:50:00 and a heap-used sample of approximately
  1.79 GB. Gauge interpolation was disabled with `.fill(null)`; interpolated
  samples must not be interpreted as separate pauses.
- At **12:50:09**, one facts operation exhausts its episode-lock budget after
  four lock attempts. The correlated error is
  `recommendation_episode_lock_exhausted`, **not** exhausted P2034/40001
  serialization recovery. Keep the observed exhaustion visible.

The error burst and scheduling pause overlap closely. A **testable hypothesis**
is repeated synchronous error formatting/forwarding after one batched catalog
failure. It is not yet a proven initiating workload or a demonstrated fix.
Next work should reproduce the same field fan-out in an owned production build
with source maps and existing logging, measure the complete selection/playback
effect, and separately investigate the PostgreSQL shared-memory limit/query plan.
Retain the error in both operational reporting and GraphQL responses; disabling
logging, enlarging deadlines or changing shared production database settings is
not an established correction.

This later scheduling burst does not explain the earlier 08:37 capability-budget
failure. Runtime identity is unchanged throughout; startup/handover is not
established as either new incident's cause.

## Bounded local error-formatting diagnostic

A subsequent isolated experiment establishes a local amplification mechanism,
while leaving the full production incident attribution open. It runs the pinned
Yoga 5.21.0 schema executor with 206 nullable fields rejecting the same Error,
its observed stack, and Next 16.2.4's actual error inspector. Three exact deployed
stack-frame source maps are read without changing production; `sourcesContent`
is removed and the maps are supplied through Next's local fallback lookup.
No production database or application callback is invoked by the experiment.

Three fresh processes per mode produce:

| Mode                                          | Complete GraphQL duration | One-millisecond timer fires after | Retained logs/errors |
| --------------------------------------------- | ------------------------- | --------------------------------- | -------------------- |
| Native console inspection                     | 47.33–52.87 ms            | 47.38–52.92 ms                    | 206 / 206            |
| Next error inspection                         | 10,860.48–11,455.04 ms    | 10,860.78–11,455.35 ms            | 206 / 206            |
| Next installed, format existing stack strings | 36.04–38.98 ms            | 36.08–39.03 ms                    | 206 / 206            |

Every response remains HTTP 200 with 206 masked GraphQL errors and every error
is logged. The Next mode makes 618 source-map lookups: three maps for each
inspected error. Its implementation creates the map-consumer cache inside each
inspection. The stack-string control removes this repeated inspection cost
without omitting errors. It is an experiment, not a production logger change.

The local Node version is 24.16.0 versus Admin's 24.21.0. The sink counts output
bytes without stdout transport or Datadog forwarding. There is no database
shared-memory pressure, production module graph, or concurrent selection/playback
load. Thus the experiment reproduces severe synchronous formatting amplification,
**not** the entire 38.55-second production pause or the earlier capability-budget
failure. A scoped logger correction still needs production-build validation,
metadata/privacy review and normal release verification before claiming a fix.

## Evidence integrity, reconciliation and lifecycle gates

The indexed Web/Admin observations reconcile all **16 invalid-binding outcomes**
to terminal HTTP 409: eight claims and eight facts. No retryable-binding label is
observed. This verifies server classification, not real browser retry prevention.

All **6,840 recognized-crawler observations** are terminal rejections: 3,514
evidence and 3,326 playback requests. No accepted recognized-crawler observation
appears. Unknown user agents remain unknown; this is not proof that every accepted
request is human.

No indexed `P2002` or `recommendation_serialization_exhausted` error appears
in the window. The independently confirmed episode-lock exhaustion remains
separate. Web/Admin accepted/replay counts differ because they measure distinct
boundaries and can lose observations; they do not independently prove receipt
or mutation disposition for every lost acknowledgment.

The shared durable workflow store contains **153 completed reconciliation batch
steps and 153 completed heartbeat steps**, with zero stored errors. Decode the
bounded CBOR output envelope and its `devl` reference table before reading
counters; JSON reference indices are not the counter values.

Across those batch results:

- 665 classifications attempted, **zero classification failures**.
- 86 affected pointers and 86 rebuilds queued.
- **Zero dispatch failures or exhausted attempts**, no locked batches.
- One stale run observed, zero stale-run requeues.

Batch durations range from 1.469 to 11.330 seconds; the whole batch can include
multiple bounded operations. Completion intervals range from **305.697 to
411.984 seconds**. The longest gap ends at 09:03:22.994 and is retained; this is
not a claim of exact five-minute completion spacing. All 153 completed heartbeat
logs reconcile to the durable steps.

At **19:58:20.055 UTC**, the unchanged full canonical eligibility predicate
examines **171,710 current pointers and finds zero ineligible**, in 1,841 ms.
The audit uses repeatable-read/read-only, a five-second statement guard, a
500 ms lock guard and transaction-local JIT setting, then rollback/disconnect.
This is a complete snapshot, not continuous zero or an authorized Admin UI check.

Fresh retained-row checks since September 18 find no matching operational
last-known-good fallback request and no failed projection run to establish the
independent stale-publication gate. One scheduler stale-run observation alone
does not prove a stale publisher was rejected. Previous real Watch lifecycle,
withdrawal/reset/erasure and restored-vector performance evidence stays credited
under its existing scope.

## Remaining closure requirements

| Ticket   | Result                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-464 | Aggregate playback error-rate criterion passes; server terminal mapping and crawler rejection observed. Installed alerts, matching authorized Admin evidence and actual browser retry behavior remain unverified. Retain the new timeout/lock-exhaustion burst. |
| feat-459 | Sustained real reconciliation work and fresh zero-pointer snapshot pass. Its feat-464 dependency and matching authorized Admin evidence remain unmet.                                                                                                           |
| feat-447 | No new production fallback/stale-publisher proof; matching authorized Admin lifecycle trace remains unmet. Preserve completed lifecycle and restored-snapshot evidence.                                                                                         |
| feat-496 | New capability-budget selection timeout and separate scheduling burst prevent recovery closure. Three delivery HTTP 200 semantics remain unknown.                                                                                                               |

The complete paginated Datadog inventory still contains **41 monitors** without
the required recommendation transport/reconciliation alerts. Read-only access was
used; definitions in Git are not installed alerts.

The browser tool returns no apps or browsers, and opening the in-app browser
returns `Browser is not available: iab`. An existing authorized Admin session
was requested while other checks continued. No browser result or privileged
identity was manufactured. Those gates remain explicit if access is unavailable.

Sequential Compound Engineering review checks source/denominator consistency,
privacy, negative findings and closure requirements. Durable learnings extend the
[existing outcome-accounting document](../solutions/logic-errors/recommendation-outcome-accounting-boundaries-20260921.md).
This verification makes no application-code or production-configuration change.
