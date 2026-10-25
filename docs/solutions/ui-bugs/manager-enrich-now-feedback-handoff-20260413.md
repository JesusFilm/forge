---
title: "Manager Enrich Now Feedback Handoff"
category: ui-bugs
date: 2026-04-13
severity: medium
tags:
  - manager
  - coverage
  - enrichment
  - accessibility
  - async-ui
affected_components:
  - apps/manager/src/features/coverage/coverage-report-client.tsx
  - apps/manager/src/features/coverage/enrich-action-controls.tsx
  - apps/manager/src/features/enrich-selection.ts
related_docs:
  - docs/plans/2026-04-13-fix-enrich-now-feedback-plan.md
  - docs/brainstorms/2026-04-11-enrich-now-feedback-brainstorm.md
  - docs/solutions/platform/backfill-worker-pattern-manager-20260407.md
---

# Manager Enrich Now Feedback Handoff

## Problem

The Coverage dashboard's `Enrich Now` action created enrichment jobs through `/api/enrich`, but the UI gave no durable acknowledgement until the request settled. Operators could not tell whether the click registered or whether the backend accepted the request, which invited duplicate clicks and made slow job-creation preflight feel broken.

## Root Cause

The action handler only rendered feedback after the API returned. Full success also redirected immediately to Jobs, so the local selection bar had no accepted state to show. The selection grid remained interactive while the request was in flight, which meant a late response could overwrite newer selection edits with the stale click-time selection snapshot.

## Solution

Use a local submission-feedback pattern for Coverage enrichment actions:

- set `isEnrichSubmitting` before calling `/api/enrich`
- disable only the submit button and change its copy to `Creating jobs...`
- keep cancel available as a local escape hatch
- lock tile/detail selection inputs while the submit is pending
- render pending and accepted copy in the existing translation bar live region
- return an optional Jobs action from the enrichment outcome helper:
  - one created job links to `/dashboard/jobs/<jobId>`
  - multiple created jobs link to `/dashboard/jobs`
- preserve failed selections on partial and full failure

If cancel is available during the request, guard late responses with a request sequence ref so a cancelled response cannot reapply hidden selection or stale feedback.

## Prevention

1. Treat backend acceptance as a distinct UI state from live job progress. Coverage should acknowledge acceptance; Jobs should own ongoing progress.
2. For slow client actions, lock the interactive surface that produced the request, not only the submit button.
3. Avoid nested `role="status"` live regions. Put the live region on the containing status surface and render inner feedback as plain content.
4. Test outcome helpers with red/green coverage for success, partial failure, full failure, and input locking. Use browser smoke evidence for the rendered pending and accepted states.

## Related References

- `apps/manager/src/features/enrich-selection.ts`
- `apps/manager/src/features/coverage/enrich-action-controls.tsx`
- `apps/manager/src/features/coverage/coverage-report-client.tsx`
