---
id: "feat-531"
title: "Repair Admin production Watch revalidation endpoint"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "web"
  - "revalidation"
---

## Problem

The 2026-09-21 21:02 UTC homepage publication succeeded, but Admin's configured
`WEB_REVALIDATE_URL=https://watch.jesusfilm.org/watch/api/revalidate` returned
405 for experience, watch-setting, and route-manifest events. An authenticated
POST to `https://www.jesusfilm.org/watch/api/revalidate` returned 200 and refreshed
the homepage. The one-off refresh does not repair subsequent publications.

## Entry Points

- `apps/admin/src/services/revalidate-webhook.ts`
- `apps/admin/src/config/env.ts`
- `apps/web/src/app/api/revalidate/route.ts`
- `docs/operations/watch-recommendation-tester-access.md`
- Railway Forge production Admin service configuration and its secret source.

## What To Do

Verify the deployed endpoint and redirect behavior, then persist the canonical
endpoint in Admin's normal configuration source. Confirm the existing token
matches Web's receiver without printing either value. Activate configuration
through the normal deployment flow and verify Admin-originated publication
events return 200 and affected public content refreshes. Coordinate with
feat-502 for future invalidation scoping; do not broaden this repair into that
publication redesign.

## Constraints and Verification

Preserve authentication, event contracts, and unrelated configuration. Do not
redeploy local worktree code or manually trigger Railway redeploys. Record the
deployed revision, redacted response statuses, and a bounded affected-page
check. Never record tokens, database URLs, or unpublished content.

## Production Repair and Verification (2026-09-24 NZ)

Read-only preflight confirmed the Admin production URL still used
`https://watch.jesusfilm.org/watch/api/revalidate`. An invalid-token POST to
that host returned 301; following the redirect converted it to GET and returned 405. The same invalid-token POST directly to the canonical host returned 401,
confirming the receiver accepts POST and enforces authentication. Admin's
`WEB_REVALIDATE_TOKEN` and Web's `REVALIDATION_SECRET` were present and matched
in memory; neither value was printed.

Only Admin production `WEB_REVALIDATE_URL` was staged as
`https://www.jesusfilm.org/watch/api/revalidate` with Railway deploys skipped.
PR [#2411](https://github.com/JesusFilm/forge/pull/2411) then merged through
the normal PR-to-main path. Railway Admin deployment
`9d7a5246-fd6e-4ef8-a902-797cd9d818ba` succeeded at Git revision
`d2620ad26886904b36bc1ea51c3457ee6642fbb5`; the running Admin container
reported that exact revision and canonical URL. No manual redeploy was run.

From the deployed Admin container, a controlled invocation of its existing
`emitRevalidateWebhook` helper replayed the current published homepage's
`experience` (`watch-home`, `en`) and `watch-setting` (`en`) event shapes, plus
the existing `watch-route-manifest` event shape. All three returned `sent` with
HTTP 200. Web's production HTTP logs independently recorded three POST 200
responses for `/watch/api/revalidate` at 2026-09-23 23:52:10 UTC. This was a
replay of publication invalidation, **not a new content publication**; no draft
or published content was changed.

The public `/watch` homepage remained HTTP 200 with its authored
`watch-home-recommendations` section. Because it receives concurrent traffic,
our post-replay response was already a cache HIT and unchanged content could not
provide a byte-diff proof. A bounded direct cache check used the existing
published, low-traffic `/watch/hope-collection.html` route: two baseline GETs
were HTTP 200/HIT. One further Admin `watch-route-manifest` helper replay
returned `sent`/200; an immediate GET of that same URL returned HTTP 200/MISS,
and the next returned HTTP 200/HIT. No cache-busting query or content mutation
was used. This directly verifies that the repaired Admin-to-Web path invalidated
an affected public cache entry and that Web rebuilt it. Web HTTP logs recorded
the final POST 200 at 2026-09-23 23:57:11 UTC and the two route GET 200s at
23:57:12 UTC (348 ms, then 12 ms), independently matching the bounded probe.

For a future live publication, check Admin's normal webhook outcome and the
affected page as part of routine release verification. This repair does not
change feat-502's separate invalidation-scope work.
