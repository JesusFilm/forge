---
id: "feat-505"
title: "Evaluate personalization usefulness with a controlled comparison"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-15"
duration: 5
depends_on:
  - "feat-369"
  - "feat-381"
  - "feat-384"
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
