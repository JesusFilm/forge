---
date: 2026-04-08
topic: nested-component-video-relations
---

# Fix Video Relations in Deeply Nested Seed Components

## Problem Frame

After PR #679 fixed locale-aware video resolution in Easter & Christmas seeds, a new issue surfaced: **all 30 `sections.video` components have NULL video relations** in the database, while `sections.video-hero` components (same seed, same `video: numericId` pattern) work correctly.

The difference is nesting depth:

- `sections.video-hero`: Experience → blocks (depth 1) — **relations created correctly**
- `sections.video`: Experience → blocks → `sections.section` → content (depth 2+) — **relations silently dropped**

Strapi v5 Document Service does not propagate relation fields in components nested more than one level deep. This affects all video sections in both Easter and Christmas seeds — the mobile app shows video cards without thumbnails because the video relation (which carries `video_images`) is missing.

## Requirements

- R1. Every `sections.video` component created by the seed must have its `video` relation populated in the `components_sections_videos_video_lnk` table after seeding.
- R2. The fix must work for both Easter and Christmas seeds (30 affected components total).
- R3. `sections.video-hero` and `sections.video-carousel-item` relations must continue working (no regression).
- R4. The fix must work on both fresh databases and databases with production data imported via `pnpm data-import`.

## Success Criteria

- `SELECT * FROM components_sections_videos_video_lnk` returns a row for every `sections.video` component after seeding.
- Mobile app renders video thumbnails on all video sections (Easter Explained, My Last Day, etc.).
- No changes to Strapi content type schemas.

## Scope Boundaries

- Not fixing Strapi's Document Service itself — working around the limitation in seed scripts.
- Not changing how `sections.video-hero` works (it already works).
- Not adding new component types or relations.

## Key Decisions

- **Post-create SQL patch**: Since Strapi Document Service silently drops nested relations, the seed should insert the link table rows directly after Experience creation. This is the pragmatic approach — the alternative (restructuring nesting to be shallower) would require content type schema changes.
- **Reuse existing `findOrCreatePublishedVideo` pattern**: The video lookup logic from PR #679 is correct; only the link insertion is missing.

## Dependencies / Assumptions

- The `components_sections_videos_video_lnk` table uses `inv_video_id` (component FK) and `video_id` (video FK).
- Video components are created by Strapi during Experience create — they get IDs assigned. The patch runs after creation to fill in the missing link rows.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Exact timing of the post-create patch: query component IDs by section_key after Experience creation, or track them from the create response?
- [Affects R1][Needs research] Does Strapi v5 Document Service return nested component IDs in the create response, or do we need to query the DB?
- [Affects R2][Technical] Should the patch be a shared utility in seed-utils.ts or inline in each seed?

## Next Steps

-> `/ce:plan` for structured implementation planning
