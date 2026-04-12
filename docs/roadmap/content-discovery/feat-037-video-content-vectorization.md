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

**Phase 1 (this feature)**: English, Spanish, and French videos. Three languages are required to verify locale-aware deduplication — a user watching in Spanish must never see the same film recommended in English. Prove recommendation quality at ~$130-$400 estimated cost. Phase 2 (full 50K+ catalog) is a separate funding decision.

## Entry Points — Read These First

1. `apps/manager/src/services/chapters.ts` — existing scene-like segmentation: `Chapter { title, startSeconds, endSeconds, summary }`. This is the baseline for R1a.
2. `apps/manager/src/services/embeddings.ts` — existing text embedding pipeline using `text-embedding-3-small` (1536 dims). Scene descriptions will be embedded through the same model.
3. `apps/manager/src/workflows/videoEnrichment.ts` — enrichment workflow with parallel steps. R6 adds scene vectorization as a new branch.
4. `apps/manager/src/services/storage.ts` — S3 artifact storage pattern (`{assetId}/{type}.json`).
5. `apps/cms/src/api/video/content-types/video/schema.json` — Video content type with `coreId`, `label` enum, `variants` relation.
6. `apps/cms/src/api/video-variant/content-types/video-variant/schema.json` — VideoVariant with `language` and `muxVideo` relations.
7. `apps/cms/src/api/mux-video/content-types/mux-video/schema.json` — MuxVideo with `assetId` and `playbackId` for video segment access.
8. `docs/brainstorms/2026-04-02-video-content-vectorization-requirements.md` — full requirements doc with storage schema, cost model, and rollout strategy.

## Grep These

- `chapters` in `apps/manager/src/` — existing chapter/scene segmentation
- `getOpenrouter` in `apps/manager/src/` — AI model client (text-only; needs multimodal extension)
- `text-embedding-3-small` in `apps/manager/src/` — embedding model
- `strapi.db.connection.raw` in `apps/cms/src/` — raw SQL patterns for pgvector
- `muxAssetId` in `apps/manager/src/` — Mux asset references for video segment access
- `playbackId` in `apps/cms/src/` — Mux playback IDs for video access and recommendation card thumbnails
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

- Feed video segments around chapter boundaries + transcript to multimodal LLM to refine/merge chapter boundaries into narrative scenes
- Research: evaluate PySceneDetect for shot boundary detection to augment

### R2. Scene Analysis

New service: `apps/manager/src/services/sceneAnalysis.ts`

```typescript
type SceneAnalysis = {
  sceneIndex: number
  startSeconds: number
  endSeconds: number | null
  description: string // concatenated extraction (all signals) — this is what gets embedded
  themes: string[] // felt needs: ["forgiveness", "redemption", "grief", "hope"]
  bibleVerses: string[] // ["Matthew 6:14-15", "Ephesians 4:32"]
  demographics: string[] // ["youth", "student"] — empty if not extractable
  chapterTitle: string | null
}

export async function analyzeScene(
  muxAssetId: string,
  playbackId: string,
  startSeconds: number,
  endSeconds: number | null,
  transcript: string,
  metadata: { bibleVerses?: string[]; videoLabel: string },
  chapterTitle: string | null,
): Promise<SceneAnalysis>
```

- Send **actual video segment** (not stills) to Gemini 2.5 Flash via its native video input, alongside transcript chunk and CMS metadata
- LLM extracts structured signals (ordered by importance):
  1. **Felt needs/themes** (MOST IMPORTANT): forgiveness, hope, grief, loneliness, identity, redemption, belonging, purpose, healing, doubt, courage
  2. **Bible verses**: from CMS metadata where available + LLM-identified additional references
  3. **Content**: narrative summary, dialogue, message being communicated
  4. **Emotional tone**: contemplative, joyful, grieving, urgent, peaceful, hopeful
  5. **Demographics** (where extractable): age group, life stage, cultural context
- `description` concatenates all signals into a single text block for embedding, with themes/needs weighted first
- Structured fields stored as arrays for filtering and display
- **Requires new multimodal client** — existing OpenRouter client is text-only and cannot process video

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
  description   TEXT NOT NULL,              -- concatenated extraction (all signals) — embedded
  themes        TEXT[] DEFAULT '{}',        -- felt needs: {"forgiveness","redemption","grief"}
  bible_verses  TEXT[] DEFAULT '{}',        -- {"Matthew 6:14-15","Ephesians 4:32"}
  demographics  TEXT[] DEFAULT '{}',        -- {"youth","student"} — may be empty
  chapter_title TEXT,
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
-- Locale-aware: only return videos available in the user's language
SELECT se.video_id, se.scene_index, se.description, se.start_seconds,
       1 - (se.embedding <=> $1) AS similarity
FROM scene_embeddings se
JOIN video_variants vv ON vv.video_id = se.video_id
JOIN languages l ON vv.language_id = l.id
WHERE se.video_id != $2
  AND l.bcp47 = $3               -- user's locale
  AND se.language IN ('en', 'es', 'fr')
ORDER BY se.embedding <=> $1
LIMIT 10;
```

Expose as CMS service or API endpoint for web/mobile consumption. API accepts optional `rerank` parameter (no-op in Phase 1, reserved for user-driven scoring).

### R5. Backfill Worker

Dedicated Railway service (or separate entry point in manager) for one-time English catalog processing:

- Queue-based: iterate English videos, process each through R1 → R2 → R3
- Resumable: track processed video IDs, skip on restart
- Cost controls: configurable batch size, rate limits, cost tracking per video, auto-pause at threshold
- Dry-run mode: estimate cost without LLM calls

### R6. Pipeline Integration

Add scene vectorization to `videoEnrichment.ts` as an independent branch:

- Runs after transcription completes (needs transcript)
- Also needs muxAssetId/playbackId (for video segment access) — different input than other parallel steps
- Triggers R1a → R2 → R3 for the new video

## Constraints

- **Phase 1 languages: en, es, fr** — filter by language in all queries and processing. `language` column enables future expansion.
- **No locale bleed** — recommendations are locale-aware. A user's locale determines which results they see. Never recommend the same video in a different language.
- **No human tags** — existing CMS tags are unreliable. All semantic signal comes from LLM extraction against actual video segments + transcript.
- **Pure vector similarity scoring** — no user feedback loop in Phase 1. API accepts optional `rerank` parameter (no-op) to prepare for user-driven scoring in Phase 2.
- **Separate table from `transcript_embeddings`** — different columns, different query patterns. Do not extend feat-009's table.
- **Do NOT use a Strapi content type** for scene embeddings — pgvector columns don't work with Strapi ORM. Use raw SQL (same pattern as feat-009).
- **Embed once per Video, not per VideoVariant** — language variants share visual content. Dedup by `video_id`.
- **Cost cap** — backfill worker must auto-pause if cumulative cost exceeds configurable threshold.
- **Video segments, not stills** — send actual moving video to Gemini for scene analysis. Mux thumbnail API is for recommendation card display only.

## Verification

1. **Data audit complete**: know en/es/fr video count by label, duration distribution, chapter coverage, dedup model confirmed
2. **Scene segmentation**: sample 10 feature films, verify scene boundaries align with narrative scenes (not just shot cuts)
3. **Scene analysis**: sample 20 scenes, verify extraction captures felt needs/themes, bible verses, content, tone — not just transcript paraphrasing
4. **Embeddings indexed**: `SELECT COUNT(*) FROM scene_embeddings WHERE language IN ('en', 'es', 'fr')` matches expected scene count
5. **Recommendation quality**: for 50 seed videos, top-10 similar scenes include at least 3 relevant cross-film results for 80% of seeds
6. **No locale bleed**: query recommendations for a Spanish video with locale=es → results are all videos with Spanish variants. Repeat for en and fr. No cross-locale contamination.
7. **Deduplication**: recommendations never surface the same video (different variant) as the input
8. **Cost tracking**: backfill worker logs cumulative cost, stays within budget
9. **Pipeline integration**: upload a new video in en/es/fr → scene embeddings appear in `scene_embeddings` table automatically
