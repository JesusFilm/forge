---
id: "feat-168"
title: "Manager coverage title locale preference"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-05"
duration: 1
depends_on:
  - "feat-167"
blocks: []
tags:
  - "platform"
  - "admin"
  - "manager"
  - "coverage"
  - "localization"
---

## Problem

The Manager coverage report shows Japanese or other non-selected-language video
titles while the active language filter is English plus Belarusian. Live
Helium/CDP debugging on 2026-06-05 showed
`/api/videos?languageIds=cmokkxw5v03uyqsccis58pea6,cmok1l5gu00hiqsv1jsbhc8hm`
returns 200 with coverage counts scoped to the selected languages, but title
strings such as Japanese video names are already present in the JSON payload.

## Entry Points - Read These First

1. `apps/admin/src/services/manager-read-model.service.ts` - Admin Manager
   coverage read model resolver and title selection.
2. `apps/admin/src/services/manager-read-model.service.test.ts` - focused
   service coverage for the video coverage payload.
3. `apps/manager/src/app/api/videos/route.ts` - Manager proxy route that
   renders the Admin-provided title without locale changes.
4. `apps/manager/src/backend/admin-client.ts` - Admin GraphQL selection used by
   Manager.

## What To Build

1. Keep the existing `managerVideoCoverage` GraphQL payload shape.
2. Keep selected language IDs scoped to coverage counts.
3. Change Admin's display-title selection to prefer English video locale titles,
   then selected-language locale titles, then Manager's existing slug/core-id
   fallback.
4. Add service tests that prove a newer Japanese locale no longer wins over an
   English title and that selected-language titles are used when English is
   absent.

## Constraints

- Do not change coverage-count aggregation semantics.
- Do not change Manager URL state, language selection, or the proxy response
  shape.
- Do not add Manager-side locale guessing; Admin owns the read model.
- Do not hand-edit generated GraphQL artifacts unless the schema changes.

## Verification

- `pnpm --filter @forge/admin test -- --run src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin exec eslint src/services/manager-read-model.service.ts src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/manager test -- --run src/app/api/videos/route.mock.test.ts`
- `pnpm --filter @forge/manager exec eslint src/app/api/videos/route.mock.test.ts`
- `pnpm --filter @forge/manager typecheck`
- Helium/browser smoke proving the coverage page/API no longer shows Japanese
  titles for the English plus Belarusian filter when English titles exist.

## Completion Notes

- Admin Manager video coverage now loads only English and selected-language
  `VideoLocale` title candidates instead of the latest-updated locale row.
- Display-title selection prefers English first, then selected language IDs,
  then returns no localized title so Manager uses its existing slug/core-id
  fallback.
- Manager route coverage now has a regression test for the slug fallback when
  Admin omits a preferred localized title.
- Helium/CDP confirmed the current deployed production API still returns the
  old Japanese-title baseline for English plus Belarusian; this is expected
  until this Admin service change is deployed.
