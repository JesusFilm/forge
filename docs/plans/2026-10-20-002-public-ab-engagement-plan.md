---
title: Public saved-recommendation A/B engagement
status: complete
date: 2026-10-20
---

## Scope

Add CTR, engaged-view rate, active watch minutes per 100 eligible visits, and
playback capture coverage to the existing public A/B report. Continue the running
editorial experiment with its original assignment, generation, and CTR policy.
Engagement is an additional descriptive comparison, not a retroactive rewrite of
the frozen winner rule. No regeneration or new viewer tracking is needed.

## Measurement

An engaged visit has at least one recommendation-attributed active-watch-proxy-v1
outcome with a qualified view (30 seconds or 25% of known duration). Count each
visit once. Sum active playback milliseconds across distinct attributed episodes.
Use exact visit/request/item/selection/claimed-episode lineage; exclude direct
playback, conflicts, wrong generations, and outcomes after the report cutoff.
Select the latest outcome revision before examining qualification. Partial
coverage contributes observed time and remains separately visible. Missing
outcomes and missing active coverage stay explicit. Report claimed playbacks per
accepted selection and observed active coverage per claimed playback.

Keep the existing denominator, including empty deliveries. Add browser-clustered
95% intervals for engaged-view rate using the existing visit-ratio method.
Watch minutes remain descriptive. Preserve engagement totals and per-browser
engaged counts during the existing archive-before-delete transaction. Legacy
archived visits have unknown engagement, never manufactured zero engagement;
show that coverage gap and withhold full-cohort engagement rates/intervals.

## Implementation units

1. Add bounded additive columns to CTR totals and clusters, with an explicit
   engagement-measured visit count for migration compatibility.
2. Extend `precomputed/ctr-evidence.ts` and `ctr-report.ts` to share exact raw and
   archive attribution, aggregates, engagement rates, and uncertainty. Preserve
   prior immutable report revisions and version the optional engagement block.
3. Add a reusable Admin report comparison table to public controls and the
   saved/private report surface where applicable; retain older-report rendering.
4. Cover exact attribution, revisions, deduplication, missing/partial/pending
   outcomes, late cutoffs, archive parity/replay, old archives, and both arms in
   native PostgreSQL tests. Validate UI, scoped types, format, lint, and CI.

## Release and verification

Ship through PR-to-main and normal Railway deployment. Verify the additive
migration, generate a fresh report for the already-running editorial cohort,
and check its unchanged serving pointer and all four requested measurements.
Inspect bounded production playback attribution/coverage; do not claim absent
playback data as a measured zero or submit synthetic engagement as real usage.
