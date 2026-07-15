---
id: "feat-255"
title: "Admin video-search backup snapshot"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on:
  - "feat-122"
blocks: []
tags:
  - "admin"
  - "search"
  - "database"
  - "backup"
---

## Problem

Local watch search testing needs production-like transcript chunk and embedding
rows. The production backup scheduler currently publishes the default
`video-core` snapshot, which excludes `video_transcript` and
`video_transcript_chunk`; the restore signer therefore has no usable
`video-search` snapshot for local semantic search testing.

## Entry Points

1. `apps/admin/src/scripts/video-db-backup.ts` - reviewed backup profiles and
   scheduled backup entry point.
2. `apps/admin/src/services/video-db-backup/job.ts` - scheduler ledger and
   workflow job orchestration.
3. `apps/admin/src/services/video-db-backup/job.test.ts` - scheduler behavior
   tests.

## What To Build

1. Keep `video-core` scheduled backups.
2. Add scheduled `video-search` backups so production uploads a latest dump
   under `admin-video-db-backups/video-search/`.
3. Keep restore and one-off backup safety behavior unchanged.

## Verification

```bash
pnpm --filter @forge/admin test src/scripts/video-db-backup.test.ts src/services/video-db-backup/job.test.ts src/workflows/videoDbBackup.test.ts
pnpm --filter @forge/admin typecheck
```
