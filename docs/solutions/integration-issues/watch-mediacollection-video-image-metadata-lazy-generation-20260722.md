---
title: "Watch MediaCollection video image metadata must have a live generation caller"
date: "2026-07-22"
category: integration-issues
module: apps/admin/src/graphql/types/blocks.ts
problem_type: integration_issue
component: graphql_resolver
symptoms:
  - "Watch MediaCollection hover/focus backdrops cross-faded between near-identical generated purple SVG placeholders instead of photographic LQIPs."
  - "Production VideoImage rows had renderable Core URLs but null blurDataUrl and dominantColor."
  - "The video image generator existed and the operator backfill worked, but the non-operator scheduling path had no active callers."
root_cause: orchestration_gap
resolution_type: code_fix
severity: medium
tags:
  - admin
  - web
  - graphql
  - video-image
  - lqip
  - dominant-color
  - media-collection
---

# Watch MediaCollection video image metadata must have a live generation caller

## Problem

The Watch homepage's Acts of the Apostles MediaCollection had Core image URLs
for all linked videos, but Admin's `VideoImage` metadata fields were empty. Web
received null `videoImageBlurDataUrl` / `videoImageDominantColor`, fell back to
generated demo SVG gradients, and the hover/focus backdrop cross-fade appeared
visually static.

## Symptoms

- The Web animation path in `apps/web/src/components/sections/MediaCollection.tsx`
  was active.
- Core and Admin both had the expected image rows.
- `blurDataUrl` and `dominantColor` were null, so
  `apps/web/src/lib/enrichment.ts` used `demoBlurDataUrl`.
- `getOrScheduleVideoImageBlurDataUrl` existed but was unreachable from
  MediaCollection reads after the legacy search hydration path was removed.

## What Didn't Work

Treating this as a Web animation bug led to the wrong layer: transitions were
working, but the source images were placeholder gradients. Relying on explicit
operator backfills also left newly exposed MediaCollection-linked images without
an automatic repair path.

## Solution

Make the Admin MediaCollection metadata resolver call the existing non-blocking
generator when the selected linked `VideoImage` has a renderable URL but is
missing either metadata field. The resolver still returns the currently stored
value, so the first read stays fast and later reads can pick up the generated
photographic LQIP and matching dominant color.

The generator now also logs structured skip reasons such as blocked URL,
non-image content type, HTTP status, byte cap, empty/oversized body, or
fetch/decode failure. That separates "generation was never invoked" from
"generation ran and rejected the upstream response."

## Why This Works

MediaCollection GraphQL reads are the live path that needs the metadata, so they
are a safe bounded lazy-repair point after search no longer hydrates the same
records. The existing generator already deduplicates pending work per image id,
uses strict public-HTTPS and byte guards, and persists blur data and dominant
color together.

## Prevention

- Keep at least one active caller for every lazy media metadata generator.
- Add resolver or sync coverage whenever a search hydration path is removed.
- Test missing-blur and missing-color states separately; older rows can have one
  field without the other.
- When production shows placeholder LQIPs, inspect actual field values and
  generator invocation logs, not just animation code.

## Related Issues

- `docs/solutions/integration-issues/admin-image-lqip-dominant-color-pipelines-20260709.md`
- `docs/solutions/integration-issues/admin-core-sync-flat-vs-nested-image-query-coverage-gap-20260519.md`
- `docs/roadmap/platform/feat-243-web-dominant-color-lqip-card-rollout.md`
- `docs/roadmap/platform/feat-295-watch-mediacollection-video-image-metadata-generation.md`
