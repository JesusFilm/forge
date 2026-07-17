---
id: feat-212
title: Clamp Watch single-video GraphQL DB latency with targeted indexes
status: complete
lane: platform
depends_on:
  - feat-211
blocks: []
---

## Problem

The Watch single-video route still spends an internet-eternity amount of time
inside Admin GraphQL. After `feat-211`, the selected-dub projection reduced
payload size and improved median latency, but production APM still showed
`/api/graphql` watch probes at roughly p50 9.28s, p95 14.12s, and p99 15.60s
over the sampled 24h window on 2026-06-26.

Datadog traces for `videoBySlug` showed the remaining cost concentrated in
Prisma/Postgres work:

- `VideoDub.findMany` / playable-duration fallback SQL reached ~6.45s in the
  slowest sampled trace.
- `Video.findFirst` for `videoBySlug` stayed open for ~8.94s while nested
  relation work completed.
- Repeated watch relation lookups touched `video_locale`, `video_relation`,
  `video_image`, `video_study_question`, and `bible_citation` with predicates
  that existing simple indexes only partially covered.

## Scope

- Add raw Postgres indexes in `apps/admin/prisma/migrations/`.
- Prefer partial indexes for public Watch query predicates that always require
  non-deleted/playable rows.
- Use regular `CREATE INDEX IF NOT EXISTS` rather than `CONCURRENTLY` because
  Admin deploys through Prisma migrate in a transaction.
- Do not change the GraphQL schema or web route contract in this step.
- Re-measure the same production probe after deploy.

## Verification

1. Apply the migration in production through the normal Admin deploy path.
2. Re-run `apps/web/scripts/probe-watch-video-snapshot.ts` against
   `https://admin.jesusfilm.org/api/graphql` for `videoSlug=jesus`,
   `languageSlug=english`, `locale=en`, selected-dub projection.
3. Compare Datadog APM for `service:forge-admin env:prod
@http.path_group:/api/graphql` and `forge-admin-prisma` spans before/after.
4. If p50 remains above 2s, follow with a purpose-built Watch snapshot resolver
   to collapse the remaining relation fanout instead of relying on nested
   Pothos relation resolution.

## Outcome

Merged and deployed on 2026-06-26. The indexes exist in production, but the
post-deploy probe still measured the selected Watch snapshot around 7.6s
median with p95 above 13s. Datadog showed the worst `video_dub` spans improved
from the prior ~6.45s outlier, but the route remained dominated by nested
`Video.findUniqueOrThrow` / relation fanout. Follow-up work moves to
`feat-213`.
