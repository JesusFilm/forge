---
id: "feat-038"
title: "Video Vectorization — Data Audit"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-04-21"
duration: 3
depends_on:
  - "feat-037"
blocks:
  - "feat-039"
  - "feat-042"
tags:
  - "cms"
  - "pgvector"
---

## Problem

Before building the scene vectorization pipeline, we need to know the shape of the English video catalog: how many videos by type, duration distribution, and existing chapter coverage. This gates all downstream sizing, cost estimates, and architecture decisions.

## Entry Points — Read These First

1. `apps/cms/src/api/video/content-types/video/schema.json` — Video schema with `label` enum
2. `apps/cms/src/api/video-variant/content-types/video-variant/schema.json` — VideoVariant with language relation
3. `apps/cms/src/api/enrichment-job/content-types/enrichment-job/schema.json` — tracks chapter completion status
4. `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md` — R0 requirements

## Grep These

- `label` in `apps/cms/src/api/video/` — video type enum values
- `bcp47` in `apps/cms/src/` — language code field for filtering English

## What To Build

Run diagnostic queries against the CMS database:

```sql
-- English video count by label
SELECT v.label, COUNT(*) as count
FROM videos v
JOIN video_variants vv ON vv.video_id = v.id
JOIN languages l ON vv.language_id = l.id
WHERE l.bcp47 = 'en'
GROUP BY v.label ORDER BY count DESC;

-- Duration distribution for English videos
SELECT v.label,
  COUNT(*) as count,
  ROUND(AVG(vv.duration)) as avg_duration_sec,
  MAX(vv.duration) as max_duration_sec
FROM videos v
JOIN video_variants vv ON vv.video_id = v.id
JOIN languages l ON vv.language_id = l.id
WHERE l.bcp47 = 'en'
GROUP BY v.label;

-- Chapter metadata coverage
SELECT COUNT(DISTINCT ej.mux_asset_id)
FROM enrichment_jobs ej
WHERE ej.step_statuses->>'chapters' = 'completed';

-- Confirm Video → VideoVariant dedup model
SELECT v.id, COUNT(vv.id) as variant_count
FROM videos v
JOIN video_variants vv ON vv.video_id = v.id
GROUP BY v.id ORDER BY variant_count DESC LIMIT 10;
```

Deliverable: update the brainstorm doc cost model with actual numbers. Confirm or revise the ~$100-$300 Phase 1 estimate.

## Constraints

- Read-only queries — do not modify production data
- Use `strapi.db.connection.raw()` pattern or direct DB access

## Verification

- Know exact English video count by label type
- Know duration distribution (what % are short clips vs feature films)
- Know chapter coverage (what % already have scene-like metadata)
- Cost model in brainstorm doc updated with real numbers
