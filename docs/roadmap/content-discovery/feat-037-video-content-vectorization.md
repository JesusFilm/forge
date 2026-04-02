---
id: "feat-037"
title: "Video Content Vectorization for Recommendations"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-04-21"
duration: 42
depends_on:
  - "feat-009"
  - "feat-031"
blocks:
  - "feat-038"
tags:
  - "cms"
  - "pgvector"
  - "ai-pipeline"
  - "search"
  - "manager"
---

## Problem

Current recommendations are metadata-driven — "you watched Film X, here it is in 1,500 other languages." Transcript embeddings (feat-009/010) capture what was said, but miss what was shown. Visual scene embeddings enable cross-film recommendations based on visual setting, actions, emotional tone, and mood.

**Phase 1 (this feature)**: All English-language videos. Prove recommendation quality at ~$100-$300 estimated cost. Phase 2 (full 50K+ catalog) is a separate funding decision.

## Entry Points — Read These First

1. `apps/manager/src/services/chapters.ts` — existing scene-like segmentation: `Chapter { title, startSeconds, endSeconds, summary }`. This is the baseline for R1a.
2. `apps/manager/src/services/embeddings.ts` — existing text embedding pipeline using `text-embedding-3-small` (1536 dims). Scene descriptions will be embedded through the same model.
3. `apps/manager/src/workflows/videoEnrichment.ts` — enrichment workflow with parallel steps. R6 adds scene vectorization as a new branch.
4. `apps/manager/src/services/storage.ts` — S3 artifact storage pattern (`{assetId}/{type}.json`).
5. `apps/cms/src/api/video/content-types/video/schema.json` — Video content type with `coreId`, `label` enum, `variants` relation.
6. `apps/cms/src/api/video-variant/content-types/video-variant/schema.json` — VideoVariant with `language` and `muxVideo` relations.
7. `apps/cms/src/api/mux-video/content-types/mux-video/schema.json` — MuxVideo with `assetId` and `playbackId` for frame extraction.
8. `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md` — full requirements doc with storage schema, cost model, and rollout strategy.

## Grep These

- `chapters` in `apps/manager/src/` — existing chapter/scene segmentation
- `getOpenrouter` in `apps/manager/src/` — AI model client (text-only; needs multimodal extension)
- `text-embedding-3-small` in `apps/manager/src/` — embedding model
- `strapi.db.connection.raw` in `apps/cms/src/` — raw SQL patterns for pgvector
- `muxAssetId` in `apps/manager/src/` — Mux asset references for frame extraction
- `playbackId` in `apps/cms/src/` — Mux playback IDs for thumbnail URLs
- `label` in `apps/cms/src/api/video/` — video type enum (featureFilm, shortFilm, etc.)

## What To Build

### R0. Data Audit (first task)

Query CMS to determine English video landscape:

```sql
-- Video count by label type
SELECT label, COUNT(*) FROM videos GROUP BY label;

-- Duration distribution
SELECT label,
  COUNT(*) as count,
  AVG(duration) as avg_duration,
  MAX(duration) as max_duration
FROM videos v
JOIN video_variants vv ON vv.video_id = v.id
JOIN languages l ON vv.language_id = l.id
WHERE l.bcp47 = 'en'
GROUP BY label;

-- Chapter metadata coverage
SELECT COUNT(DISTINCT ej.mux_asset_id)
FROM enrichment_jobs ej
WHERE ej.step_statuses->>'chapters' = 'completed';
```

### R1. Scene Segmentation

**R1a — Transcript-based (extend chapters.ts)**:

- For each English video, use existing chapter output as scene boundaries
- Short clips (single chapter) → treat as one scene
- Store chapter boundaries as scene candidates

**R1b — Visual fusion (feature films only)**:

- Extract frames at chapter boundaries using Mux thumbnail API: `https://image.mux.com/{PLAYBACK_ID}/thumbnail.jpg?time={SECONDS}`
- Feed frame sequences + transcript to multimodal LLM to refine/merge chapter boundaries into narrative scenes
- Research: evaluate PySceneDetect for shot boundary detection to augment

### R2. Scene Content Description

New service: `apps/manager/src/services/sceneDescription.ts`

```typescript
type SceneDescription = {
  sceneIndex: number
  startSeconds: number
  endSeconds: number | null
  description: string // LLM-generated rich description
  chapterTitle: string | null
  frameCount: number
}

export async function describeScene(
  playbackId: string,
  startSeconds: number,
  endSeconds: number | null,
  transcript: string,
  chapterTitle: string | null,
): Promise<SceneDescription>
```

- Extract 3 representative frames via Mux thumbnail API at scene start, midpoint, and end
- Send frames + transcript chunk to multimodal LLM (Gemini 2.5 Flash via OpenRouter or direct API)
- Prompt: describe visual setting, objects, actions, characters, emotional tone, mood
- **Requires new multimodal client** — existing OpenRouter client is text-only

### R3. Scene Embedding + Storage

Create `scene_embeddings` table via bootstrap SQL (same pattern as feat-009):

```sql
CREATE TABLE IF NOT EXISTS scene_embeddings (
  id            SERIAL PRIMARY KEY,
  video_id      INTEGER NOT NULL,
  core_id       TEXT,
  mux_asset_id  TEXT NOT NULL,
  playback_id   TEXT NOT NULL,
  scene_index   INTEGER NOT NULL,
  start_seconds FLOAT NOT NULL,
  end_seconds   FLOAT,
  description   TEXT NOT NULL,
  chapter_title TEXT,
  frame_count   INTEGER,
  embedding     vector(1536) NOT NULL,
  model         TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  language      TEXT NOT NULL DEFAULT 'en',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(video_id, scene_index)
);

CREATE INDEX IF NOT EXISTS scene_embeddings_hnsw
  ON scene_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS scene_embeddings_video_id
  ON scene_embeddings(video_id);
CREATE INDEX IF NOT EXISTS scene_embeddings_language
  ON scene_embeddings(language);
```

Indexing service: `apps/cms/src/api/scene-embedding/services/indexer.ts`

```typescript
export async function indexSceneEmbeddings(
  videoId: number,
  scenes: SceneDescription[],
  embeddings: number[][],
  meta: {
    coreId: string
    muxAssetId: string
    playbackId: string
    language: string
  },
): Promise<{ scenesIndexed: number }>
```

### R4. Cross-film Recommendation Query

```sql
SELECT se.video_id, se.scene_index, se.description, se.start_seconds,
       1 - (se.embedding <=> $1) AS similarity
FROM scene_embeddings se
WHERE se.video_id != $2
  AND se.language = 'en'
ORDER BY se.embedding <=> $1
LIMIT 10;
```

Expose as CMS service or API endpoint for web/mobile consumption.

### R5. Backfill Worker

Dedicated Railway service (or separate entry point in manager) for one-time English catalog processing:

- Queue-based: iterate English videos, process each through R1 → R2 → R3
- Resumable: track processed video IDs, skip on restart
- Cost controls: configurable batch size, rate limits, cost tracking per video, auto-pause at threshold
- Dry-run mode: estimate cost without LLM calls

### R6. Pipeline Integration

Add scene vectorization to `videoEnrichment.ts` as an independent branch:

- Runs after transcription completes (needs transcript)
- Also needs muxAssetId/playbackId (for frames) — different input than other parallel steps
- Triggers R1a → R2 → R3 for the new video

## Constraints

- **English only** — filter by language in all queries and processing. `language` column enables future expansion.
- **Separate table from `video_embeddings`** — different columns, different query patterns. Do not extend feat-009's table.
- **Do NOT use a Strapi content type** for scene embeddings — pgvector columns don't work with Strapi ORM. Use raw SQL (same pattern as feat-009).
- **Embed once per Video, not per VideoVariant** — language variants share visual content. Dedup by `video_id`.
- **Cost cap** — backfill worker must auto-pause if cumulative cost exceeds configurable threshold.
- **Mux thumbnail API** for frame extraction — do not download full videos. Confirm API supports arbitrary timestamps during planning.

## Verification

1. **Data audit complete**: know English video count by label, duration distribution, chapter coverage
2. **Scene segmentation**: sample 10 feature films, verify scene boundaries align with narrative scenes (not just shot cuts)
3. **Scene descriptions**: sample 20 scenes, verify descriptions capture visual content, not just transcript paraphrasing
4. **Embeddings indexed**: `SELECT COUNT(*) FROM scene_embeddings WHERE language = 'en'` matches expected scene count
5. **Recommendation quality**: for 50 seed videos, top-10 similar scenes include at least 3 relevant cross-film results for 80% of seeds
6. **Deduplication**: recommendations never surface the same video (different variant) as the input
7. **Cost tracking**: backfill worker logs cumulative cost, stays within budget
8. **Pipeline integration**: upload a new English video → scene embeddings appear in `scene_embeddings` table automatically
