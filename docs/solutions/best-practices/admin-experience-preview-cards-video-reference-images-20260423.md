---
title: "Admin experience preview cards should hydrate referenced video images"
date: 2026-04-23
category: best-practices
module: apps/admin
problem_type: best_practice
component: tooling
severity: low
applies_when:
  - Building index cards from ExperienceLocale block JSON
  - Rendering visual previews for blocks that reference videos by id
  - Simplifying editorial dashboards around visual scanability
tags:
  - admin
  - experiences
  - preview-cards
  - video-hero
  - video-images
  - dashboard
---

# Admin experience preview cards should hydrate referenced video images

## Context

The admin experiences index moved from a text-heavy table to visual cards. The
first pass could show images from `ExperienceLocale.ogImageUrl` and direct media
fields inside block JSON, but `videoHero` cards still rendered blank when the
hero block only contained a `videoId`.

That is expected from the data model: video stills and posters live on
`VideoImage`, not inside the `videoHero` block.

## Guidance

When deriving visual previews from experience blocks, treat direct block media
as the first layer and referenced content as the second layer.

For `apps/admin/src/app/dashboard/live-data.ts`, the useful order is:

1. Use `ExperienceLocale.ogImageUrl` when present.
2. Scan top-level and nested blocks for direct image fields such as `imageUrl`,
   `backgroundImageUrl`, `mediaUrl`, `imageOverrideUrl`, and quote images.
3. Collect referenced `videoId` values from `videoHero`, `video`,
   `mediaCollection.items`, and `videoCarousel.items`.
4. Fetch matching `VideoImage` rows in one query and apply the same image
   priority used by the video library: `videoStill`, `mobileCinematicHigh`,
   `poster`, `still`, then any URL.

Keep the UI card itself lean. The index should help editors recognize and open
the experience; details such as owner, updated time, block counts, and locale
coverage belong inside the record view.

## Why This Matters

Experience blocks often describe relationships rather than duplicating media
URLs. A visual dashboard that only reads the block JSON will underrepresent
pages built from videos, especially video-led pages where `videoHero` is the
primary visual signal.

Hydrating referenced video images keeps the card preview aligned with the
experience a viewer will actually see while avoiding duplicated image fields in
the block payload.

## When to Apply

- An index card needs a visual preview for an experience, playlist, or route
  assembled from blocks.
- A block contains an entity reference such as `videoId` instead of a direct
  image URL.
- The referenced entity already has an ordered image/still/poster table.

## Examples

```ts
const videoIds = locales.flatMap((locale) =>
  videoIdsFromBlocks(parsedExperienceBlocks(locale)),
)

const videoImages = await prisma.videoImage.findMany({
  where: { videoId: { in: videoIds } },
  select: { videoId: true, url: true, kind: true, createdAt: true },
  orderBy: { createdAt: "asc" },
})
```

Then pass a `Map<videoId, VideoImageRow[]>` into the preview resolver so
`videoHero.videoId` can resolve to the preferred still/poster without making
per-card queries.

## Related

- `apps/admin/src/app/dashboard/live-data.ts`
- `apps/admin/src/app/dashboard/experiences/page.tsx`
- `apps/admin/src/domain/blocks.ts`
