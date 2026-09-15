---
title: "Keep Watch-home queue rollover separate from played-history storage"
date: "2026-09-03"
category: "ui-bugs"
module: "apps/web Watch homepage"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "A returning viewer's Watch-home intro played one video and then stopped."
  - "The active hero was the final unplayed video, so the follow-on queue contained no distinct next item."
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
tags:
  - "watch-home"
  - "carousel"
  - "autoplay"
  - "played-history"
  - "queue-rollover"
  - "local-storage"
  - "regression-test"
---

# Keep Watch-home queue rollover separate from played-history storage

## Problem

The Watch-home random hero could select the last unplayed video, but the queue
builder applied the same played-history filter to every follow-on candidate.
The resulting one-item queue wrapped to the same keyed player after `ended`, so
the browser left the completed media stopped.

## Symptoms

- Returning viewers could see one intro video and no automatic continuation.
- The failure appeared only near played-history exhaustion, while a fresh
  session continued normally.
- Manual and timed advancement shared the same false one-item queue.

## What Didn't Work

- Applying persistent and per-pool played filters to every queue pass preserved
  preference ordering but made played videos unavailable as rollover choices.
- Clearing stored history during rollover would fill the queue, but it would
  also erase information needed by later hero selection and future visits.
- Treating `useStoredProgress` as the switch for explicit `playedIds` coupled
  two independent inputs. Callers that disable browser storage can still supply
  an explicit played set.

## Solution

Build the queue in two bounded selection passes in
`apps/web/src/lib/watch-home-carousel-sequence.ts`:

1. The preferred pass respects explicit played IDs and, when enabled, browser
   storage for persistent and per-pool progress.
2. If distinct eligible videos remain, one rollover pass ignores played
   progress only while selecting candidates. It retains the queue-wide seen set
   and hard exclusions, and it does not clear stored history.

Keep the two progress predicates separate:

```ts
const respectPlayedProgress = !ignoreProgress
const respectStoredProgress = useStoredProgress && !ignoreProgress
```

Bound the work by the count of distinct eligible unseen IDs. This prevents a
small catalog from looping or duplicating items to reach a larger target.

## Why This Works

Played history is a preference, not a permanent eligibility rule. The first
pass preserves the preference for unseen videos, while the rollover pass makes
a distinct next item available after exhaustion. Hard exclusions and the
queue-wide seen set remain active in both passes, so rollover cannot re-add the
current hero or admit an ineligible portrait source.

The rendered regression in
`apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` dispatches the
active media element's `ended` event. It verifies that React mounts a different
keyed player and requests playback after the existing poster hold. Pure queue
tests also lock storage preservation, hard exclusions, explicit played IDs
without browser storage, and zero-to-six-item termination.

## Prevention

- Model selection fallback and persistence mutation as separate decisions.
- Keep explicit caller inputs independent from switches that enable browser
  storage reads and writes.
- Test stateful media bugs at both boundaries: the pure queue result and the
  rendered `ended`-to-new-player-to-play transition.
- Measure bounded client initialization work with a base-versus-head benchmark
  when a queue algorithm changes.

## Related Issues

- `docs/plans/2026-09-03-1914-fix-watch-home-autoplay-cycle-plan.md`
- `docs/roadmap/content-discovery/feat-452-watch-home-autoplay-cycle.md`
