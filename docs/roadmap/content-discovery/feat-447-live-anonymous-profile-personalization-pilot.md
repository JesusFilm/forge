---
id: "feat-447"
title: "Live consent-aware hybrid personalization rollout"
owner: "nisal"
priority: "P0"
status: "complete"
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

Semantic similarity is the safe contextual baseline, but it cannot adapt to an anonymous viewer's distinct authorized interests. Watch needs direct multi-interest profile delivery after the viewer enables personalization while preserving contextual semantic delivery for visitors without a usable profile and preserving semantic fallback when the optional profile source is empty or unavailable.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical recommendation architecture and U30 contract.
2. `apps/admin/src/services/recommendations/delivery.service.ts` — current direct profile and semantic fallback authority.
3. `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts` — current published multi-interest projection and privacy-generation fence.
4. `apps/admin/src/services/recommendations/episode.service.ts` and `apps/admin/src/services/recommendations/finalization/job.ts` — selection and qualified-outcome feedback dispatch.
5. `apps/web/src/components/recommendations/WatchSemanticRecommendations.tsx` — current Watch recommendation and first-bootstrap behavior.
6. `apps/admin/src/app/dashboard/recommendations/` — privacy-safe request evidence.

## Grep These

- `recommendation-hybrid-personalized-v1|hybrid_personalized|semantic_contextual|semantic_fallback`
- `profile_challenger` — historic assignment label only, never current authorization for profile use
- `RecommendationPersonalizationDecision|personalization`
- `dispatchRecommendationProfileFeedback|activeOutcomeId`
- `profile_cold_start|projection_fence|RecommendationProfileSessionLink`

## What To Build

- Keep the semantic path as the contextual baseline and fallback. Visitors without an authorized usable profile receive semantic recommendations without assignment or promotion lookup.
- For authorized personalized requests, retrieve semantic and published multi-interest profile nominations into one source-aware union, then run eligibility, deterministic hybrid ranking, and composition once. Do not substitute a complete profile-only slate.
- Report actual serving with `hybrid_personalized`, `semantic_contextual`, or `semantic_fallback` execution mode. Historic `profile_challenger` assignment remains immutable evidence but is not required for current profile use.
- Read only an atomic published profile generation at the active privacy generation. A missing, stale, withdrawn, deleted, sparse, or failed optional profile source contributes no signal; semantic candidates refill the shared slate.
- Compose six unique playable Videos whenever six eligible candidates exist, suppress the current Video and consent-permitted recent repeats, and use at most one bounded continuation retrieval within the unchanged 1.5-second complete-service deadline.
- Link the active authorized profile to the delivery session before selection. Permit selection to update bounded short-lived intent and publish durable interest changes only after a linked playback is finalized and classified as a qualified outcome.
- Use the current personalization control and bootstrap behavior as the privacy authority. Reset, withdrawal, deletion, expiry, and privacy-generation changes fence stale projection publication and future profile influence; this ticket does not restore the removed cookie-banner flow.
- Persist request-owned execution truth, source contribution, composition, privacy-safe projection provenance, and lifecycle evidence; reconcile request, feedback ancestry, selection, playback, outcome, superseding projection, and the later request in Admin.

## Admin Evidence Gate

- Show historic assignment separately from actual execution mode, the effective manifest, every final-item contributor, pre/post composition movement, suppression/refill, semantic fallback reason, requested/composed counts, projection version/generation, bounded interest count, and qualified feedback source request IDs for each request.
- Keep raw cookie values, profile identifiers, watch histories, cohort membership, and vectors out of Admin responses and request-owned serving records.
- Keep contextual fallback, withdrawal, deletion, evidence eligibility, delivery-session binding, and projection publication state independently reconcilable.

## Resolution

Current `main` contains the complete direct-profile path and its production hardening:

- PR #1976 (`96dc3aeee`) shipped exact-six contextual delivery, authorized hybrid profile composition, the 1.5-second service contract, profile privacy controls, and privacy-safe Admin evidence.
- PR #2131 (`ae0ffdccd`) removed shadow-assignment and promotion as prerequisites for ordinary authorized profile delivery.
- PR #2132 (`bd57dbd78`) published selection and qualified-outcome feedback through the directly linked profile session.
- PR #2133 (`b9ddf57c2`) fenced stale projection generations before use.
- PR #2135 (`7a6de5d25`) made profile cold starts use the normal contextual path rather than report fallback failure.
- PR #2136 (`0b1b2b694`) made the first Watch request wait for the current profile bootstrap decision without delaying video playback.
- PR #2137 (`d6e243d56`) bound the authorized delivery session to its profile before selection feedback can race.

Focused non-mutating verification on 2026-09-02 passed 51 Admin tests across delivery, episode feedback, qualified-outcome feedback, projection publication, and privacy erasure, plus 39 Web tests across bootstrap, profile request behavior, recommendation lifecycle, exact-six rendering, and personalization controls. No production data, deployment setting, experiment, promotion, or restored snapshot was mutated for this closeout.

## Constraints

- Semantic remains the contextual baseline and last-known-good fallback. Profile candidates are an optional source in the shared hybrid pipeline, not a separate serving lane.
- Do not increase the 1.5-second end-to-end recommendation contract.
- Recommendation delivery and profile projection cannot delay or gate video playback.
- Operational session state is attribution and capability state only; it cannot silently become a durable profile or cross-viewer identity.
- Selection may influence only authorized bounded short-lived intent; durable interests require an authorized qualified finalized outcome.
- No raw identity, history, small-cohort membership, or vector may cross the serving or Admin contract.
- Reset, withdrawal, deletion, tombstoning, expiry, and privacy-generation changes must remove future influence and fence stale publication.
- Preserve the versioned semantic response and existing compatibility query.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test direct authorized profile delivery without shadow assignment or promotion, historic assignment-versus-execution truth, idempotency, and contextual fallback.
- Test contextual delivery with no profile access; authorized short-lived adaptation; durable qualified-outcome adaptation; selection-without-playback separation; sparse/expired/stale/withdrawn/deleted semantic refill/fallback; and privacy-generation fencing.
- Test six unique playable cards, current/recent-repeat suppression, bounded refill, current accessible personalization controls, and Admin request-level source, composition, projection, fallback, and qualified feedback ancestry.
- Reconcile request, selection, finalized outcome, updated profile generation, later recommendation request, and Admin trace through focused integration and browser coverage when the required local services are available.
- Run affected checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/web test`, `pnpm --filter @forge/admin lint`, `pnpm --filter @forge/web lint`, and both application typechecks.
- Run `pnpm --filter roadmap generate:readme` and `pnpm --filter roadmap lint` after updating roadmap metadata.
