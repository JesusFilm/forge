---
id: "feat-413"
title: "Playlist moderation aggregate filters"
owner: "unassigned"
priority: "P1"
status: "not-started"
start_date: "2026-08-22"
duration: 3
depends_on:
  - "feat-411"
blocks: []
tags:
  - "admin"
  - "graphql"
  - "moderation"
  - "security"
  - "ugc"
---

## Problem

The moderator queue pages individual reports and supports only category
filtering. It does not expose playlist moderation state or an aggregate report
count, so status/count filters and state-specific actions cannot be correct
across cursor pages.

## Entry Points — Read These First

1. `apps/admin/src/services/user-playlist-moderation.service.ts` — current
   report-level pagination and privacy projection.
2. `apps/admin/src/graphql/mutations/user-playlist.ts` — Admin queue and
   block/restore GraphQL contract.
3. `apps/admin/src/app/dashboard/user-playlist-moderation/page.tsx` — supported
   category filter and per-page grouping.
4. `apps/admin/src/app/dashboard/user-playlist-moderation/moderation-queue.tsx`
   — privacy-safe details and confirmed actions.
5. `apps/admin/prisma/schema.prisma` — playlist moderation/report indexes.

## Grep These

- `ReportQueueInputSchema|listReports|UserPlaylistModeratorReportPage`.
- `userPlaylistReportQueue|moderationState|reportCount`.
- `user-playlist-moderation` in `apps/admin/src/app/dashboard`.

## What To Build

1. Project a playlist-level queue item with internal playlist ID, current
   `ACTIVE|BLOCKED` state, aggregate report count, latest-report timestamp, and
   privacy-redacted retained reports; omit owner and reporter identity.
2. Apply closed moderation-state and bounded minimum-report-count filters in
   SQL before pagination. Use a deterministic cursor over latest-report time
   plus playlist ID so groups cannot split across pages.
3. Expose the aggregate through the Admin-only GraphQL type without widening
   owner/public playlist types or generic relations.
4. Update the Admin route to submit supported filters and show only Block for
   active playlists or Restore for blocked playlists, retaining reason,
   confirmation, announcement, and focus behavior.

## Constraints

- Do not derive aggregate filters from one client page of reports.
- Do not expose owner subject, reporter IP/digest, capability material, audit
  actor, ciphertext metadata, or expired plaintext.
- Keep moderation independent from owner lifecycle and share state.
- Preserve retention deletion and identical public 404 behavior after block.

## Verification

- Add service tests for aggregate counts, state/count/category intersections,
  stable pagination, concurrent reports, and retention-expired details.
- Add GraphQL permission/shape tests proving only explicit Admin moderators can
  query the aggregate.
- Add route/component tests for every filter, state-specific action, empty
  result, pagination, success announcement, and focus return.
- Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql`, then run
  Admin/Admin GraphQL format, lint, typecheck, and focused tests.
