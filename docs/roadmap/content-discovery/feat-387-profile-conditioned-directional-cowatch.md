---
id: "feat-387"
title: "Profile-conditioned directional co-watch"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: ""
duration: 8
depends_on:
  - "feat-369"
  - "feat-376"
  - "feat-382"
  - "feat-383"
  - "feat-386"
blocks:
  - "feat-565"
  - "feat-448"
tags:
  - "admin"
  - "recommendations"
  - "cowatch"
  - "profiles"
  - "candidates"
---

## Problem

Directional co-watch should learn trustworthy ordered transitions while using the viewer’s active interests to choose anchors, not to rewrite the population graph.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U20 contract.
2. `apps/admin/src/services/recommendations/candidates/`
3. `apps/admin/src/workflows/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `co-watch|cowatch|edge`
- `directional|anchor`
- `lift|shrinkage|distinct viewer`

## What To Build

- Write one exact contribution per distinct integrity-eligible finalized outcome revision.
- Publish immutable directional edge generations with bounded gaps, session/pair deduplication, recency decay, quality weight, distinct-viewer support, shrinkage, confidence, and popularity-corrected lift.
- Publish a reusable versioned co-watch feature contract for candidate generation, the deterministic/learned rankers, and a future item representation. At minimum carry support, confidence, popularity-corrected lift, recency weight, quality weight, and projection generation without requiring consumers to read raw edge contributions.
- Keep population edges inspectable; use session/profile interests only to select anchors and provide rank features.
- Run the generator in shadow and record a terminal decision.

## Admin Evidence Gate

- Show A-to-B and B-to-A evidence, support, lift, confidence, decay, contamination, chosen anchors, candidate overlap, and terminal decision.
- Show exact replacement after outcome revision or privacy deletion and prove the published graph matches a fresh rebuild.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Repeated plays and one manipulator cannot manufacture an edge.
- Sparse or low-confidence edges fall back to semantic candidates.
- Profile conditioning selects anchors; it does not hide or mutate population edge evidence.
- The co-watch projection owns behavioral relationship truth; a later item tower may consume its published features but cannot redefine, mutate, or become the authority for the population graph.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test directionality, deduplication, global-popularity correction, revision replacement, manipulation, sparse fallback, deletion, and rebuild equivalence.
- Test feature-contract version compatibility, missing/stale generation behavior, and identical values across generator, ranker, and representation consumers.
- Benchmark projection and generator latency/coverage.
- Reconcile edges, anchors, candidates, and terminal decision in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.

## Implementation evidence and remaining gate (2026-09-28)

- The directional graph, exact source and pair lineage, immutable feature generation, privacy suppression, Admin inspection, and shadow-only candidate/evaluation operator are implemented. The shadow operator keeps a qualifying co-watch result inconclusive until feat-505's controlled evaluation. Live delivery is unchanged.
- A migrated local PostgreSQL fixture verifies revision replacement, still-current but invalidated evidence, same-state eligibility revision replacement, privacy suppression, stale read fencing, exact rebuild of every edge metric, and watchability filtering. The Admin page has render and permission tests. A synthetic 50,000-source, 25,000-pair graph took 409 ms and 73 MiB heap on the development host; this is an algorithm benchmark, not production latency or coverage evidence.
- The current 50,000-row source bound and 250,000 attempted-pair bound fail closed. No production corpus or authorized Admin session was available for an actual shadow sample, candidate overlap, terminal evaluation, or visual reconciliation. This ticket remains **in progress** until those Admin evidence gates are observed. A local fixture cannot establish useful production coverage. Feat-505 separately gates promotion and usefulness claims.
- When shadow co-watch evidence is sparse, the comparison retains the observed live slate and labels that baseline truthfully, even if its original generator was hybrid. Existing live semantic fallback remains unchanged.
- The isolated local database has no authenticated Admin user or registered OAuth redirect for this worktree, so an authenticated browser walkthrough could not be completed. The server-rendered Admin page and permission/decision states were verified in component tests; an authorized Admin session against a representative corpus remains the visual evidence gate.

## Production preflight refusal and retry repair (2026-09-29)

- The [bounded production preflight](../../operations/recommendation-cowatch-preflight-2026-09-29.md) reached 50,001 distinct source episodes against the existing 50,000 cap before graph eligibility. Migration 0104 was applied; no generation or evaluation was dispatched. This is a preflight refusal, not a terminal shadow evaluation decision. The storage owner acknowledged the refusal; no capacity clearance was issued or required for writes that did not occur.
- The evaluation CLI now requires an explicit UUID/window/sample/minimum-run tuple, and successful/fenced workflow receipts retain the minimum-run threshold for exact retry conflict checks. Local CLI/workflow/operator tests and real PostgreSQL revision/privacy/rebuild fixtures passed. No source bound, integrity threshold or live candidate behavior changed.
- Production graph metrics, anchors, overlap, latency, fallback observations, terminal evaluation and authorized Admin reconciliation remain unobserved. Keep this ticket **in progress**. A later runnable attempt needs a separately reviewed finite workload and fresh storage clearance; do not narrow the corpus or raise bounds merely to obtain a successful result. Feat-505 remains the later usefulness/promotion decision path.

### Subsequent authorized inspection

The parent subsequently reconciled the absent generation/evaluation in production Admin: `generation_unavailable`, evaluation not run, zero displayed generation counters, no anchors/candidates, shadow-only/no promotion and live baseline fallback. The [UI receipt](../../validation/cowatch-preflight-20260929/admin-inspection.json) does not turn absent graph counters into eligible-source counts or satisfy the unobserved graph/terminal evidence gate. PR #2448 passed CI and merged through the normal flow; this ticket remains **in progress**. The separate dispatch atomicity/crash-recovery limits are tracked by feat-563 without granting production execution authority.

New records declare the following handling in the schema and migration:

| Record              | Purpose and identity                                     | Access and ingestion                                | Retention and deletion                           | Fallback      |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ | ------------- |
| Generation          | Population graph; aggregate identity free                | Admin aggregate inspection; manual bounded snapshot | 29 days; expire and cascade                      | Live baseline |
| Source contribution | Exact outcome and decision lineage; private pseudonymous | Projection service; current eligible outcome        | At most 29 days; cascade from outcome or profile | Live baseline |
| Pair contribution   | Exact directional pair lineage; private pseudonymous     | Projection service; bounded pair build              | 29 days; cascade from outcome or profile         | Live baseline |
| Edge                | Versioned directional feature; aggregate identity free   | Admin aggregate inspection; immutable publish       | 29 days; cascade from generation                 | Live baseline |
| Suppression         | Privacy erasure fence; episode scoped private ID         | Privacy service; erasure transaction                | At most 29 days; cascade from episode            | Live baseline |

## Explicit finite populations (2026-09-29)

The [finite-population operator record](../../operations/recommendation-cowatch-finite-population-2026-09-29.md)
documents the new event-window/cutoff contract, read-only preflight, immutable
generation identity, actual publication timestamp, exact-generation loader and
single-publisher lock. Migration 0106 preserves explicit legacy scope for old
writers and generations. The existing source, session, pair and timeout bounds
remain unchanged; overflow and write-lock refusal publish nothing.

Worker and parent each passed 34 focused tests, including eight native database
cases. A measured 16,385-row publication took 4.1–15.4 seconds across recorded
runs, with fresh relation/index allocation around 20.8 MB and WAL around 25.4 MB.
These are local measurements, not maximum-scale capacity or production coverage.
This ticket remains **in progress** pending fresh storage clearance and the
actual generation, terminal shadow evaluation and authorized Admin evidence.
