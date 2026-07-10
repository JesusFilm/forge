---
id: YTM-005
title: "Replace placeholder extraction and NoopMatcher with real matcher"
status: complete
priority: P1
depends_on:
  - YTM-003
  - YTM-004
---

# YTM-005: Replace placeholder extraction and NoopMatcher with real matcher

## Goal

Remove the prototype placeholder path and return ranked candidates from real
uploaded video signals matched against real catalog data.

## Scope

- Replace `PlaceholderUploadSignalExtractor` with uploaded-video signal
  extraction for duration, sampled visual evidence, audio fingerprint/language,
  and transcript/subtitle text when available.
- Replace the default `NoopMatcher` with a real matcher wired into the server.
- Implement retrieval against `MediaSignature` and `CatalogVariant` data.
- Keep fusion keyed by `coreId + videoVariantId`.
- Keep visual evidence as the source-video anchor and audio/text/language as
  variant-ranking evidence.
- Return the public candidate list only:
  - `coreId`
  - `videoVariantId`
  - `confidence`
  - `matchStrength`
- Keep detailed evidence internal for later debugging surfaces.

## Acceptance Criteria

- Processing an uploaded sample can return non-empty candidates from seeded
  official catalog data.
- The production default server no longer uses `NoopMatcher`.
- The production default server no longer uses placeholder upload signal
  extraction.
- Tests cover visual/audio/text disagreement and confirm the fused ranking
  chooses the right candidate shape.
- Weak or missing visual evidence cannot produce a high-strength match without
  an intentional threshold change.

## Verification

```sh
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
pnpm --filter @forge/yt-video-mapper-backend lint
pnpm --filter @forge/yt-video-mapper-backend build
```
