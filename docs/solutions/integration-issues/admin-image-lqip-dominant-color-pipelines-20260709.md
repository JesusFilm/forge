---
title: Admin image LQIP and dominant color pipelines
date: 2026-07-09
category: integration-issues
module: admin media image metadata
problem_type: integration_issue
component: service_object
symptoms:
  - Uploaded media assets had generated blurDataUrl values that were identical SVG placeholders instead of image-derived LQIPs.
  - VideoImage and Mux image derivative records could expose blur data without matching dominantColor values.
  - Corrupt image-like responses could be cached as successful blur metadata with the fallback dominant color.
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [admin, lqip, dominant-color, media-asset, mux, video-image, graphql]
---

# Admin image LQIP and dominant color pipelines

## Problem

Admin has three image metadata paths that look similar from the consumer side but are populated differently:

- `MediaAsset` uploaded images are enriched from stored upload bytes.
- `VideoImage` rows come from Core image URLs and lazily fetch a tiny transformed image.
- `MuxImageDerivative` rows are generated from Mux thumbnail recipes for Watch carousel and hero poster images.

Production inspection showed the uploaded-media path was persisting clear generated placeholders instead of raster LQIPs, while the video and Mux paths had blur data but no first-class `dominantColor` contract.

## Symptoms

- `media_asset.blur_data_url` values were identical placeholder SVG data URLs, even for uploaded images.
- `video_image.blur_data_url` and `mux_image_derivative.blur_data_url` were populated independently of `dominant_color`.
- Existing GraphQL fields exposed Mux blur data, but not the matching dominant colors.
- Review found that invalid `image/*` payloads could previously be treated as successful metadata because dominant color generation fell back instead of failing the fetch path.

## What Didn't Work

- Treating a placeholder SVG as acceptable LQIP output hid the uploaded-media problem; row counts looked populated even though the value was visually wrong.
- Adding `dominantColor` only at write time left existing rows stranded unless a backfill or lazy repair path handled them.
- Letting image fetches follow redirects and buffer full responses before size checks left the lazy Core/Mux paths weaker than the rest of the media ingestion posture.

## Solution

Use real image decoding as the shared source of truth, and keep the three pipelines explicit:

- `apps/admin/src/services/image-metadata.service.ts` generates uploaded-media dimensions, JPEG blur data URLs, and dominant colors with `sharp`.
- `apps/admin/src/services/video-image-blur-data-url.service.ts` and `apps/admin/src/services/mux-image-derivative.service.ts` use strict dominant-color decoding for fetched derivatives. If bytes cannot be decoded as an image, nothing is persisted.
- Core image fetches use `redirect: "error"` and both Core/Mux fetchers stream through a byte cap before buffering.
- `apps/admin/src/scripts/backfill-image-dominant-colors.ts` derives missing colors from existing `blurDataUrl` values and uses guarded `updateMany` predicates so it does not overwrite rows changed after selection.
- GraphQL exposes the matched color fields beside the existing blur fields: `Video.muxThumbnailDominantColor`, `Video.muxHeroPosterDominantColor`, `VideoDub.muxHeroPosterDominantColor`, and Watch route snapshot color fields.

## Why This Works

The important distinction is “metadata present” versus “metadata derived from the actual image.” Uploaded media needed raster generation from bytes, not a generic placeholder. Video and Mux derivatives needed the color value stored with the same recipe and returned through the same public API shape as the blur data.

Strict decode also makes corrupt upstream responses self-limiting: a response must pass content type, byte cap, and image decode before it can update `blurDataUrl` or `dominantColor`.

## Prevention

- When adding or auditing image metadata, sample actual values, not just null counts. Repeated tiny SVG values or fallback colors are a production smell.
- Keep blur data and dominant color generated together for any derivative recipe. If a field exposes one value publicly, expose or intentionally document the other.
- Add tests for corrupt image payloads, redirect behavior, byte caps, and guarded backfills. A test that accepts arbitrary `[1, 2, 3]` bytes as an image is testing the wrong contract.
- For nullable metadata added after rows already exist, provide both a lazy repair path and a bounded backfill script.

## Related Issues

- [Uploaded media raster LQIPs roadmap](../../roadmap/platform/feat-242-uploaded-media-raster-lqips.md)
- [Watch Mux thumbnail LQIP derivatives roadmap](../../roadmap/platform/feat-221-watch-mux-thumbnail-lqip-derivatives.md)
- [Admin image enrichment localized media workflow](../best-practices/admin-image-enrichment-localized-media-workflow-20260504.md)
- PR: https://github.com/JesusFilm/forge/pull/1512
