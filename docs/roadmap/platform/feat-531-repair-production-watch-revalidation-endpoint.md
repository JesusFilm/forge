---
id: "feat-531"
title: "Repair Admin production Watch revalidation endpoint"
owner: "nisal"
priority: "P1"
status: "not-started"
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
