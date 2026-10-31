---
id: "feat-687"
title: "Keep Watch content-action timeouts in deadline order"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "recommendations"
  - "reliability"
---

## Goal

Leave the browser content-action deadline room for bounded admission and the original 900 ms upstream budget plus a provisional transit reserve, so a write Admin finishes in that budget is acknowledged instead of aborted and retried.

## Entry points

- `apps/web/src/lib/recommendation-timeouts.ts`
- `apps/web/src/lib/recommendation-content-actions.ts`
- `apps/web/src/lib/recommendations.ts`
- `apps/web/src/lib/recommendation-admission-worker-client.ts` (admission budget: `COMMAND_TIMEOUT_MS` connect plus commands)
- `apps/web/src/lib/recommendation-content-actions.test.ts`

## Constraints

- Keep the original 900 ms Admin upstream timeout for content actions. The issue allows either lowering it to about 500 ms or raising the browser deadline above 900 ms; this ticket raises the browser deadline because that keeps the acknowledgeable window instead of narrowing it.
- Browser deadline is 1,500 ms: 500 ms production admission (250 ms connect plus 250 ms commands) plus 900 ms upstream plus a provisional 100 ms reserve for session, parse and transit. A test derives the floor from the real admission constants.
- All three values are named constants. Surface exposure keeps its original 900 ms upstream under its own constant; its browser deadline stays the existing 700 ms literal and is out of scope.
- No ranking, coverage, consent, retry-count or admission-budget change. Share telemetry stays fire-and-forget.

## Limits

- An upstream timeout does not roll back or deduplicate an Admin write. Admin deduplicates on `sessionDigest:eventId`, and a retry whose first attempt never delivered the session cookie mints a new session digest.
- The 100 ms reserve is not a guarantee under a blocked event loop. Writes slower than 900 ms still get a 503 and one bounded retry.

## Verification

- Focused content-action timeout, route and ordering tests.
- Web typecheck, lint and format.
- Synthetic Admin plus real Next routes in an active Chromium: late acknowledgement at 750-850 ms with 250 and 450 ms pre-Admin latency acknowledged in one attempt.

## Resolution

- Content-action upstream stays at the original 900 ms; the browser deadline is 1,500 ms (500 ms production admission plus 900 ms upstream plus a provisional 100 ms reserve).
- Surface exposure keeps its original 900 ms upstream under its own named constant; its 700 ms browser literal is unchanged.
- Verified with a synthetic Admin and the real Next routes in an active headless Chromium: before, a write Admin finished at 750-850 ms was aborted at about 700 ms and retried (two admission slots, never acknowledged); after, writes up to 880 ms behind 0, 250 and 450 ms of pre-Admin latency are acknowledged in one attempt. A true upstream timeout answers 503 before the browser gives up, then retries once.
- The earlier 500 ms upstream variant was an allowed alternative but narrowed the acknowledged window to under 500 ms and silently halved the exposure upstream budget.

## Tracking

- Linear: FGE-188
- Follow-up for the other inverted deadline pairs: feat-688
