# Watch search timeout investigation: October 23, 2026

Tracking: `feat-678`. Plan:
`docs/plans/2026-10-23-watch-search-timeout-diagnosis.md`.

## Status

Intermittent production failure reproduced, including in the public browser.
Datadog now confirms serving-profile deadline exhaustion on two correlated
probes. One retained trace shows the missing-projection fallback performing
serial database reads, including a transcript-compatibility query that
outlasts the deadline. A separate latency-accounting defect is fixed locally
and regression-tested. The subsequent owner-approved fix replaces the
corpus-sized compatibility join with a version-first existence check. Two
read-only production comparisons reduced SQL execution from 1,102-1,309 ms to
36-40 ms with identical results. This is not yet a deployed availability fix.
No production settings, deployments, or monitors were changed.

The report concerns `https://www.jesusfilm.org/watch` and the phrase
`Bible stories stories`. The reporter's incident date/time and exact UI state
remain uncertain. Today's reproduction cannot prove the historical cause.

Source inspection and patch use main at
`d25cc4fd748f7aef1545cf5adfc541526b318e99`, in branch
`codex/watch-search-timeout`. The original checkout was September-era code;
its deadline behavior was not representative of current main. Railway and
Datadog identify the serving Admin revision as
`d5daa51c19489047f5d78cf5f0af359dc163d939`, deployment
`defd3814-3237-4dab-ace4-f77f09d3ce8d`. The inspected profile, deadline and
Typesense service files have no differences between that revision and main
before the local accounting patch.

## Observations

All times are October 23 UTC; add 13 hours for NZDT. Probes were bounded,
sequential, normal anonymous requests, not a load test or fault injection.

- Around 01:00, the public modal showed `Search failed. Please try again.`
  The page also showed `Failed to load experience: An unexpected error occurred.`
  Retrying later displayed results, led by StoryClubs.
- Six identical shared-operation replays with canonical Origin, omitted mode,
  English language inputs and 20 VIDEO results produced four HTTP 504s and
  two successful responses. Successful responses contained 20 results; the
  failures contained HTML, not an empty GraphQL result. This small diagnostic
  sample is not a population error-rate estimate.
- `Jesus` also failed, while the reported phrase later succeeded. Repeated
  words are not sufficient to explain the incident.

| UTC      | Request                                            | HTTP          | Wall time | Reported search time |
| -------- | -------------------------------------------------- | ------------- | --------- | -------------------- |
| 01:02:20 | GraphQL `__typename`                               | 200           | 783 ms    | n/a                  |
| 01:02:22 | `Jesus` search                                     | 504           | 2,416 ms  | unavailable          |
| 01:03:35 | `/api/search/health`                               | 200           | 2,815 ms  | n/a                  |
| 01:04:30 | Exact phrase, explicit DEFAULT, no Origin, limit 1 | 200, degraded | 3,019 ms  | 2,205 ms             |
| 01:04:31 | Exact phrase, explicit MODERN, no Origin, limit 1  | 200           | 1,218 ms  | 847 ms               |
| 01:05:26 | Shared operation, canonical Origin, limit 20       | 504           | 2,234 ms  | unavailable          |
| 01:05:28 | Identical replay                                   | 200           | 1,345 ms  | 928 ms               |
| 01:05:29 | Identical replay                                   | 200           | 1,468 ms  | 1,159 ms             |
| 01:19:07 | Minimal exact-phrase search, limit 1               | 504           | 2,210 ms  | unavailable          |
| 01:19:10 | Identical minimal search                           | 504           | 2,256 ms  | unavailable          |
| 01:27:44 | EXPERIENCE-only early return                       | 200           | 1,693 ms  | 18 ms                |
| 01:28:17 | EXPERIENCE-only early return                       | 504           | 2,453 ms  | unavailable          |
| 01:28:58 | EXPERIENCE-only early return                       | 504           | 9,168 ms  | unavailable          |
| 01:29:30 | EXPERIENCE-only early return                       | 200           | 1,703 ms  | 21 ms                |

The final four requests were separated by 31 seconds after each completed.
In current Typesense service code, EXPERIENCE-only skips content retrieval,
embedding and availability hydration, but still resolves the serving profile
and language signals. This is a diagnostic input, not the normal VIDEO journey.
Failures there show content retrieval is not necessary to reproduce a failure.
The public probes alone could not identify the failing stage; subsequent
production logs below identify serving-profile timeouts.

Immediate warm repeats were often much faster: at 01:26:57-01:26:59, early
returns took 194-217 ms (18-36 ms reported), while VIDEO searches took
282-379 ms (100-199 ms reported). Other paired Origin/no-Origin probes all
succeeded, so those probes did not establish an Origin-specific failure.

Final shared-operation replay at 01:36:36 returned HTTP 504 in 2,264 ms
(Ray `a4ed0306ee182c5b-AKL`). The immediate repeat at 01:36:39 returned 20
results in 2,025 ms, reporting 1,585 ms server latency and no degradation
(request `87bcb0d1-7971-4dd9-849c-52155f382a95`). The production symptom
therefore still reproduced in that window. Three preceding malformed diagnostic
requests used `currentLanguageSlug` instead of `currentWatchLanguageSlug` and
returned validation HTTP 400; they are probe mistakes, excluded from the
availability evidence.

At 01:47:59 and 01:48:02, new client-request-ID-correlated EXPERIENCE and
VIDEO probes both returned HTTP 504, in 2,440 and 2,482 ms respectively.

### Correlation IDs

- Failed control at 01:02:22: Cloudflare Ray `a4ecd0d1099cd99e-AKL`.
- Failed shared operation at 01:05:26: `a4ecd5510ecb949e-AKL`.
- Failed minimal searches at 01:19:07/01:19:10:
  `a4ece95a596dd9a8-AKL`, `a4ece96a4a43d9a8-AKL`.
- Failed early returns at 01:28:17/01:28:58:
  `a4ecf6c8bbb45416-AKL`, `a4ecf79a0db8c696-AKL`.
- Successful shared searches:
  `e2154c8d-cbb2-4cb9-b8bb-dffd5cd2535c`,
  `241db08a-35e9-4222-a84e-527b88e12e3a`.
- Successful early returns:
  `3c57e931-77ee-4a23-8cbc-7b38971ee829`,
  `f48d0b6e-6e25-4624-94c3-b3b735161cd4`.

These are diagnostic correlation values, never metric labels. No credentials,
client IPs, cookies or user identifiers are retained here.

## Interpretation

Current main deliberately maps `WatchSearchTimeoutError` to HTTP 504 and
`WATCH_SEARCH_TIMEOUT` in `apps/admin/src/graphql/queries/watch-search.ts`.
The total search budget is 2,300 ms, with a 400 ms response reserve. Profile
preparation uses the same budget and must finish before the 1,900 ms cutoff.
Cloudflare can serve a branded HTML page for an origin 504, so that page alone
does not establish a Cloudflare or Railway fault. See
[Cloudflare's origin 502/504 guidance](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-502-504/).

### Correlated Production Evidence

Read-only Datadog and Railway API access succeeded. No key was created and no
production configuration was changed. Credentials were held in session memory,
not written to this report or the repository.

Datadog log query `service:forge-admin "watch_search_deadline_exceeded"`,
01:00:00-01:49:00 UTC, returned 32 events: 26 `serving_profile`, five
`language_resolution`, and one `availability_hydration`. These are observed
log counts, not an error-rate denominator or proof of complete ingestion.

| Probe      | Client request ID                      | Deadline log                            | Railway upstream HTTP/duration |
| ---------- | -------------------------------------- | --------------------------------------- | ------------------------------ |
| EXPERIENCE | `1116decd-fcdc-4fa6-9230-5540343a124e` | 01:47:59.867, serving_profile, 1,906 ms | 504 / 2,097 ms                 |
| VIDEO      | `ac470873-3824-4ab4-aa86-7abf6cf50ed7` | 01:48:02.347, serving_profile, 1,992 ms | 504 / 2,139 ms                 |

Both Railway responses came from instance
`846555fb-5e22-4365-b3ef-b240595c1d4f`, with no recorded upstream error detail.
This establishes an Admin-origin timeout for these reproductions, not an
edge-only failure. The same instance logged the earlier 01:28:58 response
with 8,987 ms upstream duration. That longer pre-deadline delay is still not
explained; its full trace was not found in the retained sample.

The first probe's retained Datadog trace is
`6adabccd000000002d55b02cbf93b085`. Its GraphQL span starts at 01:47:57.960
and errors after 1,907 ms. Child spans show:

| Preparation work                                                       | UTC start    | Client-observed span duration |
| ---------------------------------------------------------------------- | ------------ | ----------------------------- |
| Read `watch_search_current_transcript_projection`                      | 01:47:57.961 | 638 ms                        |
| Four Typesense alias GETs, in parallel                                 | 01:47:58.600 | about 104-107 ms each         |
| Read active content embedding contract                                 | 01:47:58.732 | 766 ms                        |
| Resolve distinct transcript chunking version via transcript/chunk join | 01:47:59.498 | 2,081 ms                      |

The last query's Prisma database span alone lasts 2,062 ms, ending at
01:48:01.563, after the GraphQL response has already failed. These durations
include client/driver waiting and must not be presented as PostgreSQL
execution-plan timings. The second probe's trace,
`6adabcd000000000727cf7b177ea42d6`, confirms a 1,994 ms GraphQL failure but
does not expose its own dependency spans; shared in-flight preparation is
consistent with the code, not independently proved by that trace.

### Causal Chain And Limits

1. The configured serving profile is a candidate. Its service cache expires
   after 30 seconds (`apps/admin/src/services/index.ts`). A cache miss awaits
   profile preparation on the public request's 1,900 ms cutoff.
2. `resolveCurrentWatchSearchTranscriptProjectionWithFallback` first reads
   the stored projection. Only when that returns null does it read aliases,
   the active embedding contract, and transcript compatibility. The observed
   sequence therefore establishes the fallback branch for this trace. The
   absent projection was initially inferred from this code path; a subsequent
   read-only production database query confirmed the table contains zero rows.
3. `resolveCurrentWatchSearchTranscriptCompatibility` runs the transcript/chunk
   join before serving-pointer and generation qualification can finish. The
   recorded serial database-path delays exceed the request budget before
   content retrieval begins.
4. The deadline emits `serving_profile` and throws `WatchSearchTimeoutError`;
   GraphQL maps that to HTTP 504. The browser displays the failure. The
   underlying Prisma work is not cancelled by the deadline.
5. Reuse of a resolved candidate service avoids this preparation until cache
   expiry. That explains a mechanism for intermittent cold/warm behavior;
   it does not imply every search failure has this cause.

Confidence is high for this reproduced path. Railway also recorded a full
10-connection main pool, no idle connections, and queues up to 36 around
earlier failures. Those pool warnings were not request-correlated, so they
support a shared-pressure hypothesis without proving how much of this trace
is pool waiting versus database execution. The five language-resolution and
one hydration deadline events require separate attribution. The original
reporter's incident time is unknown.

### Initial Remediation Assessment

The initial recommendation was to remove live compatibility reconstruction
from cold serving requests by verifying and bootstrapping the absent
projection. Any bootstrap/publication must certify the exact current collection,
embedding contract, chunking version and revision, with alias/qualification
readback. Do not insert guessed metadata, blindly enable the publisher, reuse
stale qualification, or merely lengthen the deadline. A production data change
requires separate approval and a reviewed rollout; none was performed here.

Add coverage in `typesense-watch-search-current-transcript-projection.test.ts`
for the fallback resolver's stored-row fast path making no compatibility
scan. Existing tests mock compatibility as an immediate successful promise,
so they cannot expose the production-scale cost. Add a controlled integration
case across cache expiry proving validated preparation avoids that scan and
still rejects alias/contract drift. Existing deadline tests should continue
to prove a stalled dependency fails within budget. Check pool pressure and
query plans read-only before treating metadata bootstrap as a complete remedy
for the other failed stages.

### Owner-Approved Query Fix

Further read-only measurement identified a smaller, data-preserving fix that
does not need projection bootstrap or changed cache freshness. Production
contains 164,700 transcripts and 280,107 chunks. The original compatibility
plan performs 164,700 chunk-index probes and sorts all 280,107 joined rows,
spilling about 7.4 MB to disk, to return one distinct version.

The revised SQL selects distinct compatible parent versions first and checks
for a qualifying embedded chunk per version with EXISTS. A NOT MATERIALIZED
CTE allows early exit while sharing the exact parent predicates. All provider,
model, native/stored dimension and nullable-transform checks remain; null-safe
version equality preserves refusal of null and mixed versions.

| Measurement order     | Original execution | Revised execution | Revised chunk-index probes |
| --------------------- | ------------------ | ----------------- | -------------------------- |
| Original then revised | 1,102.463 ms       | 35.984 ms         | 1                          |
| Revised then original | 1,308.563 ms       | 39.589 ms         | 1                          |

Both returned `enriched-transcript-v2`. EXPLAIN ANALYZE ran under a connection
with `default_transaction_read_only=on`, `statement_timeout=5000` and
`lock_timeout=1000`. These were bounded diagnostic reads, not a load test;
no ANALYZE, index creation or data mutation was run in production. The session
was closed afterward. Both Admin and Postgres deployment manifests use
`us-west2`; a cross-region placement mismatch was not found.

A direct projection lookup executed in 0.012 ms, versus 638 ms in the earlier
APM span. Different-time samples cannot assign that original discrepancy
between pool wait, driver wait, application scheduling and transport. Do not
claim the compatibility fix resolves every shared-pressure symptom.

The new real PostgreSQL regression calls the actual resolver against 5,000
parents and 60,000 chunks, then inspects its executed query plan. Before the
fix the bounded-work assertion failed with 60,000 chunk rows visited. After
the fix it passes, with no wall-time-dependent assertion. Ten DB tests cover
the work bound, provenance filtering, empty/mixed/null versions and non-null
transform matching. The existing service, cache, deadline, compatibility and
Yoga suites pass 122 tests. The monitor contract test passes separately.
Scoped types and changed-source lint pass; the full Admin suite was not run.

The normal PR-to-main deployment must be followed by bounded canonical-Origin
cold/warm VIDEO probes, correlated deadline-stage counts, and an observation
window covering real traffic. No production deployment, restart, pool-size
change, deadline relaxation or projection bootstrap happened in this session.

Recent October 19-20 reports establish Web rendering/queueing problems, not
the cause of this direct Admin API failure. Do not transfer their attribution
to Admin without corresponding evidence.

## Confirmed Measurement Defect

`searchResolvedTypesenseWatchSearch` starts the deadline before resolving the
profile. Previously `executeSearch` started a new latency clock afterward.
Consequently successful responses and persisted traces omitted profile time
even though that time consumed the request budget.

The patch reports elapsed time from the original bounded request start after
the service returns. It preserves ranking, the deadline, failure propagation,
and unbounded diagnostic/evaluation calls. This remains server search timing,
not browser submit-to-visible-results or complete GraphQL request timing.

Regression cases exercise the real proxy and service for VIDEO and an early
EXPERIENCE-only return. Before the fix, an inserted 100 ms preparation delay
reported approximately 11 ms and 0.25 ms. Both assertions failed. Afterward,
all 108 focused service/deadline/Yoga tests passed. Scoped TypeScript checking
reported zero diagnostics; changed-source ESLint passed. No GraphQL schema
changed. Validation commands:

```sh
pnpm --filter @forge/admin test -- src/services/typesense-watch-search.service.test.ts src/services/watch-search-request-deadline.test.ts src/graphql/queries/watch-search.yoga.test.ts
pnpm --filter @forge/admin exec eslint src/services/typesense-watch-search.service.ts src/services/typesense-watch-search.service.test.ts
```

Type checking used the Admin tsconfig options with the changed service and
test as roots, following their imports, with `noEmit` and no incremental
output. The full Admin test/typecheck suite was not run.

## Monitoring And Next Evidence

`/dashboard/search` offers trace-based counts, no-results, click rate, p95 and
request details. Traces are queued only after a service returns and are
best-effort, so thrown failures are missing from that population. The Web
direct-call path also bypasses the old canonical outcome emitter; this gap
is documented in `docs/operations/watch-search-analytics-datadog.md`.
`/api/search/health` checks embeddings and trace retention, not successful
delivery of Watch search results.

Use three complementary signals under feat-678:

1. Admin outcome counters and duration distributions covering success,
   no-result, degraded, error and timeout; retain stage-specific deadline
   warnings. Keep primary/shadow and serving modes distinct. Corrected
   latency must not be silently mixed with the old preparation-excluding
   population when comparing percentiles.
2. Browser submit-to-visible-results outcomes for transport failures and
   timeouts. Handle stale requests, retries and pagination without duplicate
   events; telemetry must not block search or add a server hop.
3. An HTTP synthetic using the anonymous canonical-Origin operation, asserting
   valid JSON, no GraphQL errors and nonempty known-query results, plus a
   browser synthetic that asserts a visible result card and settled loading.
   Proposed initial cadence: five minutes from two regions, repeated failures
   before notification. Confirm cost, thresholds and recipient before enabling.

Datadog documents both
[HTTP response assertions](https://docs.datadoghq.com/synthetics/api_tests/http_tests/)
and [browser assertions](https://docs.datadoghq.com/synthetics/browser_tests/test_steps/).
These are proposed checks, not active or delivery-verified monitors. Missing
telemetry must not imply healthy traffic. Do not add raw queries, request IDs,
content IDs or user identifiers to metric labels or new telemetry payloads.

Read-only inventory found 41 Datadog monitors and zero synthetic tests. Two
Watch-wide monitors cover client errors (`181842171`, named as a draft) and
p75 view load time (`185836643`); neither explicitly verifies search results.
No search-specific monitor was found. Existing deadline logs are already
available for a stage-grouped error monitor. A raw count monitor can catch
failures now, but an error-rate monitor needs a complete attempt denominator.

Production p50/p95/p99 for a representative search population and alert
delivery remain unverified. Retained APM spans are sampled, and the existing
completed-search traces exclude failures and preparation time. Do not present
either as an unbiased end-to-end availability/latency SLO. The next work is
normal deployment of the query fix and full-outcome instrumentation, followed
by authorized monitor creation and delivery verification.

The new `infra/datadog-monitors/watch-search/deadline-exceeded.json` template
counts at least three existing production deadline events in five minutes.
Datadog's validate-only API accepted it with HTTP 200. It has no notification
recipient and was not created or activated; threshold/destination approval
and delivery testing remain outstanding. Its source-event contract is tested.
