---
id: "feat-459"
title: "Recommendation profile eligibility reconciliation"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 6
depends_on:
  - "feat-376"
  - "feat-386"
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
- Do not increase the 1.5-second complete-service deadline or relax evidence eligibility, exact-event idempotency, payload-conflict detection, consent, privacy-generation, retention, or erasure policy.
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
