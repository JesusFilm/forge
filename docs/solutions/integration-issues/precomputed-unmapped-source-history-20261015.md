---
title: "Treat unmapped source analytics as coverage during recommendation generation"
date: "2026-10-15"
category: integration-issues
module: "Precomputed recommendation generation"
problem_type: integration_issue
component: service_object
symptoms:
  - "A clean model attempt pauses with import_unavailable"
  - "All Admin requests and model receipts succeed before the pause"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [precomputed, recommendations, analytics, coverage, route-mapping]
---

# Unmapped source analytics must not stop content generation

A frozen catalog video had an uppercase URL segment that the strict Watch route
mapper leaves unmapped. `readGaNavigationSnapshot` rejected the entire source
before reading its captured observations, and the manual runner classified
`analytics_mapping_unverified` as `import_unavailable`. The generation stopped
after 55 successful model calls; the capture and provider receipts were intact.

Replay the historical snapshot against the frozen catalog and verified imported
artifact before retrying model work. The replay reproduced the source-only
`hasUniqueRoute` precondition without production writes or new GA queries.

Remove that source-only precondition, retaining the mapper and every per-row
attribution check. Unmapped or ambiguous events remain unassigned, signals stay
null, and coverage counters retain observed exclusions. Keep sealed capture,
route-catalog identity, cutoff and candidate checks. Changing route parsing or
normalizing frozen slugs would alter historical evidence for existing batches.

The sealed-reader regression fixture covers mapped, uppercase and ambiguous
sources, both source and candidate engagement, navigation exclusions, zero live
GA calls and changed-catalog rejection. Existing valid snapshots must remain
identical when replayed. Missing analytics is an accepted coverage limitation;
it must not be converted to zero interest or fabricated viewing evidence.

See [coverage policy](../../analytics-and-recommendation-policy.md) and
[repair plan](../../plans/2026-10-15-006-fix-unmapped-source-history-coverage-plan.md).
