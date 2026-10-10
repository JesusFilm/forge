---
id: "feat-505"
title: "Evaluate personalization usefulness with a controlled comparison"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: "2026-09-15"
duration: 5
depends_on: []
blocks: []
tags: [recommendations, watch, analytics]
---

## Problem

Renumbered from the unmerged local recommendation ticket feat-472, whose ID now
belongs to the tvOS player experiment on main. The September 15 live audit finds
higher personalized CTR, but the cohorts differ in prior history and there are no
randomized assignments. This does not establish causal usefulness.

## Entry Points — Read These First

1. `docs/reports/2026-09-15-profile-recommendations/report.md`.
2. `docs/roadmap/content-discovery/feat-384-recommendation-experiment-spine.md`.
3. `apps/admin/src/services/recommendations/experiment/assignment.ts`.
4. `apps/admin/src/services/recommendations/experiment/evaluation.ts`.

## Grep These

`intent-to-treat|unitDigest|human_anonymous|hybrid_personalized|semantic_contextual`

## What To Build

- Prepare a versioned human-viewer comparison among viewers eligible for both
  strategies, using an explicitly permitted stable experiment identity.
- Reuse experiment primitives and preserve ordinary direct-profile delivery.
- Primary metric: mature qualified recommendation views per assigned eligible
  unit, including units without exposure. Secondary metrics: active minutes,
  starts and matched CTR. Reconcile coverage, latency and errors independently.
- Specify A/A checks, sample size assumptions, fixed stopping rule, maturity,
  contamination and data-unhealthy handling before interpreting A/B evidence.
- Publish improve/no-benefit/inconclusive/data-unhealthy conclusions with
  uncertainty clustered by the assignment unit.

## Constraints

The owner excluded locale/source coverage work. Restrict the evaluation to
currently supported exact contexts; do not silently add that work back as a gate.
Operational session identity cannot become experiment identity without the
required design decision. No production experiment activation from this task's
preparation, no guessed uplift, and no satisfaction inference from watch time.

## Verification

Reconcile assignment, unexposed denominators, mature latest outcome revisions,
sample ratio, coverage and uncertainty. Record actual readiness and unresolved
gates. Code or a prepared experiment alone cannot complete the evaluation ticket.

## September 15 preparation

The runnable evaluator is
`apps/admin/src/services/recommendations/experiment/usefulness-offline.ts`.
It measures mature qualified recommendation views per assigned profile, retains
zero-exposure units, bootstraps uncertainty by profile, and rejects unhealthy or
immature evidence. The adjacent `usefulness-readiness.sql` is a bounded read-only
inventory, not an experiment activation command.

`docs/operations/recommendation-usefulness-evaluation-2026-09-15.md` records the
fixed stopping rule, minimum sample, maturity/retention limits and routing gaps.
The current direct-profile path bypasses experiment assignment; a profile-unit
A/A, pre-assignment cohort routing, exposure reconciliation and mature controlled
data remain prerequisites. The ticket stays in progress and no uplift is claimed.

## September 16 follow-through

Profile-unit A/A/A/B routing and the read-only mature extractor are implemented.
See `docs/operations/recommendation-usefulness-evaluation-2026-09-15.md` for the
new assignment/outcome versions, exact approval gates, zero-exposure denominator,
24-hour follow-up after enrollment cutoff, and preview/manual deduplication.
The existing below-player attribution contract supports this bounded study; the
owner-excluded feat-373 is no longer a dependency. Production readiness capture
at 2026-09-16T00:21:39.730Z found no assignments, shadow runs or decisions.
Actual calibration, approved profile-unit A/A, external guardrails and mature
controlled results remain pending. This ticket stays in progress.

## September 29 governed live integration

The owner subsequently authorized taking the implemented shadow policies live
through controlled evidence. This supersedes the earlier preparation-only
activation restriction, while preserving the scoped cohort, attribution,
operational readiness and maturity requirements.

`experiment/study-service.ts` now prepares immutable protocols, records external
evidence, activates exact studies and publishes mature evaluations. The incumbent
A/A executes the actual profile/viewing-mode policy in both arms; semantic-only
calibration cannot authorize the co-watch/MMR bundle. The bundle binds one frozen
graph and independently qualified composer through admission, final issuance and
evaluation. Request-local fallbacks retain original assignment denominators.

See `docs/operations/recommendation-controlled-live-integration-2026-09-29.md`
for the execution contract, local validation and production sequence. Local
synthetic outcomes prove the lifecycle, not useful production effects. Fresh
storage clearance, real A/A calibration, exact shadow/composition approvals,
naturally mature controlled outcomes and external guardrails remain open.

## Reviewed integration release

[PR #2470](https://github.com/JesusFilm/forge/pull/2470) merged as
`0a70712399bf99e10d88477b98cc34c8ababcc6b`. The production Admin/worker health
and bounded 0107–0110 catalog checks passed; all eight new authority tables were
empty, with no activated study or graph trial authority. See the release and
capacity sections of
`docs/operations/recommendation-controlled-live-integration-2026-09-29.md` for
exact observations and remaining gates. Implementation and deployment do not
complete production shadow acceptance, mature usefulness evidence or live
promotion. This ticket remains **in progress**.

## September 30 owner decision

The owner approved direct co-watch/MMR activation without a trial. Feat-505 is
therefore no longer an activation dependency of feat-565. Its study machinery and
scientific evidence requirements remain available for later causal measurement;
none of the missing calibration, assignments or mature outcomes is marked passed
or complete by the direct activation decision. Usefulness remains unmeasured.

## October 2, 2026 scope decision

Cancelled the controlled personalization usefulness study as an obsolete
activation requirement. The versioned assignment, routing, extractor and study
service code remain available, but no randomized production comparison, mature
qualified-view effect, A/A calibration or external guardrail result is claimed.
The September 30 direct activation decision removed this study from the
co-watch/MMR path; cancellation does not turn the older observational CTR
difference into causal value. Viewer benefit remains **unmeasured**. Existing
delivery, integrity, privacy and operational health gates remain independent.
