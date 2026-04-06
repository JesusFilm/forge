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

Before building the scene vectorization pipeline, we need to know the shape of the English, Spanish, and French video catalog: how many videos by type, duration distribution, existing chapter coverage, and critically — whether language variants share a Video parent (dedup model). This gates all downstream sizing, cost estimates, and architecture decisions.

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
-- Video count by label for Phase 1 languages (en, es, fr)
SELECT v.label, l.bcp47, COUNT(*) as count
FROM videos v
JOIN video_variants vv ON vv.video_id = v.id
JOIN languages l ON vv.language_id = l.id
WHERE l.bcp47 IN ('en', 'es', 'fr')
GROUP BY v.label, l.bcp47 ORDER BY v.label, l.bcp47;

-- Unique Video count (deduped across languages) — this is what we actually process
SELECT COUNT(DISTINCT v.id) as unique_videos
FROM videos v
JOIN video_variants vv ON vv.video_id = v.id
JOIN languages l ON vv.language_id = l.id
WHERE l.bcp47 IN ('en', 'es', 'fr');

-- Duration distribution for Phase 1 languages
SELECT v.label,
  COUNT(*) as count,
  ROUND(AVG(vv.duration)) as avg_duration_sec,
  MAX(vv.duration) as max_duration_sec
FROM videos v
JOIN video_variants vv ON vv.video_id = v.id
JOIN languages l ON vv.language_id = l.id
WHERE l.bcp47 IN ('en', 'es', 'fr')
GROUP BY v.label;

-- Chapter metadata coverage
SELECT COUNT(DISTINCT ej.mux_asset_id)
FROM enrichment_jobs ej
WHERE ej.step_statuses->>'chapters' = 'completed';

-- CRITICAL: Confirm Video → VideoVariant dedup model
-- Do en/es/fr variants of the same film share a Video parent?
SELECT v.id, v.label,
  COUNT(vv.id) as variant_count,
  ARRAY_AGG(DISTINCT l.bcp47) as languages
FROM videos v
JOIN video_variants vv ON vv.video_id = v.id
JOIN languages l ON vv.language_id = l.id
WHERE l.bcp47 IN ('en', 'es', 'fr')
GROUP BY v.id, v.label
HAVING COUNT(DISTINCT l.bcp47) > 1
ORDER BY variant_count DESC LIMIT 20;

-- How many Videos have variants in multiple Phase 1 languages?
-- (high overlap = dedup model works, low overlap = mostly unique per language)
SELECT multi_lang_count, COUNT(*) as video_count FROM (
  SELECT v.id, COUNT(DISTINCT l.bcp47) as multi_lang_count
  FROM videos v
  JOIN video_variants vv ON vv.video_id = v.id
  JOIN languages l ON vv.language_id = l.id
  WHERE l.bcp47 IN ('en', 'es', 'fr')
  GROUP BY v.id
) sub GROUP BY multi_lang_count ORDER BY multi_lang_count;
```

Deliverable: update the brainstorm doc cost model with actual numbers. Confirm or revise the ~$130-$400 Phase 1 estimate. **If the dedup model is broken (same film = separate Video records per language), flag immediately — the entire dedup strategy must be revised.**

## Constraints

- Read-only queries — do not modify production data
- Use `strapi.db.connection.raw()` pattern or direct DB access

## Verification

- Know exact video count by label type for en, es, fr
- Know how many unique Video entities span multiple Phase 1 languages (dedup model validation)
- Know duration distribution (what % are short clips vs feature films)
- Know chapter coverage (what % already have scene-like metadata)
- Cost model in brainstorm doc updated with real numbers
- **Dedup model confirmed or red-flagged**: en/es/fr variants of the same film share a Video parent
