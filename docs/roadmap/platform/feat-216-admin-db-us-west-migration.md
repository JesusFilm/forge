---
id: feat-216
title: Migrate Admin production Postgres to US West
status: complete
lane: platform
depends_on:
  - feat-215
blocks: []
---

## Problem

Production Watch single-video cold requests still spend most of their time
waiting on Admin GraphQL and Prisma/Postgres work. Railway production topology
showed `@forge/admin` and `@forge/admin/worker` running in `us-west2`, while
`@forge/admin/db` was still running in `asia-southeast1-eqsg3a`. That adds
cross-region latency to every Admin database round trip and makes resolver
fanout far more expensive than it should be.

## Scope

- Provision a replacement production Postgres service in `us-west2`.
- Restore the current Admin production database into the replacement service.
- Verify table, index, Prisma migration, and pgvector HNSW index parity.
- Cut over `@forge/admin` and `@forge/admin/worker` database variables together
  so there is no split-brain write window.
- Re-measure Watch single-video cold TTFB and Admin GraphQL latency after
  cutover.

## Verification

1. Railway service list shows the replacement Postgres service running in
   `us-west2`.
2. Source and target have matching table, index, and Prisma migration counts.
3. `public.video_transcript_chunk` HNSW indexes exist on the target.
4. `@forge/admin` and `@forge/admin/worker` deploy successfully against the
   target database.
5. Production probe:
   `https://watch.jesusfilm.org/watch/jesus.html/english.html`.

## Outcome

Completed on 2026-06-26 using the fast cutover path. Provisioned a replacement
production Postgres service in `us-west2`, restored a production snapshot, and
rebuilt the four `video_transcript_chunk` pgvector HNSW indexes with
`maintenance_work_mem = '16MB'` after the default restore hit Railway shared
memory limits. Repointed `DATABASE_URL`, `DATABASE_URL_SYNC`, and
`WORKFLOW_POSTGRES_URL` for both `@forge/admin` and `@forge/admin/worker`, then
redeployed both services successfully.

Post-cutover production checks:

- `https://admin.jesusfilm.org/api/health`: `status=200`,
  `ttfb=0.525989s`.
- `https://watch.jesusfilm.org/watch/jesus.html/english.html` immediately after
  cutover: `status=200`, `ttfb=1.112765s`, `total=1.206336s`.
- Same Watch URL after waiting 65s for the cache window:
  `status=200`, `ttfb=0.879661s`, `total=0.972739s`.

The previous Singapore database service remains available as rollback source.
