---
id: "feat-531"
title: "Repair Admin production Watch revalidation endpoint"
owner: "nisal"
priority: "P1"
status: "in-progress"
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

## Production Repair Plan (2026-09-24)

Read-only Railway configuration inspection confirmed the Admin production
`WEB_REVALIDATE_URL` still uses `https://watch.jesusfilm.org/watch/api/revalidate`.
Admin's `WEB_REVALIDATE_TOKEN` and Web's `REVALIDATION_SECRET` are both present
and match; neither value was printed. An invalid-token POST to the legacy host
returned 301 to `https://www.jesusfilm.org/watch/api/revalidate`; following the
redirect converted POST to GET and returned 405. The same invalid-token POST
directly to the canonical host returned 401, confirming the receiver handles
POST and enforces authentication.

1. Set **only** Admin production `WEB_REVALIDATE_URL` to
   `https://www.jesusfilm.org/watch/api/revalidate` in Railway with deploys
   skipped. Leave both existing secrets and all other variables unchanged.
2. Merge this scoped repair through the usual PR-to-main path. Its
   `apps/admin/.env.example` change enters the Admin service watch pattern, so
   Railway's normal Git deployment activates the staged variable. Do not run a
   manual redeploy or upload local code.
3. Confirm Admin's deployed Git revision and that the effective URL is canonical.
   Stage an identical-content draft of the published English homepage locale
   `cmr96r2y10001p08tkp2bcrqu` only after checking there is no active draft
   or concurrent edit; publish it through Admin's normal service path. This
   preserves visible content while generating Admin `experience` and
   `watch-setting` events.
4. Confirm `web_revalidate.sent` with HTTP 200 for the Admin-originated events,
   then fetch the affected public homepage and check its cache refresh and
   expected authored block. Record only bounded statuses, revision, and public
   content evidence here. If the hook fails, restore the previous URL with
   deploys skipped and use the normal PR-to-main deployment path for rollback.
