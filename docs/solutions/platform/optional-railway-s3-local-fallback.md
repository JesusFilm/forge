---
title: "Optional Railway S3 with local tmp fallback"
category: platform
date: 2026-03-18
tags:
  - railway-s3
  - storage
  - local-dev
  - env-vars
---

# Optional Railway S3 with local tmp fallback

## Problem

Manager app required `RAILWAY_S3_*` env vars to start, making local dev and test environments depend on external S3 credentials. Developers couldn't run the enrichment pipeline without Doppler access or a Railway S3 bucket.

## Solution

Follow the same toggle pattern already used in `apps/cms` for Strapi uploads:

1. Make all `RAILWAY_S3_*` env vars optional in the zod schema (`env.ts`).
2. Toggle on `Boolean(env.RAILWAY_S3_BUCKET)` — if the bucket is set, use S3; otherwise fall back to local files.
3. Local backend writes to `.tmp/artifacts/{assetId}/{artifactType}.{ext}`, mirroring the S3 key structure.
4. Lazy-import `@aws-sdk/client-s3` so the SDK isn't loaded in local-only mode.

## Key patterns

### The S3 toggle convention

```typescript
const useS3 = Boolean(env.RAILWAY_S3_BUCKET)
```

This is the standard across the monorepo. Both `apps/cms` (Strapi upload provider) and `apps/manager` (artifact storage) use it. Any new app that needs Railway S3 should follow the same pattern.

### Local storage directory

The repo convention for ephemeral local data is `.tmp/`:

- `apps/cms` — `.tmp/data.db` (SQLite)
- `apps/manager` — `.tmp/artifacts/` (enrichment artifacts)

Always add `.tmp/` to the app's `.gitignore`.

### Credential guard

When S3 mode is active (`RAILWAY_S3_BUCKET` set) but credentials are missing, fail fast with a clear error rather than letting the AWS SDK throw an opaque error at runtime:

```typescript
if (!env.RAILWAY_S3_ACCESS_KEY_ID || !env.RAILWAY_S3_SECRET_ACCESS_KEY) {
  throw new Error(
    "RAILWAY_S3_ACCESS_KEY_ID and RAILWAY_S3_SECRET_ACCESS_KEY are required when RAILWAY_S3_BUCKET is set",
  )
}
```

### Lazy imports with singleton race protection

When lazy-importing the S3 SDK, use a double-check after `await` to prevent duplicate clients under concurrency:

```typescript
async function getS3() {
  if (!_s3) {
    // Guard credentials before the await
    const { S3Client } = await import("@aws-sdk/client-s3")
    if (!_s3) { // double-check after await
      _s3 = new S3Client({ ... })
    }
  }
  return _s3
}
```

## Files

- `apps/manager/src/config/env.ts` — optional S3 vars
- `apps/manager/src/services/storage.ts` — dual-backend storage service
- `apps/cms/config/plugins.ts` — original CMS pattern (reference)

## PR

- https://github.com/JesusFilm/forge/pull/504
