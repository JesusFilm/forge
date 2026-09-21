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

## September 21 execution checkpoint

- U1 shipped in PR #2352. Exact Web revision and 84/84 event-to-primary-request
  reconciliation are recorded in the [execution report](../operations/watch-ticket-execution-2026-09-21.md).
- U3's hybrid-count and typed-error observation fixes shipped in PR #2353;
  Admin/worker revisions are verified. The complete 167,029-pointer snapshot
  audit passed. Installed alerts and the full lifecycle remain unmet.
- Monitoring caught a separate fast playback transport 503 and one unavailable
  reconciliation batch. The expensive discovery scan was reproduced with bounded
  read-only controls; JIT and materialization did not establish a fix, and a
  smaller metadata-reuse candidate was not shipped without full validation.
- U2 remains unproven. None of these measurements establishes the cause of the
  earlier selection deadline failure.
- U4's Chromium/WebKit probes did not reproduce the remaining hydration variants;
  headless selection rejections cannot validate eligible acknowledgments. Field
  paint/commit attribution, curation expansion and full capacity gates remain.
- Final sequential CE review and the [durable accounting lesson](../solutions/logic-errors/recommendation-outcome-accounting-boundaries-20260921.md)
  preserve the measurement distinctions and rejected hypotheses. This plan stays
  active; no broad ticket is closed from a short release window.

## Continued execution: bounded reconciliation discovery

Resume on freshly fetched main `7b39077634b72866f281842cb05f2018d535429e`
in the dedicated `codex/watch-closeout-20260921-t8p` worktree. The owner has
already authorized implementation, normal merges, deployment verification and
continued ticket closeout; documenting remaining work is not completion.

Testable hypothesis: correlated lineage checks repeat index probes for every
current pointer even when nearly all pointers are healthy. A set-based invalid
generation discovery can preserve the canonical rules while removing repeated
per-pointer work. The earlier generation-metadata reuse experiment alone did not
provide sufficient transaction headroom.

1. Build an owned PostgreSQL fixture matching the aggregate production pointer,
   generation, interest and contribution populations. No production identifiers
   or evidence rows are copied.
2. Compare exact invalid-generation results with the unchanged canonical helper
   across every invalidation class, active-run exclusion and ordering boundary.
3. Measure complete discovery transactions at representative scale and under
   competing reads/writes. Keep the five-second transaction budget and existing
   advisory locks, dispatch fences and serving eligibility checks.
4. Ship only after regression/performance validation, sequential CE review,
   refreshed-main checks and normal PR CI. Verify automatic deployment and a
   minimum two-hour reconciliation/evidence observation while continuing the
   independent delivery, selection and browser gates.

## September 21 sustained release checkpoint

PR #2356 deploys the proven reconciliation correction as `de752d60980b25ee11806f2c424770fc78027188`.
The [complete two-hour release record](../operations/watch-closeout-release-2026-09-21.md)
reconciles all 1,536 delivery requests/outcomes, separately reports 0/65 selection
5xx and 0/9,787 playback 5xx, and retains zero semantic timeout envelopes alongside
ordinary coverage/rate-limit fallbacks. All 24 reconciliation batches pass; a
post-observation canonical audit converges to zero among 167,984 current pointers.
Earlier nonzero snapshots and collector differences remain documented.

Feat-470's deployed ANN repair now closes after current PostgreSQL regression and
complete-service production observation. Real qualified-playback, hybrid influence,
withdrawal, reset and completed-erasure canaries strengthen feat-447. U2's selection
cause and U4's field browser causes remain unproven; U3's installed alerts and
permission-checked Admin gates remain unmet. Keep this overall plan active.
Sequential CE review tightened browser acknowledgment assertions; the six corrected
production controls pass. The existing accounting learning incorporates those
boundaries rather than creating a duplicate solution document.
