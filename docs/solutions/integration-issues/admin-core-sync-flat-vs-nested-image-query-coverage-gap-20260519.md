---
title: "Core's flat videoImages query is sparse; use nested Video.images for full coverage"
date: "2026-05-19"
category: integration-issues
module: apps/admin/src/services/core-sync/phases/sync-video-images.ts
problem_type: integration_issue
component: service_object
symptoms:
  - "After a fresh DB reset + core-sync, only 12% of admin's 1,099 videos had any video_image row (135 covered, 964 missing)"
  - "Search-card thumbnails fell back to dark play-icon placeholders for ~88% of results"
  - "Watch-modern showed the correct branded marketing posters for the same videos; admin diverged silently"
  - "Direct Core probe: videoImages(offset:0, limit:1) returns sparse subset (~270 rows total catalogue-wide); videos { images { ... } } returns 2 images per video"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - apps/admin/src/services/core-sync/phases/sync-video-images.test.ts
  - apps/admin/src/services/core-sync/phases/sync-videos.ts
  - apps/admin/src/services/core-sync/phases/sync-dubs.ts
tags:
  - core-sync
  - graphql
  - admin
  - video-images
  - coverage-gap
  - integration-pattern
  - sync-phase
---

# Core's flat videoImages query is sparse; use nested Video.images for full coverage

## Problem

`apps/admin/src/services/core-sync/phases/sync-video-images.ts` paginated Core's flat root-level `videoImages(offset, limit, where)` query as if it were the canonical image dataset. That endpoint is a sparse secondary index — it only indexes ~270 image records catalogue-wide regardless of how the loop is parameterised. The canonical image set for every video lives on Core's nested `Video.images` field, which the phase never touched. Coverage in admin's `video_image` table sat at ~12% (135 of 1,099 videos), so 88% of search results rendered placeholder thumbnails for content that Core had perfectly good marketing posters for.

## Symptoms

- `video_image` plateaus at 270 rows regardless of fresh vs incremental sync.
- Watch-modern shows correct marketing posters for the same videos (it walks `video { images { ... } }`); admin diverges silently — visible only via side-by-side comparison.
- No errors, no log noise. The flat query always returns valid, parseable rows — just a sparse subset of them.

## What Didn't Work

- **Assuming "the data isn't there."** First reflex was that Core simply didn't have more image records — the flat-query response felt internally consistent. False; direct probing showed every video had 2 images on the nested field.
- **Mux-based fallbacks for posters.** Investigated whether `mux_video.thumbnail` or Mux's `image.mux.com/{playbackId}/thumbnail.jpg` could fill the gap. Mux can produce frame-grabs of the video, but those are video frames at time 0 — for videos sharing an opening intro card or title slate (e.g., the "Why Should I Believe the Bible?" episode series), the frames look identical across distinct videos. Not the same product as Core's curated marketing poster.
- **Increasing `PAGE_SIZE` on the flat query.** Doesn't help — the flat list is inherently sparse; pagination ceiling doesn't change what the endpoint indexes.
- **Backfilling `video_image` rows from manager artifacts or admin's media library.** The data wasn't in those stores either; admin's source of truth for Core-sourced images IS Core.

The signal that unlocked the diagnosis was a one-line direct probe against Core's GraphQL:

```graphql
{
  video(id: "1_cl13-0-0") {
    images {
      url
      mobileCinematicHigh
      thumbnail
      videoStill
    }
  }
}
```

returned 2 images for the same video that the flat `videoImages(offset:0, limit:1)` query missed entirely.

## Solution

Replace the flat `videoImages` pagination loop with a paginated `videos` query that includes the nested `images` field, then flatten each video's `images[]` into per-image rows before the existing validation + upsert path.

**Before** (sparse — what shipped originally):

```ts
const PAGE_SIZE = 10000

const VIDEO_IMAGES_QUERY = `
  query VideoImages($offset: Int!, $limit: Int!, $where: VideoImagesFilter) {
    videoImages(offset: $offset, limit: $limit, where: $where) {
      id updatedAt videoId aspectRatio url mobileCinematicHigh
      mobileCinematicLow mobileCinematicVeryLow thumbnail videoStill blurhash
    }
  }
`
// ...walks flat list, looks up videoMap.get(image.videoId) per row
```

**After** (canonical — what the rewrite uses):

```ts
const PAGE_SIZE = 100 // smaller — nested payload is heavier per item

const VIDEOS_WITH_IMAGES_QUERY = `
  query VideosWithImages($offset: Int!, $limit: Int!, $where: VideosFilter) {
    videos(offset: $offset, limit: $limit, where: $where) {
      id
      images {
        id updatedAt aspectRatio url mobileCinematicHigh
        mobileCinematicLow mobileCinematicVeryLow thumbnail videoStill blurhash
      }
    }
  }
`

// Per-page try/catch + `?? []` unwrap is load-bearing: a coreQuery throw must
// advance offset (not break the loop), and a success-with-undefined-data must
// default to an empty page rather than blowing up the flatten below. Lifting
// just the flatten into a sibling phase without these wrappers re-introduces
// the broken-pagination failure mode.
let rawVideos: CoreVideoWithImages[] = []
try {
  const result = await coreQuery<{ videos: CoreVideoWithImages[] }>(
    VIDEOS_WITH_IMAGES_QUERY,
    {
      offset,
      limit: PAGE_SIZE,
      where: since ? { updatedAt: { gte: since } } : undefined,
    },
  )
  rawVideos = result.data?.videos ?? []
} catch (err) {
  stats.errors++
  offset += PAGE_SIZE
  continue
}

// Flatten { video.id, video.images[] } → image rows with parent's id injected
// as `videoId`. Matches the SHAPE `CoreVideoImageSchema` expects, so the
// existing upsert path is unchanged — but the validation step uses
// `safeParse` with advance-and-continue on failure (not `parse` with throw),
// matching the per-page-error-isolation contract of sibling phases.
const rawImages = rawVideos.flatMap((video) =>
  video.images.map((image) => ({ ...image, videoId: video.id })),
)
```

Three companion hardenings landed in the same change, copying patterns already present in sibling phases (`sync-videos.ts`, `sync-dubs.ts`):

1. **Post-loop soft-delete guard strengthened** to `seenCoreIds.size > 0`. Without it, a transient mid-pagination empty page (Core returning `{ videos: [] }` on a hiccup) would mass-tombstone every `video_image` row whose `syncedAt < phaseStartedAt`. The original phase only checked `firstPageWasEmpty`, which doesn't catch the mid-walk case.
2. **Per-page `try/catch` around `coreQuery`** so one failed page advances offset and continues rather than breaking pagination and triggering the full-run soft-delete on an incomplete `seenCoreIds`.
3. **`progress.setTotal` arithmetic** changed from `offset * 2 + images.length` to `offset + rawVideos.length` so it tracks the same unit (`videos`) that `progress.increment(rawVideos.length)` reports.

Three tests pinned in `sync-video-images.test.ts`:

- "syncs image rows from the nested Video.images field" — happy path with a single image per video.
- "flattens multiple images per video — the load-bearing coverage fix" — explicit regression pin so a future refactor can't silently revert to per-video first-image-only output.
- "forwards incremental updatedAt watermarks and skips full soft-delete" — preserves existing incremental-sync behavior.

**Outcome:** `video_image` row count went from 270 → 2,168. Coverage went from 135 / 1,099 videos (12%) → 1,094 / 1,099 videos (99.5%). The 5 remaining uncovered videos are genuinely missing images in Core.

## Prevention

**Rule of thumb for the next Core sync phase: prefer nested over flat for entity-owned relations.**

When Core's schema exposes both a flat root-level list (`fooItems(offset, limit, where)`) and a nested field on the parent entity (`video { fooItems { ... } }`), the nested field is the canonical source. The flat list is often a secondary index with no completeness guarantee — its row count does NOT track the relation. Verify by running this one-line probe against Core before committing the phase:

```bash
# Sample 3 parents at random; confirm the nested response is non-empty.
curl -sS -X POST $CORE_API_URL -H 'Content-Type: application/json' \
  -d '{"query":"{ videos(limit:3) { id <nested-relation> { id } } }"}'
```

If the nested form returns rows but the flat root-level form is dramatically smaller than `parents × items_per_parent`, the flat form is sparse — use nested.

**The choice isn't always nested or always flat — probe per relation.** Some relations trigger Core's resolver fan-out cliff and must use the flat shape; see the counterpart at [core-graphql-unbounded-relation-fan-out-20260504](../platform/core-graphql-unbounded-relation-fan-out-20260504.md) for the timeout failure mode. The decision is "which form is canonical for THIS relation" — probe both before committing.

**Incremental-sync edge to document on the phase itself** (now noted in code as well): the nested `videos` query filters by parent-video `updatedAt`, not image `updatedAt`. An image edited in Core after its parent video was last touched will not be picked up by an incremental run — it has to wait for the next full sync. Acceptable trade-off for the coverage win, but cite it in the phase's header comment so the next engineer doesn't assume image freshness is guaranteed within one incremental window.

**Soft-delete guard pattern** for any phase that walks Core and tombstones unseen rows afterward: gate the post-loop `updateMany` on `!since && stats.errors === 0 && seenCoreIds.size > 0`. The third condition is the load-bearing one — `firstPageWasEmpty` alone does not catch a transient mid-walk empty page.

**TS-level guard for the next sync phase** (optional but cheap): give the response a tagged discriminator so the bug class is unrepresentable. A `type CoreImageSource = { kind: "flat-sparse"; rows: CoreVideoImage[] } | { kind: "nested-canonical"; videos: CoreVideoWithImages[] }` plus a sync-phase signature that only accepts `"nested-canonical"` makes "wrong root query" a compile error, not a silent runtime coverage gap.

## Related Issues

- [`docs/solutions/platform/core-graphql-unbounded-relation-fan-out-20260504.md`](../platform/core-graphql-unbounded-relation-fan-out-20260504.md) — the **counterpart**. Explains when nested triggers Core's cost-ceiling timeout (for `Video.variants`). Read alongside this doc when choosing a query shape for a new relation. **Refresh candidate** — that doc's "Client-side mitigation" framing ("prefer flat top-level queries") needs a footnote acknowledging the `Video.images` exception.
- [`docs/solutions/platform/admin-core-sync-entity-coverage.md`](../platform/admin-core-sync-entity-coverage.md) — umbrella coverage guidance for admin's Core sync phases. The entity table's VideoImage row count is now stale (was ~270, should be ~2,168). **Refresh candidate.**
- [`docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md`](../logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md) — pattern-level sibling. Different mechanism (Strapi pagination cap vs Core flat-list sparseness) but the same class of silent data-completeness bug from query-shape assumptions.
- [`docs/solutions/performance-issues/admin-core-sync-high-volume-root-phase-bulk-upsert-20260507.md`](../performance-issues/admin-core-sync-high-volume-root-phase-bulk-upsert-20260507.md) — the phase-split context that established `video-images` as a dedicated sync phase. The split was performance-driven; this doc fixes a correctness issue inside that phase.
- PR [#950](https://github.com/JesusFilm/forge/pull/950) (commit `0b416781`) — the actual rewrite and supporting test additions. Branch `fix/admin-video-relation-inversion`.
- Prior diagnosis session (2026-05-14) caught the symptom on `main` during data-layer-flip smoke testing and applied a local SQL `UPDATE` workaround to clear `deleted_at` on tombstoned rows; structural fix was explicitly deferred to this PR. _(session history)_
