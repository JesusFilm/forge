---
title: "CMS scene embedding indexer: preserve legacy multi-video API compatibility"
category: integration-issues
module: CMS
date: 2026-04-11
problem_type: integration_issue
component: service_object
symptoms:
  - "Legacy `/scene-embedding/index` requests with row-level numeric `videoId` values for more than one video started failing with `multi_video_request`"
  - "The new request-level `videoDocumentId` path worked, but it accidentally narrowed the older numeric request shape instead of extending it additively"
  - "Existing scene embedding callers could no longer replace rows for multiple videos in one request"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - cms
  - scene-embeddings
  - video-document-id
  - api-compatibility
  - backward-compatibility
  - pgvector
affected_components:
  - apps/cms/src/api/scene-embedding/services/indexer.ts
  - apps/cms/src/api/scene-embedding/services/indexer.test.ts
related_docs:
  - docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md
  - docs/solutions/best-practices/pgvector-embedding-indexing-strapi-v5.md
  - docs/solutions/platform/backfill-worker-pattern-manager-20260407.md
  - docs/solutions/best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md
  - docs/plans/2026-04-11-feat-integrate-scene-embeddings-into-enrichment-plan.md
  - docs/plans/2026-04-09-feat-sync-enrichment-embeddings-into-cms-vector-index-plan.md
  - docs/brainstorms/2026-04-10-scene-embeddings-from-enrichment-pipeline-requirements.md
  - docs/roadmap/content-discovery/feat-045-pipeline-integration.md
---

# CMS scene embedding indexer: preserve legacy multi-video API compatibility

## Problem

The scene embedding PR that added request-level `videoDocumentId` support to
`/scene-embedding/index` also introduced a compatibility regression in the CMS
write path.

Before the refactor, callers could send a request like this with no request-level
target:

```ts
await indexSceneEmbeddings(strapi, {
  scenes: [
    { ...sceneFields, videoId: 41, sceneIndex: 0 },
    { ...sceneFields, videoId: 42, sceneIndex: 1 },
  ],
})
```

That shape was valid. The service deleted stale rows for both videos and wrote
the replacement scene rows in one request.

During the `videoDocumentId` refactor, the no-request-target path was narrowed to
a single resolved target, so the same payload started failing with
`SceneEmbeddingIndexError(400, "multi_video_request")`.

## Reproduction

The regression showed up in PR review rather than in the enrichment flow itself:

1. add request-level `videoDocumentId` support for enrichment-driven scene sync
2. keep request-level targets single-video, published-only, and conflict-checked
3. accidentally apply that same single-target assumption to the legacy
   row-level numeric path

The broken condition was simple:

- no request-level `videoId`
- no request-level `videoDocumentId`
- at least two distinct row-level numeric `scenes[].videoId` values

## Root Cause

`resolveScenesForWrite()` was refactored around one resolved `target`.

That was correct for the new request-level target mode, but the same invariant
was then applied to the older row-level numeric mode. In practice, the service
went from:

- request-level target: single resolved video
- row-level numeric target: one or more videos

to:

- request-level target: single resolved video
- row-level numeric target: also forced to one video

That was an API-contract regression, not a database or recommendation-model
change. The broader scene embedding design still wanted numeric `video_id`
internally. The mistake was collapsing an additive boundary change into a
narrower accepted request shape.

## Solution

The fix kept the new request-level path and restored the old row-level numeric
behavior.

### 1. Keep request-level targets single-video

When the request includes `videoId` or `videoDocumentId`, the service still:

- resolves one published target
- rejects conflicting row-level `videoId`s with `conflicting_video_id`
- normalizes every scene row onto that one resolved numeric video id

That preserves the enrichment contract.

### 2. Restore row-level numeric multi-video mode

When the request has no request-level target, the service now:

- collects every distinct row-level numeric `videoId`
- resolves each one through the published-video guard
- remaps each scene row to its resolved numeric video id
- returns `resolvedVideoIds` when more than one video was written

The key split now looks like this:

```ts
if (requestTargetProvided) {
  const target = await resolveSceneTarget(strapi, input)

  return {
    responseTarget: target,
    resolvedVideoIds: [target.resolvedVideoId],
    scenes: input.scenes.map((scene) => ({
      ...scene,
      videoId: target.resolvedVideoId,
    })),
  }
}

const targets = new Map(
  await Promise.all(
    rowVideoIds.map(async (videoId) => [
      videoId,
      await resolveSceneTarget(strapi, { videoId }),
    ]),
  ),
)
```

### 3. Delete stale rows for every affected legacy target

The write path now keeps the single-video delete for request-targeted or
single-row-target requests, but restores the old multi-video delete for legacy
row-level batches:

```ts
if (!options?.skipDelete) {
  if (resolvedVideoIds.length === 1) {
    await trx.raw("DELETE FROM scene_embeddings WHERE video_id = ?", [
      resolvedVideoIds[0],
    ])
  } else {
    await trx.raw(
      "DELETE FROM scene_embeddings WHERE video_id = ANY(?::int[])",
      [resolvedVideoIds],
    )
  }
}
```

That preserves the original replace-in-one-request behavior instead of forcing
callers to split the batch themselves.

### 4. Add a characterization-style regression test

The most important test change was flipping the old failing expectation into a
compatibility assertion:

- a two-video numeric row-level payload succeeds
- delete bindings include both video ids
- insert bindings contain both resolved ids
- the result reports `resolvedVideoIds: [41, 42]`

This makes the old accepted request shape explicit in the test suite so a future
refactor cannot quietly narrow it again.

## Why This Works

The fix restores the correct boundary split:

1. `videoDocumentId` is an additive API convenience for manager-to-CMS calls.
2. Numeric `video_id` remains the internal storage key for
   `scene_embeddings`.
3. Legacy row-level numeric callers are still valid even when they touch more
   than one video in one request.

That matters because the rest of the scene embedding system still depends on the
numeric key:

- pgvector write-side indexing
- recommendation SQL joins through Strapi link tables
- backfill progress tracking through `scene_embeddings`

So the right move was not to rewrite the storage model. It was to keep the new
request-level target mode scoped to the new enrichment use case and preserve the
older multi-video numeric contract beside it.

## Verification

Automated checks run after the fix:

- `cd apps/cms && pnpm test -- src/api/scene-embedding/services/indexer.test.ts src/api/scene-embedding/controllers/scene-embedding.test.ts`
- `cd apps/cms && pnpm typecheck`
- `cd apps/cms && pnpm exec eslint src/api/scene-embedding/services/indexer.ts src/api/scene-embedding/services/indexer.test.ts src/api/scene-embedding/controllers/scene-embedding.test.ts`

Review result:

- PR #717 review finding closed by commit `31bf194`
- request-level `videoDocumentId` indexing still returns a single
  `resolvedVideoId`
- legacy row-level numeric multi-video payloads succeed again and return
  `resolvedVideoIds`

## Prevention

1. Treat `videoDocumentId` support as additive API-boundary behavior. Do not
   collapse the existing row-level numeric `videoId` contract into the new
   request-level target path.
2. Keep target resolution split into explicit modes:
   - request-level `videoId` / `videoDocumentId`: single target
   - row-level `videoId` only: legacy multi-video batch mode
3. Before refactoring an existing endpoint contract, add characterization tests
   for the accepted payload shapes on `main`.
4. When stricter validation rejects payloads that used to work, either preserve
   the old behavior or document the breaking change explicitly.
5. Review endpoint changes for API shape drift, not only for current in-repo
   caller usage. "No caller currently does this" is not enough when a custom
   internal endpoint already accepted the shape.

## Operational Checks

- After deploy, run or inspect one legacy numeric multi-video scene indexing
  request and confirm it no longer returns `multi_video_request`.
- Watch CMS logs for spikes in:
  - `multi_video_request`
  - `invalid_video_target`
  - `conflicting_video_id`
- Spot-check that `scene_embeddings` rows exist for every video id referenced by
  a legacy numeric multi-video payload.

Healthy behavior:

- legacy row-level numeric multi-video requests succeed
- request-level `videoDocumentId` syncs still resolve one published CMS video
  and index rows normally

Failure signal:

- 400 responses for previously accepted row-level numeric multi-video requests

## Related References

- [Vector embedding storage scope and PR sequencing](../best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md)
- [pgvector embedding indexing in Strapi v5](../best-practices/pgvector-embedding-indexing-strapi-v5.md)
- [Backfill worker pattern: Next.js manager with CMS queue](../platform/backfill-worker-pattern-manager-20260407.md)
- [pgvector recommendation query with locale-aware joins](../best-practices/pgvector-recommendation-query-locale-graphql-strapi-v5.md)
- [Plan: integrate scene embeddings into enrichment pipeline](../../plans/2026-04-11-feat-integrate-scene-embeddings-into-enrichment-plan.md)
- [Plan: sync enrichment embeddings into CMS vector index](../../plans/2026-04-09-feat-sync-enrichment-embeddings-into-cms-vector-index-plan.md)
- [Brainstorm: scene embeddings from enrichment pipeline](../../brainstorms/2026-04-10-scene-embeddings-from-enrichment-pipeline-requirements.md)
- [Roadmap: video vectorization pipeline integration](../../roadmap/content-discovery/feat-045-pipeline-integration.md)
