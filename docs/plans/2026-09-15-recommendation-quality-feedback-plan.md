---
title: "Recommendation history and playback feedback quality"
date: 2026-09-15
type: feat
status: active
---

## Scope and decisions

The owner requested the recommendation improvements from the live September 15
audit, excluding locale/source coverage (the local ticket formerly numbered 471).
Immediate exits must be recorded separately: they do not establish liking or
disliking, and their meaning is unresolved. No automatic negative taste weights.

Main already completed feat-369 and renamed/completed the original feat-477 as
feat-488. Preserve that work and its documented browser verification. The active
source-free recommendations task owns feat-496 admission/runtime recovery; do not
edit its admission, worker, cache, publication, or production configuration paths.
Use `codex/recommendation-quality-feedback`, based on main `3cc4017af`.

The locally drafted repetition ticket 478 collides with main and becomes feat-503.
Immediate-exit interpretation gets feat-504, downstream of navigation/QoE feat-370.
The controlled evaluation remains dependent on sufficient observed data; code
alone cannot finish an experiment or establish recommendation quality.

## Requirements

- R1: Recent playback from direct/search/editorial navigation participates in the
  existing bounded, authorized recent-history preference for below-player rows.
- R2: Preserve privacy-generation/session fences, current-video exclusion,
  deterministic refill, locale eligibility, and existing For you history rules.
- R3: Observe immediate departure with playback/coverage context, separately from
  positive engagement, technical failure, completion, and missing evidence.
- R4: Preserve unknown interpretation; a quick exit does not create positive or
  negative durable interests. A click-only session signal must not masquerade as
  qualified engagement. Explicit reaction semantics require a later decision.
- R5: Navigation and QoE remain independently inspectable and recomputable in
  Admin, with bounded browser collection that cannot delay playback.
- R6: Slate diversity changes require shadow evidence and deterministic fallback;
  existing editorial constraints and experiment boundaries remain intact.
- R7: Controlled usefulness evaluation uses eligible assigned viewers and mature
  outcomes, rather than comparing self-selected profile/contextual cohorts.

## Implementation units

### U1 — Close recent playback history gap (R1–R2)

- Files: `apps/admin/src/services/recommendations/recent-context.service.ts`,
  `recent-context.service.test.ts`, `recent-context.db.test.ts`.
- Approach: bound episode reads per authorized session independently of issued
  recommendation roots, merge started video IDs into existing suppression reasons.
  Use observed playback starts, not claims or clicks. Respect live retention,
  authorization time, conflict and late-fact boundaries.
- Patterns: `user-history.service.ts` bounded lateral episode read; existing
  `slate.ts` soft suppression/refill.
- Tests: source-neutral direct/search starts, attempts without starts, pre-link
  history, expired/reset/foreign sessions, late/future/conflicted facts, scan cap,
  current-session fallback and existing recommendation-selected history.
- Verification: focused unit plus real isolated PostgreSQL tests; query plan/bound
  evidence. Existing slate regression tests must pass.

### U2 — Navigation and QoE observations (R3–R5)

- Files: Admin recommendation `contracts.ts`, `outcome.service.ts`, playback
  observation/projection services and tests; Web recommendation playback contracts,
  `RecommendationPlaybackRecorder.tsx` and its tests; Admin playback evidence UI.
- Approach: reuse immutable episode facts and derived evidence, version observation
  policy separately from qualified-watch classifier; preserve old clients and raw
  fact retention. Record departures before first play when an attempt is known.
  Keep navigation cause unknown when browser APIs cannot establish intent.
- Tests: rapid route/page departure, before-start departure, long pause then exit,
  completion, errors, backgrounding, bfcache, replay, seek, buffering, duplicates,
  unavailable telemetry, late revisions and retention/privacy reset.
- Verification: Admin/Web tests, lint/types, focused browser lifecycle and page-load
  comparison. Assert no new positive/negative durable contribution from exits.

### U3 — Composition and evaluation (R6–R7)

- Read feat-393 and its editorial prerequisite before changing `slate.ts`.
  Implement versioned policy and explanation/evaluation contracts in shadow;
  do not bypass terminal-decision requirements or silently change live ranking.
- Reconcile the local controlled-evaluation draft against current experiment
  assignment, exposure and outcome services. Limit cohorts to currently supported
  contexts so excluded locale work does not become an implicit prerequisite.
- Tests: deterministic order, fixed/pinned semantics, sparse fallback, coverage,
  assignments without exposure, revision/maturity handling and non-experiment
  delivery compatibility. Record readiness honestly when evidence is insufficient.

## Coordination and closeout

Check active task snapshots before overlapping implementation or integration.
Preserve the original checkout's uncommitted documents. Update only this worktree's
roadmap and generated index. Run scope checks, review, and record durable learning.
Production changes require normal PR-to-main deployment; no direct deployments.
