---
title: "Co-watch generations must include denominator-only sources"
date: "2026-09-28"
last_updated: "2026-09-29"
category: "logic-errors"
module: "Admin Recommendations"
problem_type: "logic_error"
component: "service_object"
severity: "high"
symptoms:
  - "A singleton view changed popularity-corrected lift without changing the generation identity"
  - "Deduplicated pair winners did not retain all score-affecting source revisions"
root_cause: "logic_error"
resolution_type: "code_fix"
tags:
  [
    "recommendations",
    "cowatch",
    "lineage",
    "denominators",
    "immutable-generations",
  ]
---

# Co-watch generations must include denominator-only sources

## Problem

The initial feat-387 shadow implementation identified a graph from its retained
pair contributions. An eligible outcome that formed no pair could still change
the population denominator and therefore popularity-corrected lift. Two graphs
could consequently share an identity while exposing different feature values.
This was caught during implementation review, before deployment.

## Symptoms

- Adding a fourth viewer's singleton C view left the three A-to-B contributions
  unchanged but changed the population correction.
- Persisting only winning pairs omitted singleton outcomes and sources discarded
  by pair deduplication, making revision and erasure reconciliation incomplete.

## What Didn't Work

Hashing more fields from the winning pairs does not cover outcomes outside those
pairs. Checking only contribution or edge counts also misses changed confidence,
lift, weights, and eligibility.

## Solution

`apps/admin/src/services/recommendations/cowatch/graph.ts` derives generation
identity from the canonical eligible source set, projection version, and evaluation
time. Source identity includes outcome revision, media, viewer support key, exact
eligibility decision/revision/policy, quality weight, and event time.

The publisher retains `RecommendationCowatchSourceContribution` separately from
deduplicated pair contributions. Each source retains exact outcome and eligibility
lineage even when it produces no winning pair. Read-side validity checks can then
reject expired, superseded, invalidated, or erased inputs rather than treating an
old aggregate as current.

The regression in `cowatch/graph.test.ts` adds one singleton and asserts all three:

```text
pair contributions remain equal
generation identity changes
popularity-corrected lift changes
```

The migrated PostgreSQL test in `cowatch/projection.db.test.ts` additionally
compares every persisted edge's support, eligibility, confidence, lift, decay,
quality, effective weight, and contamination against a fresh canonical rebuild.
It exercises outcome replacement, same-state eligibility revision replacement,
and the production privacy-suppression hook.

## Why This Works

The dependency set of a derived feature is larger than the set of records that
win its output selection. Population denominators and source eligibility are
inputs too. Immutable identity and retained lineage must cover that complete set;
consumer feature contracts then refer to one reproducible generation.

## Prevention

When reviewing an aggregate generation, perturb one input that creates no output
row. If any published score changes, its identity and lineage must change too.
Test full feature equality after rebuilding, not only row counts. For bounded
projections, overflow must remain an explicit refusal rather than a successful
empty or truncated population.

These checks establish local correctness. They do not establish production corpus
sufficiency, useful recommendation coverage, or a causal usefulness improvement.

## Finite-population follow-up (2026-09-29)

A bounded population needs separate event-membership, evaluation and publication
clocks. `episode-event-window-v1` selects episodes start-inclusive/end-exclusive,
chooses their latest classifier revisions at the frozen evaluation cutoff, and
then applies current validity. Bind all three scope timestamps and the scope
version into generation identity alongside every eligible source. Use the
cutoff for decay; store the actual publication time separately and preserve it
on an identical rebuild.

The [finite-population record](../../operations/recommendation-cowatch-finite-population-2026-09-29.md)
distinguishes raw canonical rows, eligible sources, attempted pairs and published
rows. Reading the first overflow row proves a lower bound, not the full count.
Refuse before any publication, and roll back all earlier inserts after a later
write-lock or transaction failure. A single-publisher advisory lock bounds
concurrent writes; overlapping read-only preflights still consume resources.
Fixture row counts and current page reuse cannot establish maximum heap, WAL or
temporary-storage bounds for production.

## Related Issues

- [feat-387 shadow lane](../../roadmap/content-discovery/feat-387-profile-conditioned-directional-cowatch.md)
- [Canonical lineage and sparse invalid scans](../performance-issues/profile-reconciliation-sparse-invalid-scan-20260921.md)
- [Recommendation accounting boundaries](recommendation-outcome-accounting-boundaries-20260921.md)
