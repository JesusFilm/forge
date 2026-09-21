---
id: "feat-459"
title: "Recommendation profile eligibility reconciliation"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: ""
duration: 6
depends_on:
  - "feat-376"
  - "feat-386"
  - "feat-464"
blocks:
  - "feat-381"
  - "feat-447"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "profiles"
  - "integrity"
  - "reliability"
---

## Problem

Profile contribution eligibility can change after a profile generation is published, but live profile serving currently validates generation lifecycle state without revalidating every contributor against current eligibility. A 2026-09-06 production audit found 45 contributions that current policy no longer considered eligible across 23 current profile generations; 78 later hybrid requests consumed affected generations. The same audit found 73 profile projection runs stuck beyond the expected claim window.

The projection builder can reconstruct a profile from current eligible evidence. Forge needs a deterministic reconciliation path and a read-time fence so stale lineage cannot influence CTR attribution, experiments, promotion, profiles, learning, or ranking while repair is pending.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical recommendation architecture and U12, U19, and U30 contracts.
2. `docs/roadmap/content-discovery/feat-369-recommendation-playback-episodes-active-playback.md` — still-open source-neutral playback and attribution evidence gate.
3. `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts` and `apps/admin/src/services/recommendations/candidates/profile-candidate.service.ts` — projection publication and live profile reads.
4. `apps/admin/src/services/recommendations/profiles/job.ts` and `apps/admin/src/workflows/recommendationProfileProjection.ts` — projection claims, heartbeats, fencing, and terminal state.
5. `apps/admin/src/services/recommendations/integrity-policy.ts`, `apps/admin/src/services/recommendations/evidence.service.ts`, and `apps/admin/src/services/recommendations/playback-outcome-consumer.ts` — current evidence eligibility and attribution decisions.
6. `apps/admin/src/services/recommendations/admin-ops/` — privacy-safe reconciliation and health evidence.

## Grep These

- `getLiveProfileCandidates|profileProjectionGeneration|currentGenerationId`
- `RecommendationProfileContribution|profileEligible|selectionAttributionEligible`
- `replay_velocity_exceeded|transportReplay|eventConflict`
- `RecommendationProfileProjectionRun|heartbeatAt|claimId|fence`

## What To Build

- Derive a current eligibility revision for every profile contributor from immutable selection and finalized-outcome evidence. Preserve the original decisions and publish explicit superseding eligibility; never fabricate an impression, selection, playback episode, or outcome.
- Reject the optional profile source when its current published generation contains lineage that is no longer profile-eligible. Continue through contextual semantic delivery within the existing complete-service deadline, and do not delay or gate navigation or playback.
- Rebuild every affected profile from current eligible evidence into a deterministic replacement generation. Publish the replacement atomically behind privacy-generation, input-watermark, version, and claim fences; never mutate a published generation in place.
- Re-evaluate legacy `replay_velocity_exceeded` outcomes using committed receipt evidence that distinguishes bounded transport retry from integrity conflict. Preserve exact-event idempotency and exact-payload conflict detection; no legacy row becomes eligible merely because a newer transport policy exists.
- Reclaim abandoned projection runs through bounded heartbeat leases and generation fences. Resume safe work or terminate it with a durable reason code, bounded attempts, and operator-visible backlog state.
- Expose current ineligible lineage, affected pointers, rebuild backlog, stale-run recovery, semantic degradation, serving-request impact, and post-repair invariants in authorized Admin Recommendations views without exposing profile identifiers, histories, small cohorts, or vectors.

## Admin Evidence Gate

- Show counts and reason codes for current generations with ineligible lineage, affected current pointers, rebuild candidates, replacement publications, stale claims, reclaimed or terminal runs, and profile-source serving fences.
- Reconcile one affected generation from original evidence through superseding eligibility, deterministic rebuild, atomic pointer replacement, later semantic or clean hybrid request, and the matching privacy-safe Admin trace.
- Prove a fresh current-pointer audit returns zero generations with currently ineligible lineage before profile-derived ranking, experiments, promotion, or learning may advance.

The ticket is not complete until these results are visible and reconcilable in the authorized Admin Recommendations area and verified against a fresh production snapshot.

## Constraints

- Semantic contextual recommendations remain the live control and last-known-good fallback. A fenced profile source is ordinary source degradation, not a navigation or playback failure.
- Do not increase the 1.5-second complete-service deadline or relax evidence eligibility, exact-event idempotency, payload-conflict detection, personalization settings, privacy-generation, retention, or erasure policy.
- Reconciliation may supersede derived eligibility and publish replacement projections. It must not rewrite immutable evidence or manufacture missing recommendation impressions.
- Keep `active-watch-proxy-v1` fail-closed for live ranking. This ticket does not activate or widen learning, experiments, promotion, or profile-derived ranking.
- Selection without a committed eligible impression remains ineligible for CTR, experiment, promotion, profile, and learning attribution.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Reproduce a current generation whose formerly eligible contribution is superseded to ineligible and prove live serving immediately fences the profile source before rebuild completes.
- Test identical eligibility replay, conflicting replay, lost acknowledgement after commit, partial receipts, bounded transport retry, legacy replay-velocity evidence, and selection without an eligible impression.
- Test deterministic replacement from mixed eligible and ineligible contributors, empty replacement, concurrent eligibility revision, concurrent withdrawal or deletion, stale privacy generation, racing publishers, and failure before pointer swap.
- Test fresh, heartbeat-active, expired, reclaimed, repeatedly failed, and generation-fenced projection runs with bounded attempts and durable terminal reason codes.
- Prove a full rebuild from immutable evidence matches incremental reconciliation and leaves no current pointer with ineligible lineage.
- Test contextual semantic fallback, unchanged deadline, fail-open navigation and playback, privacy-safe Admin aggregation, and request-to-generation trace reconciliation.
- Run affected checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/web test`, `pnpm --filter @forge/admin lint`, `pnpm --filter @forge/web lint`, and both application typechecks.
- Run real PostgreSQL concurrency and publication-fence tests, then complete a local browser Watch-to-Admin lifecycle proof.
- Run `pnpm --filter roadmap generate:readme` and `pnpm --filter roadmap lint` after updating roadmap metadata.

## Closeout Status — 2026-09-07

- PR #2182 shipped immutable eligibility revisions, read-time lineage fencing, deterministic replacement generations, bounded stale-run recovery, and the authorized aggregate Admin evidence surface.
- The first day production audit found that the initial reconciliation scheduler run lost a deployment registration race and terminated with `WorkflowNotRegisteredError`. It also exposed the playback replay-receipt and session-binding failures addressed by the closeout hotfix.
- The closeout hotfix adds a five-minute scheduler watchdog that reconciles terminal runtime state and restarts under the existing advisory lock. Regression coverage proves recovery when a runtime fails after `start()` has already returned.
- This ticket remains `in-progress` until the hotfix is deployed, reconciliation converges, and a fresh authorized Admin audit reports zero current pointers with ineligible lineage, as required by the Admin Evidence Gate. No pre-deploy result is being represented as production closure.

## Post-Deploy Update — 2026-09-08

- The deployed hotfix eliminated the replay-receipt `P2002` collision and restored the five-minute reconciliation cadence in the reviewed production window.
- The same fixed-window audit found residual Web-to-Admin timeout/error-normalization failures, exhausted playback write conflicts, and successful recognized-crawler traffic on the human playback evidence path.
- `feat-464` now owns that transport, crawler-integrity, observability, and production-canary work. This ticket remains blocked until `feat-464` is complete and the fresh authorized Admin audit proves zero current pointers with ineligible lineage.

## Authorized Production Audit — 2026-09-10 NZ

The owner supplied access to the primary production PostgreSQL database.
The existing Admin current-pointer query initially reported a suppressed
violation, then returned zero ineligible current pointers and zero rebuild
backlog at 2026-09-09 21:02:43 UTC after scheduled reconciliation. The stored
replacement chain preserves original generations and advances pointers to
published replacements. All 23 audited reconciliation batches in 18:30–20:30
have zero classification failures, dispatch failures, and exhausted attempts.
See the [production integrity record](../../operations/recommendation-evidence-production-integrity-2026-09-10.md)
for snapshot populations, concurrency-fence outcomes and receipt verification.

The fresh production invariant is now evidenced. Keep this ticket in progress
because its feat-464 transport acceptance dependency remains open; this audit
does not enable ranking or satisfy feat-447's separate browser lifecycle gate.

## Fresh audit and Admin evidence correction — September 21

The [complete read-only snapshot](../../operations/watch-profile-audit-2026-09-21.md)
at September 20 21:52:32.710 UTC checked 167,029 live current pointers with the
unchanged canonical lineage predicate and found zero ineligible pointers. Bounded
cursor fetches completed the full population without relaxing the five-second
statement guard. The transaction was rolled back and its connection closed.

The same investigation proved the Admin clean-hybrid count used an impossible
lane value and omitted 3,508 actual hybrid decisions in the fixed review window.
The correction counts `execution_mode = 'hybrid_personalized'` and preserves
privacy suppression, expiry and window bounds. A real PostgreSQL regression
distinguishes current execution from historic challenger and viewing-mode rows.
PR #2353 deployed automatically to Admin and its worker as
`6e02dd855af4053d9c9a7b032fe1ece7317cfc33`; the post-release bounded query still
finds the 3,508 clean hybrid decisions. [Release verification](../../operations/watch-ticket-execution-2026-09-21.md)
does not replace the separate Admin/browser lifecycle gate. Feat-464's remaining
acceptance gates still prevent ticket closure.

Later release monitoring found an additional concrete blocker: the 22:52:48 UTC
worker heartbeat was unavailable after reconciliation transaction expiry at
5,182–5,371 ms (limit 5,000 ms). The next 22:58:17 heartbeat completed. The exact
affected-pointer scan performs full-population work despite its 100-result
limit. Bounded direct production reads took 4,187 and 4,258 ms. JIT-off and
materialized-query controls did not reliably fix the guard; reusing joined
generation fields saved 0.4–0.7 seconds but did not prove complete transaction
recovery or all-lineage parity. No candidate or setting was shipped.

Build a representative sparse-invalid, roughly 167,000-pointer regression and
reduce discovery work while preserving the canonical predicate, ordering,
concurrency fences and five-second budget. The [execution record](../../operations/watch-ticket-execution-2026-09-21.md)
contains exact timings and limits. The earlier zero-pointer snapshot remains
valid for its timestamp, not a claim of continuous convergence or ticket closure.

## Reconciliation transaction correction — September 21 continuation

The full-scale PostgreSQL reproduction now fails on the original batch with
`P2028` at 5,033 ms and passes with the batch lineage query at 1,664 ms. The
correction shares canonical eligibility rules, materializes affected pointers
before the ordered limit, and disables measured JIT compilation only inside the
transaction. Its deadline, advisory lock, serving fences and dispatch bounds
remain unchanged. Exact parameterized production read-only checks took
1,397–1,520 ms; JIT was restored after each rollback. These are pre-deployment
query diagnostics, not a deployed worker recovery claim.

Seven real database tests include large-cohort discovery, concurrent reads/writes,
lineage parity, active-run exclusions, ordering/batch limits and setting cleanup.
The [durable explanation and rejected controls](../../solutions/performance-issues/profile-reconciliation-sparse-invalid-scan-20260921.md)
record the causal evidence. Keep this ticket in progress through normal release,
exact revision verification, a fresh invariant audit, sustained healthy worker
batches, Admin lifecycle reconciliation and the dependent feat-464 gates.

## September 21 deployed reconciliation correction

PR [#2356](https://github.com/JesusFilm/forge/pull/2356) deployed automatically as
`de752d60980b25ee11806f2c424770fc78027188` to Admin and the worker. The full-scale
original batch expires at 5,033 ms; the corrected transaction passes in 1,664 ms
with the same eligibility, five-second budget and publication fences. Real
PostgreSQL parity, concurrency and rollback-setting checks pass, as do 7,281
Admin unit tests and applicable CI.

The [release record](../../operations/watch-closeout-release-2026-09-21.md)
retains an initial one-ineligible-pointer audit, subsequent convergence to zero,
and the completed two-hour observation. All 24 batches and their heartbeat steps
complete without substantive errors, with 238 classification attempts and 14
queued rebuilds. The final timed audit again finds one ineligible pointer;
the 02:20:44 UTC recheck exhausts all 167,984 pointers and finds zero. Preserve
both nonzero snapshots rather than claiming continuous zero violations.
Keep this ticket in progress until its
feat-464 dependency and authorized Admin gates are satisfied. Do not assign the
separate historical selection timeouts to this correction: their sampled times
fall between reconciliation batches.
