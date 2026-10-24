# Watch recommendation corpus review — September 21, 2026

## Decision and scope

Keep feat-496 open. The longer observation contains another selection HTTP 503;
the capability-budget call is slow, but its complete database/application cause
remains unproven. No additional open recommendation ticket meets all its closure
gates. Previously completed scoped corrections remain complete.

Read-only assessment of production Datadog request metrics, traces, logs and RUM,
plus PostgreSQL aggregates. Fixed UTC request/log window:
**2026-09-18 04:15:00 through 2026-09-20 20:50:00**, or **64 hours 35 minutes**.
This begins after the prior release follow-up and diagnostic incident recovery;
it is not a full four-day window. No synthetic browsing was added. Database
cohorts use roots created within that window; associated facts reflect the later
read snapshot and can arrive after the window. This is not a unique-human census.

Work started in a dedicated `codex/watch-recommendation-review-20260921-r9k`
worktree from freshly fetched main `2fe115f075064669df9ece2f84022acc73ae9351`.
Production reads used a separate short-lived connection with read-only
transactions, a five-second statement limit and a 500 ms lock limit. No database
settings, services, application code, curation or diagnostic settings changed.
No in-process observer or inspector was installed.

## Running release identities

Railway SSH verified these exact running revisions during this review:

| Service      | Revision                                   | Deployment                             |
| ------------ | ------------------------------------------ | -------------------------------------- |
| Admin        | `2fe115f075064669df9ece2f84022acc73ae9351` | `4fb4d092-dd0c-4815-9640-75a48454f972` |
| Admin worker | `2fe115f075064669df9ece2f84022acc73ae9351` | `45d46c25-e28c-4373-9613-cf913e961c73` |
| Web          | `964c1e3cde7ecd2ea1f3253817770527213ac11f` | `1973ef6d-bc5e-476d-9c36-c48a4c97e53e` |

Admin workflow execution remains disabled; the worker runner is enabled. Inspector
ports are closed. These current identities do not mean the whole window ran one
revision: the September 18 selection failure ran Admin `32caef0f` and Web
`c813991a`. The subsequent main changes include Subtitle Lab, a dated test fixture,
and Web hero/search presentation; none establishes a new recommendation latency fix.

## HTTP failures and semantic fallbacks

Primary Web request population comes from the production-scoped trace request
**metrics**, not a count of retained spans:

```text
sum:trace.web.request.hits{service:forge-web AND env:prod AND resource_name:post_/api/recommendations*} by {resource_name,http.status_code}.as_count()
```

Use scalar `sum` over the fixed window. Endpoint suffixes below are relative to
`POST /api/recommendations`.

| Endpoint           | HTTP 200 | HTTP 400 | HTTP 401 | HTTP 403 | HTTP 409 | HTTP 503 |
| ------------------ | -------: | -------: | -------: | -------: | -------: | -------: |
| Delivery root      |   28,931 |        0 |        0 |   36,572 |        0 |        1 |
| `/select`          |      256 |       13 |        0 |        0 |        0 |        1 |
| `/evidence`        |   71,822 |    1,250 |       27 |   34,635 |        0 |        0 |
| `/playback`        |  217,315 |      249 |      155 |   37,658 |       72 |        1 |
| `/profile`         |   77,073 |        0 |        0 |  172,656 |        0 |        9 |
| `/content-actions` |       66 |        0 |        0 |        0 |        0 |        0 |

Selection: **1 / 270 HTTP requests returned 503 (0.370%)**. Playback:
**1 / 255,450 returned 503 (0.000391%)**. These denominators include rejected
traffic; they are not human-only reliability rates. Do not equate 403 admission
rejections with internal API failures. Broader request populations are also not
the database delivery cohort below.

**HTTP 200 `delivery_timeout` count: unknown.** Persisted requests contain no
recorded timeout fallback in this cohort, but
`apps/admin/src/services/recommendations/delivery.service.ts` can return
`unavailable("delivery_timeout")` after retrieval/issuance failure without a
persisted request. `apps/web/src/app/api/recommendations/route.ts` can recover an
HTTP 200 contextual response carrying that reason. Reviewed telemetry does not
provide a complete response-envelope outcome counter. Neither zero matching
stored rows nor 28,931 HTTP 200 responses proves zero semantic timeouts.

### Remaining selection failure

At **September 18 06:26:02.748 UTC**, Web returned 503 after **739.3 ms**; the
upstream request aborted at **736.0 ms**. Admin's selection GraphQL operation took
**1,011.8 ms**. See [the retained trace](https://app.datadoghq.com/apm/trace/6aacd97a0000000044ebee408cdb1989).
There are no later selection 503s in the fixed request-metric window. That healthy
tail does not establish the cause or eliminate the semantic visibility gap.

The capability-budget `queryRaw` span took **406.9 ms**; its
`consume_recommendation_capability_submissions` query span took **275.9 ms**.
The Prisma connection child recorded **0.0027 ms**. Other work includes a
served-item lookup (**270.8 ms**), serving-control lookup (**106.2 ms**) and main
transaction (**226.2 ms**). These are nested/client-observed durations, not
independent PostgreSQL execution or wait samples. Do not sum overlapping spans.

This trace supplies no matching PostgreSQL wait sample proving WAL sync or lock
contention, and the tiny connection child does not measure every possible queue.
The earlier WAL-sync observation remains a hypothesis clue, not the established
cause of this new failure. Separate server execution, commit/lock/pool waits,
network and application scheduling in the next bounded investigation.

A narrow database time correlation found one persisted, claimed, attributable
selection in the failure interval. This supports the lost-acknowledgment concern;
it is not a durable trace-to-row identity join. Do not introduce ambiguous
selection retries. No new code fix or root-cause claim is made by this review.

## Durable recommendation and playback data

All **28,678 persisted request roots** are seeded, issued deliveries:

| Result                             |       Requests |
| ---------------------------------- | -------------: |
| Served                             |         24,104 |
| Fallback                           |          1,292 |
| Empty                              |          3,282 |
| Six composed cards, across results | 16,841 (58.7%) |
| One to five cards                  |  8,555 (29.8%) |
| Zero cards                         |  3,282 (11.4%) |

Stored retrieval latency: **p50 96 ms, p95 241 ms, p99 335 ms, max 1,246 ms**.
This successful-persistence cohort excludes some deadline failures and measures
retrieval, not complete response or browser acknowledgment latency.

The root cohort has **125,712 served items**, **64,812 rendered facts** across
11,252 requests, **7,310 impressions** across 1,795 requests, and **257 selections**.
Of those selections, **252 were claimed** and **256 were attributable**. There
were **zero attribution markers without an impression** and **zero invalid
selection/impression receipt orderings** in the audited cohort. These scoped
checks support the timestamp correction; they do not prove every integrity gate.
Below-fold delivery does not imply visibility, so these aggregates are not a
matched experiment CTR or a causal recommendation-quality result.

**3,508 deliveries used `hybrid_personalized` execution (12.2%)**. Another 22,089
used contextual execution with `profile_cold_start`. The window contains 31,555
published durable projection generations, including 4,150 with durable interests;
these are generations, not distinct people. Retained projection runs in the
creation cohort include 20,546 completed and 173 fenced; no failed/pending/claimed
row was returned in that cohort. This is not a global backlog audit.

For episodes created in the window, collected facts include **77,444 progress**,
**64,313 viewing-mode**, **34,790 active-visible playback**, **23,598 navigation**,
**18,516 QoE** and **10,194 seek** facts. The latest `active-watch-proxy-v1`
outcome per episode/classifier contains **3,744 qualified episodes**, including
**91 with recommendation discovery provenance**. All reviewed outcomes retain
`learning_eligible=false`; that flag has a separate gate from profile eligibility.
An episode lifecycle state of `timed_out` is not an HTTP timeout.

### Coverage and rejected evidence need investigation

Of the empty slates, **2,813** record `no_candidates` and **469** record
`seed_embedding_unavailable`. Most partial slates record `insufficient_candidates`;
seven record `eligibility_exhausted`. These reason codes justify coverage work,
but do not prove a composer defect or justify weakening eligibility.

The leading locale breakdown includes **Telugu 213/213 empty**, **Chinese 207/207**,
**Nepali 112/112**, **Romanian 108/108**, and **Afrikaans 95/95**. English has
19,739 persisted requests: 669 empty, 8,540 partial and 10,530 full six-card slates.
These are **UI locale values**, not proof of selected audio language or human
traffic. All roots here are seeded; feat-497's source-free curated-pool gate is a
different population. First trace actual locale/audio/seed/material eligibility
and distinguish expected unsupported contexts from fixable retrieval gaps.

Stored audits contain **968 `delivery_timestamp_invalid`** rejections and
**3 `selection_timestamp_invalid`** rejections. These validate client event times
against signed capability issuance/expiry, whereas the fixed timestamp race was
server receipt ordering. The aggregate does not establish clock skew, expiry,
a client defect or abuse as their cause. Reconcile reason-coded rejection rates
under feat-464 before changing any timestamp validation.

## Operational and PostgreSQL health

Structured evidence logs contain one ambiguous selection and one ambiguous
playback-facts HTTP 503, plus **174 Admin facts failures with `reason=unknown`
and retryable disposition**. Busy-transaction observations are retry attempts,
not 174 or thousands of extra primary HTTP failures. The complete returned
failed/ambiguous reason grouping contains no `transaction_exhausted` observation.
No accepted recognized-crawler event appeared in the queried structured evidence
logs; this does not by itself audit all stored machine provenance.

There are **749 completed reconciliation heartbeats**, from September 18 04:19:58
through September 20 20:46:55, and no unavailable heartbeat in that query.
Counts alone do not prove uninterrupted five-minute cadence across deployments.
Recommendation/Forge title searches and Admin/Web service-tag searches found no
required recommendation monitors. This is the visible inventory, not proof of
absence from an inaccessible organisation/account.

A current-pointer audit using the canonical predicates in
`profiles/profile-lineage.ts` was explained, then attempted once with the
five-second statement guard. PostgreSQL canceled it (`57014`), and the transaction
rolled back. **There is no fresh complete zero-ineligible-pointer result from
this review.** Do not weaken its predicate or turn a sample into feat-459 closure.
Use a separately bounded, supported Admin audit to complete that gate.

The database snapshot shows **zero cumulative deadlocks**, but that does not
exclude lock waits. Timing counters are not a historical wait profile. The
largest recommendation relation is `recommendation_candidate_stage_evidence`:
approximately **13.30 million rows / 12.34 GiB including indexes and TOAST**.
Its latest autovacuum was September 20 18:04 UTC, with zero estimated dead tuples.
These are statistics estimates and total retained size, not window growth or
proof of bloat. Current `pg_stat_activity` cannot reconstruct a September 18 wait.

Three daily retention runs succeeded. No expired request roots were pending at
the snapshot. The oldest root is September 1; first root expiry is **September 30
00:20:47 UTC**, so zero deleted roots so far is expected, not proof that the first
large root cascade will be cheap. Review that capacity boundary under feat-396.
The database's large cumulative temporary-file byte counter has no window reset;
it must not be attributed to recommendations or this 65-hour window.

## Field browser errors are separate work

On current Web revision `964c1e3c`, the fixed RUM window contains **742 React #418
errors across an estimated 733 distinct views** for Chrome, Chrome Mobile, Safari
and Mobile Safari. Cardinalities are approximate and not additive across groups.
**706 events are text mismatches and 36 are HTML mismatches.** Mobile Safari alone
has 368 text errors across 368 views. Public paths include `/watch`, JESUS and
other Watch routes. Separately, Googlebot produced 435 current-release errors
across only five views: raw event counts substantially inflate that cohort.

Browser names do not certify a person, and sampled RUM does not give a population
error rate. Still, these observations cannot be dismissed as only Googlebot
repeats. The grouped issue does not prove the same responsible component or a
regression of feat-517's reproduced autoplay correction. Preserve that closure;
[feat-523](../roadmap/platform/feat-523-watch-field-hydration-mismatch-attribution.md)
owns separate text/HTML field attribution and a demonstrated correction.

## Ticket decisions and next work

| Ticket                                             | Decision                  | Remaining gate / next action                                                                                                                    |
| -------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform 513, 516, 517; content-discovery 515, 509 | Keep complete             | Their scoped fixes are shipped; do not turn them into a claim of universal recovery. Mobile tickets with duplicate IDs are outside this review. |
| Platform 496                                       | Keep in progress          | One additional selection 503; prove the remaining cause and collect complete semantic delivery outcomes.                                        |
| Content-discovery 470                              | Keep in progress          | Healthy retained retrieval times do not cover failed persistence, complete delivery or all funnel gates.                                        |
| Content-discovery 464 / 459                        | Keep open                 | Required alert verification, unknown/rejected evidence classification and a fresh complete current-pointer audit remain.                        |
| Content-discovery 447                              | Keep open                 | Aggregate personalized activity does not demonstrate the required complete browser-to-profile-to-later-hybrid journey.                          |
| Content-discovery 393 / 370                        | Keep open                 | Corpus growth does not implement outstanding composer adapters/calibration or navigation/QoE readiness and breakdowns.                          |
| Content-discovery 497 / 396                        | Prioritize bounded audits | Verify actual coverage contexts and capacity before the first root-retention boundary; no republishing or infrastructure increase inferred.     |
| Content-discovery 520 / 521                        | Keep open                 | No new paint/native renderer causal capture establishes their closure.                                                                          |
| Platform 523                                       | New follow-up             | Attribute remaining current-release text and HTML hydration mismatches independently.                                                           |

Recommended order: finish feat-496's outcome observability and bounded
capability-budget investigation; complete feat-464/459's explicit gates; reproduce
feat-523; then use the corpus to prioritize coverage and retention capacity.
Do not enable learning, experiments or broader rollout solely from these counts.

## Durable review rules

1. Fix the observation window, service/environment tags and running revisions;
   separate request metrics from retained spans, logs, RUM views and database roots.
2. Keep HTTP failures, HTTP 200 semantic fallbacks, browser aborts and browser
   hydration errors as separate outcomes. Persistence-only analytics omit some
   failures by construction.
3. Separate server receipt ordering from capability event-time validation, and
   episode lifecycle timeout from transport timeout.
4. Deduplicate RUM by view and distinguish crawler repeats. A shared issue group
   does not establish a shared cause.
5. Stop bounded diagnostics at their guard. An incomplete canonical audit is an
   incomplete gate, not permission to substitute a weaker query.
