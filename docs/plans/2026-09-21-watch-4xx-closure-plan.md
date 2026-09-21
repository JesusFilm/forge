---
title: "Complete Watch evidence, reconciliation, personalization and runtime gates"
type: fix
status: active
date: 2026-09-21
---

## Scope

Finish content-discovery feat-464, feat-459 and feat-447, and platform feat-496.
The owner explicitly requests completion, including normal PR/main merges and
production verification. Feat-470 is already complete. Browser follow-ups
feat-520/521/523 and curation expansion are outside this continuation.

Continue the implementation and evidence in
`docs/plans/2026-09-21-watch-ticket-completion-plan.md` and
`docs/operations/watch-closeout-release-2026-09-21.md`; do not repeat completed
work or reinterpret healthy observations as a fix for an unproven cause.

## U1: Resolve evidence admission and operational gaps (feat-464)

Characterize first. Reconcile final delivery rejections with retained primary
request traces and trusted crawler classification. A browser-shaped user agent
does not establish humanity, and sampled traces do not cover the full population.
Keep invalid-origin, fetch-metadata rejection, evidence admission, HTTP failures
and successful HTTP timeout envelopes separate. Preserve strict admission rules.

Validate the existing monitoring definitions against actual ingested production
fields and known positive events. Correct demonstrated query/configuration defects
under `infra/datadog-monitors/recommendation-evidence/`; verify negative controls
and payload/schema validity. Existing read access can verify definitions and
installed objects but cannot establish installation by itself.

Inspect terminal claim/fact responses and the actual browser retry state machine
in `apps/web/src/lib/` and `apps/web/src/components/watch/`. Regressions must cover
lost acknowledgement, exact replay, conflict, abort, terminal binding errors and
fail-open playback. Use colocated existing tests; add cases only for genuine gaps.

## U2: Finish profile and lifecycle gates (feat-459, feat-447)

Reconcile an actual affected generation through immutable evidence, superseding
eligibility, fenced serving, replacement and later clean delivery. Verify the
same aggregate/trace through the permission-checked Admin Recommendations area.
Use an existing authenticated operator session; never manufacture authorization.
Inspect publication/fallback tests in
`apps/admin/src/services/recommendations/profiles/` and full-service delivery tests.
Prove stale-publisher rejection and last-known-good fallback independently in an
owned production-representative fixture before any production-safe canary.
Do not alter production rows, control pointers or privacy state to manufacture
acceptance evidence. Preserve the already completed lifecycle/privacy canaries.

## U3: Resolve selection latency (feat-496)

Separate PostgreSQL execution/lock/commit waits, driver/pool acquisition and
application scheduling. Start from the retained failing traces and supported
runtime instrumentation. Form a falsifiable workload hypothesis and reproduce in
an owned database/process. No inspector, runtime callback monkeypatches or heap
enumeration. Preserve the separately committed capability submission budget,
32-attempt bound, transaction guarantees and 700 ms Web/Admin deadline.

Only ship a correction supported by a failing control and passing regression,
complete transaction/service performance and representative concurrency tests.
If existing observations cannot distinguish causes, ship the smallest supported,
bounded diagnostic improvement with its overhead and privacy tests; keep this
explicitly distinct from a latency fix.

## Closure and release

### Proven startup subproblem (September 21)

Two new delivery-timeout envelopes coincided with Admin startup. A local
production-build CPU profile identifies Next 16.2.4's unawaited
`unstable_preloadEntries()` loading dashboard entries while health already
returns 200. Five fresh processes reproduce real selection acknowledgments at
926–949 ms immediately after readiness, above the unchanged 700 ms caller budget.

Expose the framework's existing preload promise with a pinned pnpm patch and
await it in production Admin readiness. Also import the GraphQL handler before
200 because Next silently skips individual failed preloads. Missing completion
state or failed GraphQL initialization must never report healthy. Other Next
applications keep their existing readiness behavior. Keep the 60-second Railway
healthcheck limit and all public API deadlines unchanged.

Reject schema/handler-only warming (startup loading still competes with traffic)
and disabling preload (moves loading onto the first dashboard visit). Compare
fresh-process selections and cold-editor concurrency against the same build with
the original health handler. The latter already exceeds 700 ms on the baseline;
the startup correction does not establish a cause or fix for every later stall.
Review patch compatibility, install/frozen-lock behavior, failed initialization,
real `next start` behavior and production deployment admission before release.

Use sequential Compound Engineering review per the repository tool map. Fetch
new main and rerun relevant checks before every normal squash merge. Verify
running revisions after automatic deployment, then the required sustained
production populations and canonical current-pointer audit. No direct deployment.

Close each ticket only when its own requirements and dependencies are satisfied.
Retain inaccessible operational checks as explicit unmet requirements. Compound
durable findings into the existing relevant solution documents where possible.
Keep the authored English homepage block removed, its feature flag default off,
and all identity, authorization, attribution, rate-limit and integrity guarantees.
