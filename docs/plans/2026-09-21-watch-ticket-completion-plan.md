---
title: "Complete the remaining Watch recommendation reliability gates"
type: fix
status: active
date: 2026-09-21
---

## Scope and ordering

Execute the September 21 assessment and the owner's authorization to work through
its open Watch tickets. Start with feat-496, then feat-464/459 and feat-523; inspect
feat-470/447/520/521 and the coverage/capacity gates as their dependencies allow.
Existing completed fixes stay complete. Each code change has a bounded scope,
causal evidence, meaningful validation, Compound Engineering review and normal
PR/main deployment. Ticket closure requires its full evidence gate.

Keep the authored English homepage block removed and its flag default off. No
Mobile/TV UI, account linking, curation republishing, weaker identity/attribution,
rate-limit changes, deadline inflation or ambiguous mutation retries. No shared
local services or databases may be mutated without ownership verification.

## U1: Observe delivery outcomes that persistence cannot count

Execution note: test-first. The root and `for-you` Web route handlers return
semantic envelopes without an outcome event. Failed Admin issuance can leave no
request row; HTTP 200 contextual recovery preserves `delivery_timeout` while
HTTP request metrics show success. Existing evidence logs cover selection and
playback, not these envelopes.

Add one bounded event per completed handler response. Record endpoint, HTTP
status, final result, normalized reason, card count and upstream result for
contextual recovery. Include rejected/failed HTTP responses in a separate
classification. Use the existing server-console ingestion path, a closed
vocabulary, and no identifiers, capabilities, content paths, user agents or
request bodies. Observer failures cannot change delivery. Do not add database
writes or an awaited network dependency. This fixes the measurement gap; it does
not claim a latency correction or browser receipt.

Files: `apps/web/src/app/api/recommendations/{route,for-you/route}.ts`, a small
`apps/web/src/lib/recommendation-delivery-observability.ts` helper and colocated
regressions. Test served, semantic fallback, contextual timeout recovery, empty,
upstream rejection, invalid input, disabled source-free row, oversized response,
unknown values, identifier exclusion and a throwing logger. Verify production
indexed event receipt and reconcile with the corresponding request population.

## U2: Prove the remaining selection delay

Use existing retained traces and a representative owned PostgreSQL/Prisma load
fixture. Distinguish driver acquisition, database execution/lock/commit waits and
application scheduling. The independently committed capability budget and its
32-attempt bound must survive failed selection transactions. WAL-sync and catalog
contention are hypotheses, not established complete causes. Reproduce before
changing runtime logic. Preserve negative controls from September 18. Any added
instrumentation must use supported, locally tested interfaces; never install
production callback monkeypatches or enumerate the running heap.

## U3: Complete integrity and operational gates

Inspect the canonical current-pointer audit and retain its full predicate. A
bounded query cancellation is not a successful audit. Verify and, where access
allows, implement the required Datadog monitoring without adding recipients or
sending messages. Classify unknown retryable and capability-timestamp rejections
without weakening validation. Reconcile current projections and human/crawler
provenance before closing feat-464/459 or the dependent lifecycle pilot.

## U4: Reproduce remaining browser and coverage findings

Investigate feat-523 text/HTML variants independently from the completed autoplay
fix. Use matched browser/cache/locale conditions and actual hydration differences;
verify navigation and loading performance. Keep native commit/paint attribution
separate. For coverage/capacity, inspect actual locale/audio/seed eligibility and
an owned retention fixture; do not republish curation or enable learning.

## Verification and closure

Run focused regressions first, then affected application checks, meaningful real
PostgreSQL/performance tests where behavior changes, format and required CI.
Fetch newer main before merging and revalidate affected changes. Verify exact
running revisions through Railway after automatic deployment. Report HTTP
failures, semantic timeout fallbacks and browser errors/aborts separately; extend
observation as required rather than using a short healthy window as closure.

At the end, run sequential Compound Engineering review per the repository's
Codex tool map and compound durable findings into `docs/solutions/`. Update each
touched ticket honestly, retaining any unproven cause, inaccessible gate or
observation still needed. Do not mark this overall plan complete while required
work remains.
