---
title: Selection attribution can predate a concurrent impression receipt
date: 2026-09-16
category: database-issues
module: Recommendation selection and impression attribution
problem_type: database_issue
component: service_object
severity: high
symptoms:
  - "Selection returns 503 despite a committed eligible impression"
  - "Postgres P0001 reports that selection attribution requires an eligible impression"
root_cause: async_timing
resolution_type: code_fix
tags:
  [recommendations, selection, impression, postgres, concurrency, timestamps]
---

# Selection attribution can predate a concurrent impression receipt

## Problem

Production trace `2089744889511763809` on 15 September 2026 failed selection
creation with `recommendation selection attribution requires an eligible
impression`. The impression existed; its receipt was newer than the attribution
marker. This was a distinct failure from the separate upstream deadline errors.

`RecommendationEpisodeService.select()` captures `now` before reading the item,
verifying its capability and entering the transaction. A concurrent impression
can commit during those waits. Selection then obtains the item advisory lock,
reads the impression, and used the older request-start timestamp as
`attributionEligibleAt`.

Migration `0075_recommendation_selection_attribution_eligibility` requires an
impression whose `received_at <= attribution_eligible_at`. The advisory lock
serializes writes, but does not make a previously captured timestamp current.
The guard correctly rejected the write and rolled the selection transaction back.

## Solution

Under the existing item lock, derive eligibility from both server receipts:

```ts
const attributionEligibleAt = impression
  ? new Date(Math.max(now.getTime(), impression.receivedAt.getTime()))
  : null
```

Use the same rule for exact selection replay reconciliation and replay of an
already committed impression. Carry the resulting watermark into asynchronous
profile feedback so the projection can include the newly eligible selection.
Preserve the original selection receipt and browser occurrence time; neither
is a substitute for the attribution watermark. Existing expiry checks,
immutable eligibility, capability verification, locks and replay/conflict rules
remain in force. No trigger or timeout needs to be weakened.

Entry points:

- `apps/admin/src/services/recommendations/episode.service.ts`
- `apps/admin/src/services/recommendations/evidence.service.ts`
- `apps/admin/prisma/migrations/0075_recommendation_selection_attribution_eligibility/migration.sql`

## Verification and prevention

The previous real-Postgres concurrency test supplied the same time to selection
and impression, so both orders appeared safe. The corrected reproduction pauses
selection during capability verification, commits an impression with a receipt
100 ms later, then resumes selection. The unmodified service fails with the
exact production P0001; the fix passes with the later eligibility marker while
preserving exact replay, conflict handling and concurrent episode claims.

Three unit regressions cover later impression receipts during creation,
selection replay and impression replay, including profile feedback watermarks.
Earlier-impression controls and the real trigger's rejection of fabricated
attribution remain covered.

Use different timestamps when testing concurrent events whose ordering is
encoded in persisted fields. Test both operation ordering and timestamp ordering;
a mutex proves only the former. Distinguish successful fail-open navigation from
successful attribution, and separate constraint failures from real timeouts.

Related: [source-neutral playback receipt time](../logic-errors/source-neutral-playback-recent-history-20260915.md),
[production follow-up](../../operations/watch-runtime-followup-2026-09-16.md),
and [remaining timeout investigation](../../roadmap/platform/feat-496-watch-rollout-runtime-recovery.md).
