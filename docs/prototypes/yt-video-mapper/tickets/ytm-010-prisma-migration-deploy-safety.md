---
id: YTM-010
title: "Guard Prisma migration deploy safety"
status: complete
priority: P1
depends_on:
  - YTM-009
---

# YTM-010: Guard Prisma migration deploy safety

## Goal

Prevent yt-video-mapper migrations from repeating the production deploy failure
patterns found during the queued-job expiry rollout.

## Scope

- Reject migration SQL that uses transaction-hostile `CONCURRENTLY` clauses.
- Reject migrations that add a Postgres enum value and reference that new value
  again before the migration transaction can commit.
- Keep enum additions allowed when dependent SQL is split into a later
  migration.
- Keep the guard close to the mapper Prisma schema tests so it runs in the
  normal backend test command.

## Acceptance Criteria

- A synthetic `CREATE INDEX CONCURRENTLY` migration fixture fails the guard.
- A synthetic enum-add-plus-partial-index fixture fails the guard.
- Existing yt-video-mapper migrations pass the guard.
- Unsafe-looking text in SQL comments is ignored.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend test -- src/db/schema.test.ts
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
pnpm --filter @forge/yt-video-mapper-backend lint
```
