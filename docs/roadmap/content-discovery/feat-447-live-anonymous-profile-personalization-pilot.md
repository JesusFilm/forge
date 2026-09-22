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
  - "feat-459"
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
- Compose six unique playable Videos whenever six eligible candidates exist, suppress the current Video and recent repeats, and use at most one bounded continuation retrieval within the unchanged 1.5-second complete-service deadline.
- Permit selection to update only bounded short-lived intent. Publish durable interest changes only after a linked playback is finalized and classified as a qualified outcome.
- Establish personalization automatically on first use. Keep the persistent Watch personalization control available for reset, withdrawal, and deletion; a failed initial grant must not restore the removed cookie banner. Withdrawal must immediately hide stale personalized cards and refetch contextual semantic recommendations.
- Persist request-owned execution truth, optional historical assignment, source contribution, composition, projection provenance, and lifecycle evidence; reconcile request, feedback ancestry, selection, playback, outcome, superseding projection, and the later request in Admin.

## Admin Evidence Gate

- Show actual execution mode, the exact effective manifest, every final-item contributor, pre/post composition movement, suppression/refill, semantic fallback reason, requested/composed counts, projection version/generation, bounded interest count, and qualified feedback source request IDs for each request. Show an immutable historical assignment separately when one exists; do not fabricate one for direct profile delivery.
- Keep raw cookie values, profile identifiers, watch histories, cohort membership, and vectors out of Admin responses and request-owned serving records.
- Keep withdrawal, deletion, last-known-good fallback, evidence eligibility, and projection publication state independently reconcilable. Historical experiment, holdout, and exposure records remain inspectable when present but do not authorize current direct profile delivery.

The September 21 production canaries now prove direct-profile, no-assignment delivery through real Watch selection, qualified playback, profile publication and later hybrid use of the same outcome. Separate withdrawal, reset and completed-erasure checks preserve contextual delivery and remove future influence. The ticket remains in progress for the matching permission-checked Admin trace and independent operational last-known-good fallback and stale-publication evidence; a SQL canary does not replace those gates. See the release update below.

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

## September 21 browser and privacy continuation

The [release observation](../../operations/watch-closeout-release-2026-09-21.md)
records exact deployed revisions and two complete production-safe canaries.
Actual normal-speed playback produces qualified active-classifier outcomes and
later six-card hybrid requests containing those outcomes, with no assignment.
Withdrawal immediately removes personalization. Reset advances generation,
completes old-root erasure and returns a clean contextual request; deletion
completes replacement-root erasure and preserves contextual delivery. Exact
item/selection lineage and zero remaining private references are checked through
bounded read-only SQL. No production facts are fabricated or database rows seeded.

Keep the remaining Admin/fallback/publication gates explicit. The owner's Railway
access establishes database evidence, not permission to impersonate an Admin user.

## September 21 independent local fallback and publication drill

The [runtime release record](../../operations/watch-startup-readiness-2026-09-21.md)
now includes complete-service checks with the real owned PostgreSQL/Redis
fixture, runtime signer and production dependency factory. A forced platform
failure returns and persists six last-known-good cards, no assignment and
incomplete stage evidence. A separate stale publisher is fenced while preserving
the current pointer and its single generation. Retained production rows since
September 18 contain no matching fallback request or failed projection run to
establish those operational events. Keep the production and matching signed-in
Admin proof open; do not promote these local checks into production acceptance.

The [later diagnostic release](../../operations/watch-transport-cause-release-2026-09-21.md)
retains those remaining gates and credits the previously verified browser
lifecycle, completed erasure/reset and September 9 restored-snapshot performance
under their original scope. The new operational diagnostics do not replace the
matching authorized Admin trace or independent production fallback/publication
evidence, and do not widen personalization rollout.

## September 22 sustained production verification

The [September 22 production verification](../../operations/watch-production-verification-2026-09-22.md)
retains the completed lifecycle/erasure and restored-vector checks. Fresh
production reads still find no matching operational last-known-good fallback
request or failed projection run establishing stale-publisher rejection. A
scheduler stale-run observation is not that proof. No authorized Admin browser
session is available for the matching lifecycle trace. Keep these independent
gates and feat-459's dependency explicit; status remains in progress.

## September 22 natural publication-fence evidence

The [runtime release verification](../../operations/watch-runtime-release-verification-2026-09-22.md)
now identifies 11 natural `pointer_generation_fenced` and five
`eligibility_input_fenced` production runs after 19:45 UTC. All have no published
projection and retain an eligible current pointer; every pointer-fenced run has
a newer current generation. The typed projection-service failure and persisted
terminal state establish stale-publication prevention independently of scheduler
lease recovery. Credit this production gate rather than repeating the earlier
absence claim. Matching authenticated Admin evidence and independent operational
last-known-good fallback proof remain open; no matching fallback request was
found since September 18. Keep the ticket in progress.

The later 23:29:43 canonical database audit remains clean and records 13
replacement publications and 127 clean hybrid requests in the 21:55–23:29
window. The owned public-browser canary also persists an attributable selection
and accepted playback facts. Neither replaces the matching authenticated Admin
lifecycle trace or independent operational last-known-good fallback proof.

The final audit sequence retains one affected pointer at 23:56:26 and a later
consistent read-only/server-clock snapshot with zero at September 22 00:00:01.
The intervening diagnostic reused an older clock against newer data; aggregate
results cannot prove which exact pointer changed or continuous eligibility.
The final snapshot records 20 replacement publications and 183 clean hybrid
requests since 21:55. The expanded terminal inventory has 28 publication fences,
while the per-row proof above covers the original 16. No retained operational
last-known-good fallback exists since September 18. All limits and the still-open
Admin gate remain in the [release record](../../operations/watch-runtime-release-verification-2026-09-22.md).
