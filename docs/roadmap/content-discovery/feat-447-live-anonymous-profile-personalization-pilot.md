---
id: "feat-447"
title: "Live consent-aware hybrid personalization rollout"
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

Semantic similarity is the safe contextual control, but it cannot adapt to an anonymous viewer's distinct consented interests. Production personalization must combine semantic and profile candidates in one governed hybrid pipeline, learn only from qualified consented feedback, and retain semantic-only delivery as the Essential-only experience and operational fallback.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical recommendation architecture and U30 contract.
2. `docs/roadmap/content-discovery/feat-384-recommendation-experiment-spine.md` — assignment and exposure authority.
3. `docs/roadmap/content-discovery/feat-385-hybrid-recommendation-promotion-rollback.md` — bounded promotion, kill switch, and rollback authority.
4. `docs/roadmap/content-discovery/feat-386-multi-interest-profile-candidates.md` — exact profile generator and shadow-decision evidence.
5. `apps/admin/src/services/scene-recommendations-retriever.ts` and `apps/admin/src/app/api/scene-embedding/recommendations/route.ts` — current semantic authority and compatibility route.
6. `apps/web/src/lib/recommendations.ts` — current Watch recommendation adapter.
7. `apps/admin/src/app/dashboard/search/[requestId]/page.tsx` — current request-trace UI pattern.

## Grep These

- `recommendation-hybrid-personalized-v1|hybrid_personalized|semantic_contextual|semantic_fallback`
- `profile_challenger` — legacy assignment label only, never a profile-only serving architecture
- `RecommendationPersonalizationDecision|personalization`
- `dispatchRecommendationProfileFeedback|activeOutcomeId`
- `promote_to_experiment|shadow_decision_missing`

## What To Build

- Keep `semantic_control` as the immutable contextual comparator and last-known-good fallback. Essential-only viewers receive semantic recommendations without profile resolution, experiment assignment, cross-request repetition history, or profile learning.
- For consented personalized requests, retrieve semantic and exact-manifest profile nominations into one source-aware union, then run eligibility, deterministic hybrid ranking, and composition once. Do not substitute a complete profile-only slate.
- Treat `profile_challenger` only as the additive compatibility label for a consented experiment assignment; report actual serving with `hybrid_personalized`, `semantic_contextual`, or `semantic_fallback` execution mode.
- Admit the exact hybrid manifest only after its own unexpired counterfactual `promote_to_experiment` decision and bounded approval. Preserve sticky assignment, assigned-but-not-exposed analysis, kill switch, and semantic rollback.
- Read only an atomic published consented profile generation and nominate its bounded interests. A missing, stale, withdrawn, deleted, sparse, or failed optional profile source contributes no signal; semantic candidates refill the shared slate.
- Compose six unique playable Videos whenever six eligible candidates exist, suppress the current Video and consent-permitted recent repeats, and use at most one bounded continuation retrieval within the unchanged 1.5-second complete-service deadline.
- Permit selection to update only bounded short-lived intent. Publish durable interest changes only after a linked, consented playback is finalized and classified as a qualified outcome.
- Let Watch viewers grant or refuse recommendation personalization through the versioned cookie banner, reopen settings, reset, withdraw, and delete. Withdrawal must immediately hide stale personalized cards and refetch contextual semantic recommendations.
- Persist request-owned assignment and execution truth, source contribution, composition, consent-safe projection provenance, and lifecycle evidence; reconcile request, feedback ancestry, selection, playback, outcome, superseding projection, and the later request in Admin.

## Admin Evidence Gate

- Show assignment separately from actual execution mode, the exact effective hybrid manifest, every final-item contributor, pre/post composition movement, suppression/refill, semantic fallback reason, requested/composed counts, projection version/generation, bounded interest count, and qualified feedback source request IDs for each request.
- Preserve immutable experiment assignment and actual exposure separately; assigned but unexposed viewers remain visible in intent-to-treat analysis.
- Keep raw cookie values, profile identifiers, watch histories, cohort membership, and vectors out of Admin responses and request-owned serving records.
- Keep the semantic holdout, kill switch, withdrawal, deletion, last-known-good rollback, evidence eligibility, and projection publication state independently reconcilable.

The ticket remains in progress until the full Essential-only and consented Watch-to-Admin journeys pass in the embedded browser against the restored vector-bearing snapshot and remain visible for human verification.

## Constraints

- The governed assignment, promotion, and profile-generator prerequisites are required. A similar-looking manifest or a decision for another generator cannot authorize hybrid exposure.
- Semantic remains the live control and last-known-good fallback. Profile candidates are an optional source in the shared hybrid pipeline, not a separate serving lane.
- Do not increase the 1.5-second end-to-end recommendation contract.
- Recommendation delivery and profile projection cannot delay or gate video playback.
- Essential-only operational session state is attribution and capability state only; it cannot become a profile, ranking input, experiment unit, or learning source.
- Selection may influence only consented bounded short-lived intent; durable interests require a consented qualified finalized outcome.
- No raw identity, history, small-cohort membership, or vector may cross the serving or Admin contract.
- Reset, withdrawal, deletion, tombstoning, expiry, and privacy-generation changes must remove future influence and fence stale publication.
- Preserve the versioned semantic response and existing compatibility query.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test exact hybrid-manifest and shadow-decision gates, sticky assignment, assignment-versus-execution truth, actual exposure, idempotency, and kill-switch/rollback behavior.
- Test Essential-only semantic delivery with no profile access; consented short-lived adaptation; durable qualified-outcome adaptation; selection-without-playback separation; sparse/expired/stale/withdrawn/deleted semantic refill/fallback; and privacy-generation fencing.
- Test six unique playable cards, current/recent-repeat suppression, bounded refill, Watch accessible consent/explanation controls, and Admin request-level source, composition, projection, fallback, and qualified feedback ancestry.
- Use the restored vector-bearing production snapshot for cold and warm hybrid latency proof; synthetic vector corpus is not accepted for this gate.
- Reconcile one browser journey from Watch request through impression, selection, successful start, finalized outcome, updated profile generation, later recommendation request, and Admin trace.
- Prove the semantic holdout, bounded hybrid cohort, kill switch, withdrawal, erasure, and last-known-good fallback independently before allowing non-zero production exposure.
- Run affected checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/web test`, `pnpm --filter @forge/admin lint`, `pnpm --filter @forge/web lint`, and both application typechecks.
- Run `pnpm --filter roadmap generate:readme` and `pnpm --filter roadmap lint` after updating roadmap metadata.
