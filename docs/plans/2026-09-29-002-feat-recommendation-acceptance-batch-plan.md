---
title: Recommendation exposure and shadow acceptance batch
type: feat
status: active
date: 2026-09-29
---

# Recommendation exposure and shadow acceptance batch

## Summary

Finish anonymous Watch served evidence, establish bounded production co-watch
shadow evidence, and disposition the retained telemetry discrepancies. Extend the
existing implementations and preserve their distinct acceptance gates through
reviewed PRs and ordinary deployment.

The source requirements are feat-373, feat-387, feat-545 and the September 29
owner instruction. This continues
`docs/plans/2026-09-28-001-feat-recommendation-batch-integration-plan.md` and
`docs/operations/recommendation-batch-review-2026-09-28.md` from fetched main
`1c3a3761d0524b25d67427675228214814b84185`.

---

## Requirements and boundaries

- Anonymous registered Watch surfaces need truthful server-issued served facts.
  Served, rendered, eligible, selected, repeat, replay and visibility capability
  remain separate; early selection never manufactures an impression.
- The owner chose to retain fallback home carousel, fallback home grid and video
  editorial as explicit unresolved coverage gaps for this batch. Do not restore
  public producers or retire registry entries under this scope decision; feat-373
  remains open while those coverage gates are unmet.
- Co-watch remains shadow-only. A production run requires deployed revision and
  migration verification, eligible source and pair bounds, current integrity
  decisions, retention and a capacity preflight coordinated with the storage
  owner. Insufficient data and refused bounds are valid recorded results.
- Every telemetry discrepancy needs evidence or an explicit owner decision.
  Requests, batches, events and browser resources retain their own populations;
  newer success cannot repair missing historical joins.
- Preserve crawler/speculative admission before writes, compact traces, mixed
  readers, privacy fences, bounded retention continuation and live delivery.
- No feature-flag changes, pilot widening, experiment activation, live co-watch
  promotion, manual deployment, direct production SQL repair, fault injection,
  destructive production tests, conversion expansion, Datadog setup, or
  Slack/email messaging. Evidence must contain no secrets or raw identities.
- Feat-505 remains the later controlled usefulness decision. Exposure is not a
  new prerequisite for it. Staging Auth recovery remains feat-561's scope.
- The storage task owns capacity and the first nonempty retention purge; avoid
  competing writes during its currently confirmed verification windows. The
  September 30 and October 1 dates were the initial planning context; use the
  owner's latest confirmation for execution timing.

---

## Ownership and integration decisions

Three native GPT-6 Sol tasks own isolated branches and worktrees. Their effective
permissions are checked before substantial dispatch. Each may delegate concrete
independent work to built-in subagents and must review the results.

| Owner         | Owned scope                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-373 task | Exposure Web/Admin code, tests, ticket and evidence                                                                                             |
| feat-387 task | Co-watch verification, narrowly demonstrated fixes, ticket and evidence                                                                         |
| feat-545 task | Retained evidence, targeted read-only checks, decision record and ticket; runtime edits coordinated first                                       |
| Parent        | Shared roadmap index, reciprocal dependencies, ID/migration allocation, contract review, integration, exact-head merges and deployment receipts |

Migrations 0103 and 0104 already implement exposure and co-watch storage. The
storage owner's reclamation preparation adds no migration. Allocate any further
number only after reviewing the demonstrated schema need. Coordinate changes to
`apps/admin/prisma/schema.prisma`, retention, curated database fixture migration
lists, Pothos assembly, `apps/admin/schema.graphql` and
`packages/admin-graphql/src/admin-graphql-env.d.ts`. Generate both GraphQL outputs
from source; never edit them by hand.

New Web payloads or issuance operations require a compatible Admin fleet before
Web release, including changes carried inside opaque GraphQL JSON inputs.
Prefer an existing compatible contract where it meets the requirements. A
deployment receipt must name actual active revisions for Admin web, Admin worker
and Watch web; a queued/building deployment is insufficient.

---

## Implementation units

### U1. Complete anonymous served evidence

**Goal:** Advance feat-373 by extending the existing exposure contract.

**Files:** `apps/web/src/components/watch/`,
`apps/web/src/components/recommendations/WatchExposureBoundary.tsx`,
`apps/web/src/app/api/recommendations/surface-exposure/route.ts`,
`apps/web/src/lib/recommendations.ts`,
`packages/admin-graphql/src/operations/recommendations.ts`,
`apps/admin/src/graphql/mutations/recommendation-evidence.ts`,
`apps/admin/src/services/recommendations/watch-surface-exposure.service.ts`,
`apps/admin/src/services/recommendations/watch-surface-registry.ts`,
`apps/admin/src/services/recommendations/admin-ops/watch-exposure.service.ts`,
its colocated tests and `watch-exposure.service.db.test.ts`, and
`docs/roadmap/content-discovery/feat-373-watch-surface-impressions-ctr.md`.
The implementation task records exact additional entry points in its scoped plan.

**Approach:** Define the server-issued denominator before selecting a transport.
Keep cached content identity separate from per-delivery and placement identity.
Reuse traffic admission and bound all ingestion. Coordinate any shared contract
or schema edit with the parent before implementation.

**Test scenarios:** Repeated authored blocks and item reorder; crawler and
speculative exclusion; activation and navigation replay; rendered but below-fold
cards; hidden-tab dwell; unsupported occlusion; early selection; duplicate and
repeat receipts; expiry-only saturation; old/new producer-consumer combinations;
historical anonymous cohorts retaining unknown served counts; unavailable
issuance/telemetry without delayed navigation or player startup.

**Verification:** Scope tests, real browser behavior and comparative load evidence;
after ordinary release, an authorized bounded Admin window reconciling all
registered surfaces, CTR denominators, duplicates, capability, ingestion health
and remaining gaps. Local proof alone does not complete the ticket.

### U2. Establish bounded production co-watch shadow evidence

**Goal:** Advance feat-387 using the reviewed generation and evaluation operators.

**Files:** `apps/admin/src/services/recommendations/cowatch/`,
`cowatch/graph.test.ts`, `cowatch/projection.db.test.ts`, shadow evaluation and
Admin inspection entry points, and
`docs/roadmap/content-discovery/feat-387-profile-conditioned-directional-cowatch.md`.

**Dependencies:** Storage-owner timing clearance and passing bounded preflight
before production writes; no dependency on U1.

**Approach:** Verify revision, migrations, latest classifier-specific outcome per
episode before graph eligibility filtering, integrity, eligible sources, expected source/pair work,
retained target size and headroom. Keep the 50,000-source, 256-row per-session and
250,000-attempted-pair bounds; retained pair contributions are a separate count.
Preserve evaluation ID, closed window, sample size, minimum runs and dispatched
workflow receipt before retry. The repaired CLI requires and emits the explicit
retry tuple; dispatch atomicity and crash recovery remain tracked by feat-563.
Capture generation coverage, directional metrics, contamination, anchors,
overlap, latency, sparse/stale fallback and actual terminal decision.

**Test scenarios:** Revision replacement, denominator-only lineage, privacy
suppression, same-state eligibility revisions, exact rebuild equivalence,
missing/stale generation, sparse edges and refused limits. Use fixtures for
destructive scenarios, with natural production evidence where available.

**Verification:** Production generation/evaluation receipts reconciled in
authorized Admin. Record insufficient data or refusal without loosening limits.
Shadow overlap does not establish causal usefulness or authorize live influence.

### U3. Resolve bounded telemetry closeout

**Goal:** Advance feat-545 without restarting the broad audit.

**Files:** `docs/operations/recommendation-evidence-acceptance-2026-09-23.md`,
`docs/operations/recommendation-evidence-telemetry-followup-2026-09-28.md`,
their `docs/validation/evidence-acceptance-*` artifacts, a new bounded closeout
record and `docs/roadmap/content-discovery/feat-545-recommendation-monitoring-and-telemetry-closeout.md`.

**Approach:** Enumerate source gaps before querying. Resolve recoverable
differences using retained records and narrowly targeted reads. For irrecoverable
gaps, specify missing evidence, consequence, proposed bounded limitation and
affected downstream gates. The proposal is not owner acceptance.

**Test expectation:** No runtime tests for documentation-only reconciliation.
Validate source arithmetic, populations, windows, links, formatting and roadmap
metadata. Demonstrated consequential runtime defects require a separately
coordinated repair and regression evidence.

**Verification:** Every discrepancy has an evidence-backed disposition or remains
explicitly pending owner decision. Keep feat-372/381/447 blocks truthful.

### U4. Review, integrate and report acceptance

**Goal:** Deliver reviewed changes through passing CI and ordinary deployments.

**Files:** `docs/roadmap/README.md`, integration records under `docs/operations/`,
and focused durable lessons under `docs/solutions/` when established.

**Dependencies:** Review each completed unit independently; merge in actual
contract/deployment dependency order.

**Approach:** Inspect exact PR heads, review threads and check results. Resolve
shared-file conflicts, regenerate contracts as needed, run combined validation,
and squash-merge with the reviewed head pinned. Verify normal deployment and
separate implemented, deployed, observed, shadow-evaluated and live states.

**Verification:** Appropriate unit/database tests, types, lint, formatting,
schema drift, roadmap links and CI pass. Explicitly run standalone exposure and
co-watch database suites with `RECOMMENDATION_DB_TEST=1` and an isolated migrated
database when relevant. Update the exposure suite's hand-created table fixture
with schema changes. The prior batch noted these suites were not selected by CI,
so green CI alone is not evidence they ran. Retain honest browser
and performance evidence. Leave ticket status open for unmet Admin or owner gates.

---

## Applicable learnings and deferred execution facts

- `docs/solutions/logic-errors/recommendation-traffic-exclusion-before-persistence.md`:
  exclusion must precede every writer, including identity resolution.
- `docs/solutions/logic-errors/cowatch-generation-denominator-lineage-20260928.md`:
  retain every score-affecting source, including singleton denominator inputs.
- `docs/solutions/best-practices/recommendation-trace-capacity-and-retention-proof-20260928.md`:
  measure retained work and physical headroom separately; zero-root retention
  success does not prove loaded purge throughput.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`:
  visual smoke cannot establish unchanged loading performance.

Production corpus sufficiency, a working authorized Admin session, precise new
served-contract shape and historical join recoverability are execution facts.
Report their actual outcomes; do not assume success or waive acceptance gates.
