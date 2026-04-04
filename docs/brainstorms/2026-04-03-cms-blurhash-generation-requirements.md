---
date: 2026-04-03
topic: cms-blurhash-generation
---

# CMS Blurhash Generation for Image URLs

## Problem Frame

Image blurhash values are currently only populated via core API sync, leaving many images without blurhash data. When images are added or updated directly in the CMS (e.g. via manager or admin), they never get a blurhash. This means consumers (web, mobile) can't show placeholder previews for those images, resulting in layout shifts and a less polished loading experience.

## Requirements

- R1. When a `video_image` record is created or updated with a new `url` value and its `blurhash` field is null, automatically generate and populate the blurhash before saving.
- R2. Do not overwrite existing blurhash values — only generate when the field is null.
- R3. Provide a CLI script/command to backfill blurhash for all existing `video_image` records where blurhash is null, processing in batches.
- R4. Design the generation logic so it can be reused when adding blurhash to other content types in the future.

## Success Criteria

- All `video_image` records have a non-null blurhash after backfill completes.
- New or updated `video_image` records with a URL change automatically receive a blurhash (when not already set).
- No existing blurhash values from core sync are overwritten.
- Backfill script can be run safely multiple times (idempotent).

## Scope Boundaries

- Only `video_image` content type for now. Other content types are future work.
- No changes to the GraphQL schema (blurhash field already exists).
- No changes to core sync behavior — core-synced blurhash values are preserved.
- No admin panel UI changes.

## Key Decisions

- **Lifecycle hook over middleware**: Strapi lifecycle hooks (`beforeCreate`/`beforeUpdate`) are the natural place to intercept saves and generate blurhash. Simpler than custom middleware.
- **Only fill nulls**: Preserves core-synced values and avoids unnecessary recomputation.
- **CLI script for backfill**: Manual trigger avoids deploy-time risk. Batch processing keeps memory usage manageable.
- **Reusable generation function**: Extract blurhash generation into a shared utility so future content types can reuse it with minimal wiring.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] Which blurhash library works best in a Node.js/Strapi v5 context? (e.g. `blurhash`, `sharp` + `blurhash`, `thumbhash`)
- [Affects R3][Technical] What batch size and concurrency is appropriate for backfill given Railway resource limits?
- [Affects R1][Technical] Should blurhash generation be synchronous (in the lifecycle hook, blocking save) or queued async? Sync is simpler but adds latency to saves.

## Next Steps

-> `/ce:plan` for structured implementation planning
