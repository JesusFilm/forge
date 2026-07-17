---
id: feat-213
title: Clamp Watch single-video GraphQL relation fanout
status: in-progress
lane: platform
depends_on:
  - feat-212
blocks: []
---

## Problem

The Watch single-video route still takes roughly 7-8s in production after the
targeted database indexes from `feat-212`. Datadog traces after the deploy show
the bottleneck has shifted from one obvious missing-index candidate to nested
Admin GraphQL resolver fanout: thousands of `Video.findUniqueOrThrow` spans and
many repeated relation reads for the same video graph.

The prior relation-loader optimization batched `VideoRelation.parent` and
`VideoRelation.child` row hydration, but those fields are Pothos
`prismaField`s and the resolver ignored the `query` argument. Ignoring that
argument prevents Pothos from applying the nested selection it already computed,
so the Watch query falls back into many smaller resolver trips for images,
locales, child relations, and other nested fields.

## Scope

- Keep the Admin GraphQL schema and Web Watch route contract unchanged.
- Make `VideoRelation.parent` and `VideoRelation.child` honor Pothos
  `query` passthrough when hydrating the related video.
- Re-run Admin schema/contract tests and Web Watch content tests.
- Ship and re-measure the same production Watch probe and Datadog trace query.

## Verification

1. `pnpm --filter @forge/admin test -- src/graphql/schema.test.ts src/graphql/public-resolvers.regression.test.ts src/graphql/classification.test.ts`
2. `pnpm --filter @forge/web test -- src/lib/content.test.ts`
3. Production after deploy:
   - `apps/web/scripts/probe-watch-video-snapshot.ts` against
     `https://admin.jesusfilm.org/api/graphql` for `videoSlug=jesus`,
     `languageSlug=english`, `locale=en`.
   - Datadog APM for the production Admin GraphQL route, watching total
     latency and Prisma span count.
