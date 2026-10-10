---
id: "feat-167"
title: "Manager coverage video aggregation"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-05"
duration: 1
depends_on:
  - "feat-125"
blocks: []
tags:
  - "platform"
  - "admin"
  - "manager"
  - "coverage"
---

## Problem

Production Manager coverage renders the shell and language catalog, but the
video list area falls into the generic "Video data couldn't be loaded" state.
Authenticated Helium/CDP debugging on 2026-06-05 showed
`/api/videos`, `/api/videos?languageIds=529`, and
`/api/videos?languageIds=cmokkxw5v03uyqsccis58pea6` all returned Cloudflare
502 responses after roughly 12-15 seconds while `/api/languages` returned 200.

## Entry Points - Read These First

1. `apps/manager/src/app/api/videos/route.ts` - Manager proxy route that calls
   Admin Manager read models.
2. `apps/manager/src/app/api/videos/cache.ts` - cache boundary for full and
   language-filtered video coverage.
3. `apps/admin/src/services/manager-read-model.service.ts` - Admin video
   coverage read model resolver implementation.
4. `apps/admin/src/services/manager-read-model.service.test.ts` - focused
   service coverage.

## What Changed

1. Kept the existing `managerVideoCoverage` GraphQL payload shape.
2. Stopped loading every subtitle and dub row through nested Prisma includes on
   the full video query.
3. Added grouped `videoSubtitle` and `videoDub` count queries by `videoId` and
   `aiGenerated`, scoped by selected language IDs when present.

## Verification

- Helium/CDP production debug: `/api/videos*` returned Cloudflare 502 while
  `/api/languages` returned 200.
- `pnpm --filter @forge/admin test -- --run src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin exec eslint src/services/manager-read-model.service.ts src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
