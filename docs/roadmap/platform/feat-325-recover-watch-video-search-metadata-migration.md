---
id: "feat-325"
title: "Recover Watch video search metadata migration"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-08-01"
duration: 1
depends_on:
  - "feat-323"
blocks:
  - "feat-324"
tags:
  - "platform"
  - "admin"
  - "database"
  - "production"
---

## Problem

Admin production deployment of `feat-323` failed while applying
`0047_video_locale_search_social_metadata`: Prisma ran the migration in a
transaction, but PostgreSQL rejects `CREATE INDEX CONCURRENTLY` inside a
transaction block. The failed migration row also blocks future deploys until
it is explicitly marked rolled back and reapplied.

## Entry Points â€” Read These First

1. `apps/admin/prisma/migrations/0047_video_locale_search_social_metadata/migration.sql` â€” failed DDL and the transaction-compatible replacement.
2. `apps/admin/src/scripts/migrate-deploy-known-recovery.ts` â€” exact-name `P3009` recovery allowlist and `--rolled-back` retry flow.
3. `apps/admin/src/scripts/migrate-deploy-known-recovery.test.ts` â€” recovery recognition and command-sequence tests.
4. `apps/admin/src/scripts/prisma-migration-deploy-safety.test.ts` â€” Admin-wide guard against transaction-illegal concurrent index DDL.
5. `apps/admin/src/services/video-locale-search-social-migration.test.ts` â€” migration contract for the search/social metadata columns, index, constraint, and seed.

## Grep These

- `0047_video_locale_search_social_metadata`
- `CREATE INDEX CONCURRENTLY`
- `isKnownRecoverableP3009`
- `migrate resolve --rolled-back`
- `migrate-deploy-known-recovery`

## What To Build

1. Replace concurrent index creation with the transaction-compatible Admin
   migration convention.
2. Add `0047_video_locale_search_social_metadata` to the narrow known-failed
   migration recovery allowlist so the next deploy resolves the failed row as
   rolled back before reapplying the corrected migration.
3. Correct the migration tests and add an Admin-wide migration guard so they
   reject, rather than require, `CREATE INDEX CONCURRENTLY`.
4. Verify the repaired Admin deployment applies migration `0047`, then verify
   the production JESUS HTML metadata after Web is live.

## Constraints

- Do not mark the failed migration as applied.
- Do not bypass the normal PR-to-main deployment flow.
- Keep recovery restricted to the exact failed migration name.

## Verification

- `pnpm --filter @forge/admin test -- src/services/video-locale-search-social-migration.test.ts src/scripts/migrate-deploy-known-recovery.test.ts src/scripts/prisma-migration-deploy-safety.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter roadmap generate:readme`
- GitHub checks pass on the hotfix PR.
- Railway Admin deploy logs show migration recovery and successful apply.
- Production `/watch/jesus.html` emits the approved title and description.
