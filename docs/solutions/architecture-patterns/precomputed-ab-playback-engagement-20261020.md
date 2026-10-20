---
title: "Join A/B clicks to playback without changing attribution or retention"
date: "2026-10-20"
category: "architecture-patterns"
module: "Admin precomputed recommendation measurement"
problem_type: "architecture_pattern"
component: "service_object"
severity: "medium"
applies_when:
  - "Connecting downstream playback to a saved recommendation experiment"
  - "Adding measurements to a running cohort with immutable reports and raw expiry"
tags: ["recommendations", "ab-testing", "playback", "retention", "postgres"]
---

# Saved A/B playback engagement

## Context

Watch already captures active playback, but the precomputed experiment report
only read selections and impressions. CTR alone could reward recommendations
that attract a click but lead to little viewing. The running editorial cohort
needed engagement without new instrumentation or a new assignment.

## Guidance

Use `precomputed/engagement-evidence.ts` through the shared `rawCtrVisitSql` in
both report evaluation and archive-before-delete. Traverse the exact accepted
selection and unique episode lineage, using server receipt/publication times.
The episode's current privacy generation must match its request and outcome,
and conflicted episodes must not contribute. Direct/source-neutral playback is
useful elsewhere but cannot be assigned to this recommendation's click.

Aggregate episodes in a separate lateral query from qualified impressions.
Otherwise several card impressions multiply an episode's watch time. Choose the
latest outcome revision before filtering `qualified_view`; an earlier qualified
revision must not survive a later correcting revision. Read the active-watch
classifier, not the legacy position classifier, so seeking does not appear as
engagement. Reuse the outcome service's unioned active intervals.

Keep visit CTR, engaged-view rate, and active minutes per 100 eligible visits
together. They share the intent-to-treat visit denominator, including empty
slates. Count an engaged visit once, sum distinct episodes for time, and expose
accepted-click → playback-claim → usable active-time capture denominators.
Pending, partial, missing, and invalid evidence must remain visible.

Persist both per-arm totals and per-browser engagement counts before raw expiry.
Rates need an explicit measured-visit count: adding columns with zero defaults
to historical archives must not turn absent measurements into zero engagement.
An optional versioned report block preserves old immutable revisions. Reuse the
cluster ratio estimator for engaged-view uncertainty, keeping the original
experiment's frozen decision rule unchanged.

## Verification

`precomputed/engagement.db.test.ts` applies the full native migration chain and
covers both arms, multiple episodes/impressions, latest/future revisions,
missing and partial capture, direct/conflicted/future claims, expired archives,
retention replay, final cutoffs, and historical unknowns. A test uses the real
`RecommendationOutcomeService` with overlapping active facts, verifying that a
30-second union contributes 0.5 minutes in each arm.

Do not mutate immutable experiment dates to test finality; advance the fixture
clock beyond the original end and late cutoff. Use real schema constraints for
standalone episodes: a request-linked episode is canonically recommendation
origin even if a fixture tries to label it direct.

## Related

- [CTR and engagement runbook](../../operations/precomputed-ctr-report.md)
- [Source-neutral playback history](../logic-errors/source-neutral-playback-recent-history-20260915.md)
- [Outcome accounting boundaries](../logic-errors/recommendation-outcome-accounting-boundaries-20260921.md)
- [Implementation plan](../../plans/2026-10-20-002-public-ab-engagement-plan.md)
