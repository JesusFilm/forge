---
id: "feat-123"
title: "Admin video database presigned restore access"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-05-15"
duration: 1
depends_on:
  - "feat-122"
blocks: []
tags:
  - "admin"
  - "infrastructure"
  - "database"
  - "security"
---

## Problem

The reviewed admin video DB restore tooling could download latest backups only
when the caller had raw Railway S3 credentials. That worked for trusted
operators but was too broad for local and staging self-service because S3
credentials can list/read/write outside the one backup object needed for a
restore.

## What Shipped

1. Production admin now exposes
   `POST /api/internal/video-db-backups/presign`.
2. The route accepts `Authorization: Bearer <key>` matching
   `BACKUP_DOWNLOAD_API_KEYS`.
3. The route signs only the latest `.dump` under the reviewed
   `admin-video-db-backups/<profile>/` prefix.
4. Signed URLs are GET-only and expire after 10 minutes.
5. `restore:video-db:latest` prefers the presign endpoint when
   `BACKUP_DOWNLOAD_API_KEY` is present, falling back to direct S3 only for
   operators who still have `RAILWAY_S3_*`.
6. Dev and staging Doppler configs hold one restore token each; production's
   `BACKUP_DOWNLOAD_API_KEYS` dynamically references those two config values.

## Security Notes

- Keep `BACKUP_DOWNLOAD_API_KEYS` disjoint from `WORKFLOW_API_KEYS` and
  `WEB_ADMIN_API_KEYS`; admin asserts this at boot.
- Do not accept arbitrary S3 keys on the presign endpoint. The first version is
  intentionally latest-by-profile only.
- Do not log bearer token values. Route logs include only profile, object key,
  and expiry.
- Production admin still needs `RAILWAY_S3_*` configured because it owns S3
  signing. Dev and staging need only `BACKUP_DOWNLOAD_API_KEY`.

## Verification

```bash
pnpm --filter @forge/admin test src/app/api/internal/video-db-backups/presign/route.test.ts src/scripts/video-db-backup.test.ts src/config/env.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
```
