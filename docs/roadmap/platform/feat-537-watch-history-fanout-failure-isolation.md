---
id: "feat-537"
title: "Isolate per-video failures in the watch-history fan-out"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-09-22"
duration: 1
depends_on:
  - "feat-229"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "accounts"
---

## Problem

`fetchWatchHistoryVideoDetails` fans out up to 200 Admin GraphQL requests through a bare
`Promise.all` with no per-item `.catch()` and no concurrency cap. Apollo's default
`errorPolicy: "none"` rejects on any GraphQL error — including a partial-data response —
and `createTimeoutFetch` rejects on the 15 s budget, so one bad or slow video rejects the
whole batch.

`POST /api/watch-progress` awaits that call outside any `try/catch` (its only guard covers
`request.json()`), so the rejection becomes a 500. `watch-progress-client.ts` treats a
non-OK response as "not signed in": it sets `authState = "anonymous"`, clears
`authenticatedUserId`, and every `useWatchProgress` consumer silently switches to the
anonymous localStorage bucket. A single unwatchable video in a user's history signs them
out of the rendered page.

The unbounded fan-out is also the amplifier: 200 simultaneous requests against Admin make a
rate-limit or timeout rejection far likelier than the same work at ~8 in flight.

There is no `route.test.ts` for `api/watch-progress`.

Linear: [FGE-185](https://linear.app/jesus-film-project/issue/FGE-185) (W-043), from the
2026-09-13 /watch listing audit.

## Entry Points — Read These First

1. `apps/web/src/lib/watch-history.ts` — `fetchWatchHistoryVideoDetails` holds the
   `Promise.all` fan-out and `fetchHistoryVideo` the unguarded Apollo call.
2. `apps/web/src/app/api/watch-progress/route.ts` — `POST` awaits the fan-out for
   `includeVideos: true` with no guard.
3. `apps/web/src/lib/watch-progress-client.ts` — the `!response.ok` throw whose `catch`
   sets `authState = "anonymous"`.
4. `apps/web/src/lib/admin-client.ts` — the 15 s `AbortSignal.timeout` fetch and the lack
   of an `errorPolicy`.
5. `docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md`
   — the repo's documented `bounded concurrency + never bare Promise.all` shape and its two
   test traps.

## Grep These

- `Promise.all(` in `apps/web/src/lib/watch-history.ts`
- `fetchWatchHistoryVideoDetails`
- `authState = "anonymous"` in `apps/web/src/lib/watch-progress-client.ts`
- `includeVideos`

## What To Build

1. **Per-item isolation.** Every fan-out task owns a `.catch()` that resolves to `null`; the
   existing `.filter((item) => item != null)` absorbs it. One failing video costs its own
   card and nothing else.
2. **Bounded concurrency.** A sliding-window pool capped at `WATCH_HISTORY_FANOUT_CONCURRENCY = 8`
   in-flight requests, preserving input order. Not a chunked wave — a slow item must not stall
   its cohort.
3. **Route-level degrade.** `POST /api/watch-progress` wraps the `includeVideos` fan-out so a
   rejection still returns `200` with `videos: []` and `authenticated: true`, never a 500.
4. **Operator visibility.** A bounded plain-string log per dropped item and one summary line,
   in the repo's `event=name key=value` format — never `JSON.stringify` (Railway logsV2 drops
   stringified payloads from Next.js route handlers).

## Constraints

- Do not add `errorPolicy: "all"` in this change: swallowing partial-data errors into a
  rendered card is a separate product decision.
- Do not add a new runtime dependency to `apps/web` for the pool.
- Never log a raw error object or a user id; `videoId` only.
- Preserve the existing analytics and recommendation behaviour — this route touches neither.

## Verification

- `pnpm --filter @forge/web test -- src/lib/watch-history.test.ts src/app/api/watch-progress/route.test.ts`
- A discriminating test where exactly one video among healthy siblings rejects, asserting the
  siblings still return (fails on `Promise.all`, passes with the per-item catch).
- A concurrency test asserting observed max in-flight is **exactly** 8 for a batch of 20 —
  `<= 8` alone passes on a sequential regression, which the bounded-parallelism solution doc
  names as a trap.
- A route test where `fetchWatchHistoryVideoDetails` itself rejects, asserting `200` +
  `videos: []` + `authenticated: true`.
- `pnpm --filter @forge/web typecheck && pnpm --filter @forge/web lint`
- `npx prettier --check` on every changed file.
