---
id: "feat-251"
title: "Watch collection sequential downloads"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-14"
duration: 3
depends_on:
  - "feat-196"
blocks:
  - "feat-266"
tags:
  - "web"
  - "admin"
  - "watch"
  - "download"
  - "ux"
---

## Resolution

**Status:** Completed on 2026-09-04 after hardening the redirect-era queue. The
collection lookup now returns encrypted, identifier-bound capabilities instead
of making every episode repeat its Admin lookup. Each start or retry refreshes
the one-day capability batch, and gated requests bind it to the authenticated
account. Chromium streams one response at a time into a viewer-selected
directory, uses collision-safe filenames, removes partial writes, and records
completion only after the file write closes. The native-download fallback
performs an authenticated HEAD acknowledgement before each anchor, reports
browser handoff rather than disk completion, and preserves unfinished stable
episode IDs for retry.

## Problem

Watch collection pages list ordered episodes but require viewers to open every
episode and repeat language, quality, Terms, and download choices. The LUMO Luke
page currently has 26 episodes, making field preparation slow and error-prone.

## Entry Points - Read These First

1. `docs/plans/2026-07-14-001-feat-watch-collection-sequential-downloads-plan.md` - implementation decisions and acceptance cases.
2. `apps/web/src/components/watch/SeriesPageClient.tsx` - collection page orchestration.
3. `apps/web/src/components/watch/DownloadModal.tsx` - single-video auth, Terms, and proxy pattern.
4. `apps/admin/src/services/video.service.ts` - bounded child-language query pattern.
5. `apps/web/src/app/api/download/route.ts` - authenticated download resolver
   that redirects media downloads off Web.

## Grep These

- `childDubLanguages`
- `downloadableChildDubs`
- `SeriesPageClient`
- `buildDownloadProxyUrl`
- `resolveDownloadSessionAccess`

## What To Build

1. Add a bounded Admin field returning one downloadable Dub per direct child for one language.
2. Add a collection modal that selects language and relative quality once.
3. Download eligible children in displayed order with only one active transfer.
4. Show skipped, completed, failed, canceled, and retry states.
5. Preserve the existing account, Terms, filename, resolver, analytics, and
   SSRF contracts.
6. Keep all collection download work lazy until viewer intent.

## Constraints

- Never project every Dub for every child onto the collection route.
- Never expose raw download URLs in client markup or server-action results.
- Do not change single-video downloads or public Watch route shapes.
- Do not run collection transfers concurrently.

## Verification

- Focused Admin and Web unit/component tests.
- Admin schema and `packages/admin-graphql` generation.
- Web typecheck, lint, message parity, and focused download tests.
- PR commit history passes the repository commitlint check.
- Browser smoke and screenshot on the LUMO Luke collection page.
- Resource timing confirms no collection-download request before intent.
