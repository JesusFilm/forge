---
id: "feat-539"
title: "Distinguish a degraded watch history from an empty one"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-09-29"
duration: 2
depends_on:
  - "feat-537"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "accounts"
---

## Problem

feat-537 made `POST /api/watch-progress` degrade a failed history fan-out to `videos: []` with a
`200`, which is right: a 500 there signs the user out. But `videos: []` now means two different
things — "you have not watched anything" and "we could not reach Admin" — and the client cannot tell
them apart.

`WatchHistoryClient` sets `status: "ready"`, `mergeProgressAndVideos` drops every entry whose video
is missing, `groups.length === 0`, and the user is told they have no history while `entries` in the
same response lists up to 200 videos they actually watched. The component already has an `error`
status; this failure class cannot reach it.

Not a regression — before feat-537 the same request 500'd and rendered empty _and_ signed the user
out — but feat-537 made the failure structurally invisible, which is the part worth fixing.

Found by the correctness and adversarial reviewers on the feat-537 PR.

## Entry Points — Read These First

1. `apps/web/src/app/api/watch-progress/route.ts` — the `catch` around
   `fetchWatchHistoryVideoDetails` that currently returns `videos: []` with no marker.
2. `apps/web/src/lib/watch-progress-client.ts` — `loadWatchProgressHistory`, which parses the
   response and would need to carry the marker through.
3. `apps/web/src/components/watch/WatchHistoryClient.tsx` — `VideoState`, `mergeProgressAndVideos`,
   and the `groups.length === 0` empty-state branch at the render.

## Grep These

- `videos: \[\]` in `apps/web/src/app/api/watch-progress/route.ts`
- `mergeProgressAndVideos`
- `status: "error"` in `apps/web/src/components/watch/WatchHistoryClient.tsx`

## What To Build

1. Return an explicit marker from the route's degrade branch (e.g. `videosDegraded: true`) alongside
   `videos: []`. Keep it additive: an older client that ignores the field must behave exactly as it
   does today.
2. Thread it through `loadWatchProgressHistory`'s parsed result.
3. Route it to `WatchHistoryClient`'s existing `status: "error"` branch so the user sees "we could
   not load your history, try again" instead of "you have not watched anything".
4. Keep the entries themselves rendered where possible — the response still carries the full merged
   `entries`, so a degraded state can list what was watched even without artwork.

## Constraints

- Do not turn the degrade back into a non-OK status. The whole point of feat-537 is that any non-OK
  response makes `watch-progress-client.ts` set `authState = "anonymous"`.
- The marker is additive; never make an older client's parse fail on it.
- Do not add a retry loop on the client without a bound — that re-opens the amplification concern
  tracked in feat-540.

## Verification

- A route test asserting the degrade branch sets the marker and the success branch does not.
- A `WatchHistoryClient` test rendering the degraded response and asserting the error affordance,
  not the empty-state copy — with a sibling test that a genuinely empty history still renders the
  empty state, so the two cannot be confused.
- `pnpm --filter @forge/web typecheck && pnpm --filter @forge/web lint`
