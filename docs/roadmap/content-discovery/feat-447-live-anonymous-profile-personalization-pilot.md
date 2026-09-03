---
id: "feat-447"
title: "Live anonymous-profile hybrid personalization rollout"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: ""
duration: 8
depends_on:
  - "feat-384"
  - "feat-385"
  - "feat-386"
blocks:
  - "feat-396"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "profiles"
  - "experiments"
  - "personalization"
---

## Problem

Semantic similarity is the safe contextual base, but it cannot adapt to an anonymous viewer's distinct interests. Production personalization combines semantic and profile candidates in one governed hybrid pipeline, learns only from qualified playback feedback, and retains semantic delivery as the cold-start and operational fallback.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical recommendation architecture and U30 contract.
2. `docs/roadmap/content-discovery/feat-386-multi-interest-profile-candidates.md` — profile projection and candidate evidence.
3. `apps/admin/src/services/scene-recommendations-retriever.ts` and `apps/admin/src/app/api/scene-embedding/recommendations/route.ts` — current semantic authority and compatibility route.
4. `apps/web/src/lib/recommendations.ts` — current Watch recommendation adapter.
5. `apps/admin/src/app/dashboard/search/[requestId]/page.tsx` — current request-trace UI pattern.

## Grep These

- `recommendation-hybrid-personalized-v1|hybrid_personalized|semantic_contextual|semantic_fallback`
- `profile_challenger` — compatibility label only, never a profile-only serving architecture
- `RecommendationPersonalizationDecision|personalization`
- `dispatchRecommendationProfileFeedback|activeOutcomeId`
- `direct_profile|executionMode|profileProjectionGeneration`

## What To Build

- Keep the semantic source as the contextual base and last-known-good fallback. A new or profile-unavailable viewer receives ordinary semantic contextual recommendations without a fabricated experiment assignment.
- For an authorized profile request, retrieve semantic and exact-manifest profile nominations into one source-aware union, then run eligibility, deterministic hybrid ranking, and composition once. Do not substitute a complete profile-only slate.
- Treat `profile_challenger` only as a compatibility label for historical records. Current delivery truth is `hybrid_personalized`, `semantic_contextual`, or `semantic_fallback` execution mode; an absent assignment is normal for direct profile delivery.
- Read only an atomic published profile generation and nominate its bounded interests. A missing, stale, withdrawn, deleted, sparse, or failed optional profile source contributes no signal; semantic candidates refill the shared slate.
- Compose six unique playable Videos whenever six eligible candidates exist, suppress the current Video and consent-permitted recent repeats, and use at most one bounded continuation retrieval within the unchanged 1.5-second complete-service deadline.
- Permit selection to update only bounded short-lived intent. Publish durable interest changes only after a linked playback is finalized and classified as a qualified outcome.
- Establish personalization automatically on first use. Keep the persistent Watch personalization control available for reset, withdrawal, and deletion; a failed initial grant must not restore the removed cookie banner. Withdrawal must immediately hide stale personalized cards and refetch contextual semantic recommendations.
- Persist request-owned execution truth, optional historical assignment, source contribution, composition, projection provenance, and lifecycle evidence; reconcile request, feedback ancestry, selection, playback, outcome, superseding projection, and the later request in Admin.

## Admin Evidence Gate

- Show actual execution mode, the exact effective manifest, every final-item contributor, pre/post composition movement, suppression/refill, semantic fallback reason, requested/composed counts, projection version/generation, bounded interest count, and qualified feedback source request IDs for each request. Show an immutable historical assignment separately when one exists; do not fabricate one for direct profile delivery.
- Keep raw cookie values, profile identifiers, watch histories, cohort membership, and vectors out of Admin responses and request-owned serving records.
- Keep withdrawal, deletion, last-known-good fallback, evidence eligibility, and projection publication state independently reconcilable. Historical experiment, holdout, and exposure records remain inspectable when present but do not authorize current direct profile delivery.

The ticket remains in progress because no successful post-#2137 browser journey yet proves the current direct-profile, no-assignment lifecycle through Watch selection, qualified playback, profile publication, later hybrid delivery, semantic fallback, and the matching privacy-safe Admin trace. Focused Web/Admin suites and real-Postgres fixtures prove the individual seams but manually seed or mock lifecycle boundaries, so they do not satisfy this browser gate.

## 2026-08-19 Phase A Closeout Evidence

- Verified that the merge commits for PRs #1976 (`96dc3aee`), #2131 (`ae0ffdcc`), #2132 (`bd57dbd7`), #2133 (`b9ddf57c`), #2135 (`7a6de5d2`), #2136 (`0b1b2b6`), and #2137 (`d6e243d5`) are ancestors of the audited `main` revision.
- The focused Admin lifecycle suite passed 53 files / 353 tests. The focused Web Watch suite passed 22 files / 170 tests.
- The focused profile fixtures passed 3 files / 4 tests against disposable PostgreSQL. The representative profile-candidate read measured 76 ms cold and 7 ms warm in that fixture.
- These checks establish merge ancestry and seam-level behavior, but they do not replace the required post-#2137 browser journey. The fixtures seed lifecycle boundaries directly and the Web suites mock upstream APIs. No committed verifier currently drives and reconciles the entire direct-profile/no-assignment lifecycle.
- Closeout decision: keep `status: "in-progress"` until the exact browser and Admin evidence gate above passes.

## Constraints

- Semantic remains the contextual base and last-known-good fallback. Profile candidates are an optional source in the shared hybrid pipeline, not a separate serving lane.
- Do not increase the 1.5-second end-to-end recommendation contract.
- Recommendation delivery and profile projection cannot delay or gate video playback.
- Operational session state remains attribution and capability state and does not itself become a profile, ranking input, experiment unit, or learning source. The separately owned persistent profile may be established automatically on first use.
- Selection may influence only bounded short-lived intent; durable interests require a qualified finalized outcome.
- No raw identity, history, small-cohort membership, or vector may cross the serving or Admin contract.
- Reset, withdrawal, deletion, tombstoning, expiry, and privacy-generation changes must remove future influence and fence stale publication.
- Preserve the versioned semantic response and existing compatibility query.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test direct profile authorization, optional historical assignment-versus-execution truth, idempotency, and fallback behavior.
- Test cold semantic delivery before a profile is available; short-lived adaptation; durable qualified-outcome adaptation; selection-without-playback separation; sparse/expired/stale/withdrawn/deleted semantic refill/fallback; and generation fencing.
- Test six unique playable cards, current/recent-repeat suppression, bounded refill, Watch accessible personalization/explanation controls, and Admin request-level source, composition, projection, fallback, and qualified feedback ancestry.
- Use the restored vector-bearing production snapshot for cold and warm hybrid latency proof; synthetic vector corpus is not accepted for this gate.
- Reconcile one browser journey from Watch request through impression, selection, successful start, finalized outcome, updated profile generation, later recommendation request, and Admin trace.
- Prove direct-profile delivery, withdrawal, erasure, generation fencing, and last-known-good fallback independently; reconcile historical experiment evidence only when a request actually has it.
- Run affected checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/web test`, `pnpm --filter @forge/admin lint`, `pnpm --filter @forge/web lint`, and both application typechecks.
- Run `pnpm --filter roadmap generate:readme` and `pnpm --filter roadmap lint` after updating roadmap metadata.
