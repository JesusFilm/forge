---
id: "feat-540"
title: "Bound watch-progress request amplification into Admin"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-09-29"
duration: 3
depends_on:
  - "feat-537"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "infrastructure"
---

## Problem

Any authenticated caller can POST `{"includeVideos": true}` to `/api/watch-progress` in a loop, and
each request issues up to 200 uncached Admin GraphQL queries — `fetchPolicy: "no-cache"`,
`dynamic = "force-dynamic"`, and `apps/web` has no middleware or per-route rate limit on this path.
All of it goes out under web's shared `WEB_ADMIN_API_KEYS` consumer bearer, so at Admin's rate
limiter it is indistinguishable from ordinary Watch traffic.

feat-537's concurrency cap bounds width _within_ one request; it does nothing across requests, and
by making each request longer-lived it lets concurrent generations stack. Pre-existing, but feat-537
is where it was identified, and the fan-out rationale it records ("firing all of them at once makes
an Admin rate-limit rejection likelier") only holds intra-request.

Found by the adversarial reviewer on the feat-537 PR.

## Entry Points — Read These First

1. `apps/web/src/app/api/watch-progress/route.ts` — the unthrottled `POST` handler.
2. `apps/web/src/lib/watch-history.ts` — `WATCH_HISTORY_FANOUT_CONCURRENCY` and
   `WATCH_HISTORY_FANOUT_BUDGET_MS`, the intra-request bounds that already exist.
3. `apps/web/src/lib/admin-client.ts` — the shared consumer bearer every call goes out under.
4. `apps/admin/CLAUDE.md` "Search API authentication" — the existing per-IP rate-limit shape in
   admin, for prior art on where the limiter belongs.

## Grep These

- `includeVideos`
- `WEB_ADMIN_API_KEYS`
- `fetchPolicy: "no-cache"` in `apps/web/src/lib`

## What To Build

1. Decide where the limit belongs — a per-session limit in the Web route, a per-consumer limit in
   Admin, or both — and record the reasoning. A Web-side limit is cheaper but is bypassed if Admin
   is called another way; an Admin-side limit protects the real resource.
2. Apply a per-authenticated-subject cap on `includeVideos: true` specifically. The plain progress
   sync (no `includeVideos`) is cheap and should not be throttled with it.
3. Consider caching the per-video card projection: the same `videoId` resolves to the same card for
   every user, and `fetchPolicy: "no-cache"` on a per-video lookup is the actual amplifier.
4. On refusal, return a shape the client does NOT read as signed-out — a `200` with the marker from
   feat-539, never a non-OK status.

## Constraints

- A refusal must never produce a non-OK response on this route: `watch-progress-client.ts` reads any
  non-OK as `authState = "anonymous"`, which is the FGE-185 defect.
- Do not throttle the plain progress sync path; losing progress writes is worse than the load.
- Preserve the analytics and recommendation policy — this route touches neither.

## Verification

- A test asserting that the throttle fires on the `includeVideos` path and not on the plain sync.
- A test asserting a throttled response is still `authenticated: true` with a `200`.
- Load evidence: measured Admin query volume for N looped requests before and after.
