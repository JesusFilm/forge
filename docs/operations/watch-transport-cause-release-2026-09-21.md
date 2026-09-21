# Watch transport-cause diagnostic release — September 21, 2026

## What shipped and what it proves

PR [#2364](https://github.com/JesusFilm/forge/pull/2364) merged normally at
06:14:25 UTC as `d0c749b981b8c3cf777c6e62bd9e5eae1abbd2bf`. It adds an
optional finite `networkErrorCode` to existing evidence observations after two
fast playback fetch failures during Admin handovers. It does not fix the unknown
transport cause, change retries or deadlines, or close the historical
capability-budget/WAL investigation. The
[startup and module-reuse record](watch-startup-readiness-2026-09-21.md) contains
the independently proven performance fixes, real workload controls and failures.

Fresh main `fa5a836003f3294d8cccc6eac453c74e56b3ec37` was incorporated before
merge. Final PR CI `35567189878` passes all required checks: 4,493 Web tests,
7,288 Admin tests, 113 PostgreSQL tests, Admin and Web Redis checks, lint, builds,
schema and repository guards. Main `forge-ci` run `35567596581` also passes.
Main CodeQL run `35567596054` passes; Web leaves its waiting state after that
scan completes. No required check was bypassed to advance the deployment.
Sequential Compound Engineering review found no introduced code blocker; it was
not an independent-agent review. The initial unrelated Web render-count failure
and its unchanged passing reruns remain in the linked record.

The [existing outcome-accounting learning](../solutions/logic-errors/recommendation-outcome-accounting-boundaries-20260921.md)
now documents bounded cause extraction, real socket/refusal tests, propagation
through the API adapter and the distinction between a network label and safe
mutation retry. No persistent production diagnostic settings or records changed.
Transaction-local audit settings ended with rollback/disconnect. Both labelled local
test containers were stopped after validation; other agents' services were left
alone.

## Independent deployment verification

| Service | Deployment                             | SSH verification UTC | Revision    | Runner |
| ------- | -------------------------------------- | -------------------- | ----------- | ------ |
| Admin   | `35e6abff-3f59-464e-8769-fbed87659e67` | 06:22:22.872         | `d0c749b9…` | false  |
| Worker  | `f8f3e18a-1d61-4db0-a5cc-7411886d9bcf` | 06:22:23.028         | `d0c749b9…` | true   |
| Web     | `ca4c2f1c-30d6-493e-9e87-82dbb7460991` | 06:34:51.712         | `d0c749b9…` | n/a    |

Both built configurations retain `@mastra/core` and `@mastra/memory` as the
exact external-package list. Admin runs Node 24.21.0 and the worker 24.20.0;
their health routes return 200. Health and deployment status are initialization
evidence, not selection-latency measurements. No direct local deployment or
manual Railway redeploy was used.

Before the Web replacement, a bounded read of the active playback route's traced
JavaScript at 06:10:39 UTC verifies revision `1cb15d6…`, deployment
`eacd4352-e2a4-4f20-bea0-9be5ac57d95c`: the evidence event exists, but the
`networkErrorCode` field does not. The check reads 17 traced JavaScript files
(1,488,077 bytes), without importing application modules or changing the process.

The replacement Web is successful. The same read of its actual playback-route
dependency trace finds both the evidence event and `networkErrorCode` in 17
JavaScript files (1,488,463 bytes), without reaching either diagnostic limit.
This verifies the built diagnostic is present on the exact running revision; it
does not prove that a natural failure has exercised it or establish a transport
cause. Web runs Node 24.21.0.

At **06:35:04 UTC**, the new Web's anonymous availability route returns HTTP 200
`{enabled:false}`. A bounded Admin SQL read at the same time finds one published
English `watch-home` locale and zero authored `homepageRecommendations` blocks.
The code-defined flag default remains false. No feature flag, authored content,
curation, Mobile/TV UI or account-linking behavior changed.

## Closed pre-diagnostic traffic window

The fixed **05:41–06:00 UTC** window, re-read after ingestion settles, has:

| Endpoint        | HTTP 200 | HTTP 403 | HTTP 5xx | Total |
| --------------- | -------: | -------: | -------: | ----: |
| Seeded delivery |       83 |       85 |        0 |   168 |
| Selection       |        3 |        0 |        0 |     3 |
| Playback        |      648 |       73 |        0 |   721 |

Railway has all 168 final delivery envelopes, with no repeated or unrecognized
rows. Datadog has 167: 82 HTTP 200 and 85 HTTP 403. The extra Railway outcome is
one ordinary six-card `no_candidates` fallback. Across the complete Railway
population, the 83 HTTP 200s are 68 served responses, nine
`seed_embedding_unavailable` fallbacks and six `no_candidates` fallbacks.
There are zero delivery/retrieval-timeout fallbacks. Three successful selections
in nineteen minutes cannot establish sustained recovery.

A fifteen-minute Railway log-query slice returned `Problem processing request`
twice. Bounded five-minute slices completed and independently reconciled the
population. A separate single-deployment metadata diagnostic returned HTTP 403;
the already authorized project-scoped deployment list remained available. These
are diagnostic API failures, not Watch endpoint failures. Never interpret a
collector error as a healthy empty stream.

The fixed **06:20–06:28 UTC** Admin-handover window still runs Web `1cb15d6…`.
It has 51 seeded-delivery HTTP 200s and 23 HTTP 403s, all 74 matched by indexed
final envelopes. The 200s contain 24 served responses and 27 ordinary coverage
fallbacks (22 `no_candidates`, five `seed_embedding_unavailable`), with zero
delivery/retrieval-timeout fallbacks. Playback has 410 HTTP 200s, 22 HTTP 403s
and two HTTP 401s, with no 5xx. There are **zero selections**. These observations
do not validate the new Web field or demonstrate selection recovery.

## Fixed post-diagnostic window

The **06:35–06:40 UTC** population is entirely Web revision `d0c749b9…` in
primary metrics and the observed indexed `@ddtags` values. All **55 seeded
delivery outcomes** reconcile across primary HTTP counts, Railway and Datadog:
17 HTTP 200 and 38 HTTP 403 (24 fetch-metadata rejections, 14 origin rejections).
The 200s are 16 served responses and one six-card `seed_embedding_unavailable`
fallback. Nine served responses contain six cards; the others contain two,
three or five. There are **zero delivery/retrieval-timeout fallbacks**.

Playback has **80 HTTP 200s and 30 HTTP 403s**, with zero 5xx. There are **zero
selection requests** and no natural 5xx observation exercising the new network
code. The single availability GET in the metrics is the explicit homepage-flag
diagnostic, not a selection or delivery request. No failure or viewer evidence
was manufactured to exercise the new field. This five-minute window confirms
outcome collection on the release, not sustained API recovery, selection
acknowledgment performance or the remaining transport cause.

## Fresh integrity and outstanding operational gates

At **06:23:30.007 UTC**, the unchanged canonical predicate checks all **168,834
current pointers** and finds **zero ineligible**, in 1,502 ms. This is a complete
repeatable-read, read-only snapshot with the five-second statement and 500 ms
lock guards intact. It is not a continuous-zero claim or an authenticated Admin
trace. The shared scheduler ledger shows a **06:22:26 UTC** batch completed with no
classifications, affected pointers, rebuilds, failures, exhaustion or stale runs.
A later read at **06:39:01 UTC** sees another completed batch at **06:37:43 UTC**
with the same zero-work/zero-failure result. Neither zero-work batch is a substitute
for the earlier representative reconciliation workload and two-hour observation.

A fresh paginated inventory around 06:15 UTC still has 41 Datadog monitors and
no required recommendation transport/reconciliation coverage. No monitor write
was attempted under the owner's read-only restriction. The browser/Admin
authorization and operational fallback/publication gates remain as listed in
the [current closure table](watch-startup-readiness-2026-09-21.md#current-closure-gates).
Retain all four tickets in progress. Keep the previously completed two-hour
corpus, lifecycle/erasure proof and restored-snapshot performance evidence under
their own documented scope; do not repeat them or silently weaken unmet gates.
