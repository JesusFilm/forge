---
id: "feat-758"
title: "Stop repeating the consent auto-grant while an erasure is pending"
owner: "unassigned"
priority: "P2"
status: "cancelled"
start_date: "2026-10-20"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "recommendations"
  - "performance"
---

## Retirement (October 29, 2026)

The owner retired viewer profiles and behavioral learning; main removed
`RecommendationConsentShell` in PR #2957. Its auto-grant retry loop no longer
exists. The policy in `docs/analytics-and-recommendation-policy.md` and
feat-902 supersedes the historical implementation instructions below. Do not
restore the shell to implement this ticket.

## Problem

`RecommendationConsentShell` asks `/watch/api/recommendations/profile` for
`status` on every Watch page view and, when the answer is `undecided`, sends
`grant`. On 2026-10-20 one production browser profile received
`state: "active"`, `consentChoice: "personalization"`,
`erasureState: "pending"` from every grant. The client treats
`erasurePending` as a failure, so it retries the whole status-plus-grant pair
after 500 ms and again after 1 s: six POSTs per page view, three of them
mutations (the receipt's `privacyGeneration` had reached 8). The next page
view starts again from `undecided`. A clean profile sends one pair and stops.

Whether a pending erasure should block the default grant is a product and
privacy decision; this ticket is about not repeating a mutation whose answer
cannot change within the retry window, and about finding why the erasure
stays pending. Found in the 2026-10-20 website audit round 01
(`docs/reports/2026-10-20-watch-website-audit-round-01.md`).

## Entry Points — Read These First

1. `apps/web/src/components/recommendations/RecommendationConsentShell.tsx`
   — `refresh()`, the `observed.erasurePending` throw and the retry timer.
2. `apps/web/src/app/api/recommendations/profile/route.ts` — the grant path
   and cookie dispositions.
3. Admin's profile transition and erasure worker (the receipt's
   `erasureState`).
4. `docs/analytics-and-recommendation-policy.md` — binding policy.

## Grep These

- `erasurePending`, `refreshRetryCountRef`, `profile_unavailable`
- `erasureState` in `apps/admin/src`

## What To Build

- Reproduce with a profile whose erasure stays pending; record the receipts.
- Decide (with the policy owner) the client outcome for a grant that returns
  `erasureState: "pending"`, and do not retry it as a transient failure.
- Find why the erasure does not complete for that session.

## Constraints

- Preserve explicit personalization controls and the withdrawal-pending
  safety behaviour.
- No consent prerequisite for recommendations or analytics (policy).

## Verification

- A pending-erasure profile sends at most one grant per page view.
- Existing `RecommendationConsentShell` tests stay green; add one for this
  receipt shape.
