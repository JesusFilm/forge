---
date: 2026-04-02
topic: video-content-vectorization
---

# Video Content Vectorization for Recommendations

## Problem Frame

JesusFilm has 50,000+ unique videos ranging from short clips to feature-length films, each available in up to 1,500 language variants. Current recommendations are purely metadata-driven — "you watched Film X, here it is in 1,500 other languages." There is no way to recommend thematically or visually similar content across different films.

Existing transcript-based text embeddings (already built in the manager pipeline) capture _what was said_ but miss _what was shown_ — visual setting, actions, emotions, cinematography, and mood. A user watching a contemplative scene of someone walking by water should be recommended other reflective moments from entirely different films, not the same film dubbed in Swahili.

**Validation needed**: Before full investment, confirm that transcript-only embeddings do not already provide adequate cross-film similarity. A quick test (20-50 seed videos, manual evaluation of transcript embedding recommendations) should establish whether visual scene analysis adds meaningful lift.

**Catalog composition unknown**: The 50K figure includes all video labels (featureFilm, shortFilm, segment, episode, collection, trailer, behindTheScenes). The ratio of feature-length films to short clips dramatically affects scene count, processing time, and cost. A data audit (see R0) is prerequisite to finalizing the approach.

## Rollout Strategy

**Phase 1 — English prototype (this scope)**: Process all English-language videos only. Prove recommendation quality, validate the pipeline, and establish cost baseline. This is the fundable proof of concept.

**Phase 2 — Full catalog (future, funding-dependent)**: If Phase 1 demonstrates value, expand to all 50K+ videos across all languages. Phase 2 is explicitly out of scope for this requirements doc.

All requirements below are scoped to Phase 1 (English videos only) unless stated otherwise.

## Requirements

- R0. **Data audit (prerequisite)**: Before committing to the pipeline, query the CMS to determine: (a) video count by label type and duration distribution for English-language videos, (b) how many have existing chapter/scene metadata from the enrichment pipeline, (c) whether the Video → VideoVariant model provides implicit deduplication or whether separate Video records exist for the same content in different languages.
- R1. **Scene segmentation**: Break videos into meaningful narrative scenes with precise start/end timestamps.
  - R1a. **Transcript-based segmentation**: Extend the existing `chapters.ts` service output (which already produces titles, start/end timestamps, and summaries via LLM) as the baseline for scene boundaries. For short clips that are a single scene, chapter output may be sufficient without further segmentation.
  - R1b. **Visual shot detection + fusion**: For feature-length films, augment transcript-based boundaries with visual shot detection to produce more accurate narrative scene boundaries. This is a research-heavy component — evaluate libraries and approaches during planning.
- R2. **Scene content description**: For each scene, generate a rich multimodal description capturing visual setting, objects, actions, characters, emotional tone, and mood by feeding representative frames + transcript to a multimodal LLM. Note: this requires a new multimodal LLM client — the existing OpenRouter `embeddings.ts` is text-only and cannot send images.
- R3. **Scene embedding and storage**: Embed each scene description using the existing text embedding pipeline (`text-embedding-3-small`, 1536 dims) and store in a **separate `scene_embeddings` table** in pgvector with full traceability back to source video and scene.
- R4. **Cross-film recommendation**: Given a scene or video, find visually and thematically similar scenes from _different_ films using vector similarity. Deduplication across language variants uses the Video → VideoVariant parent relationship (embed once per Video, not per variant). This scope includes the vector similarity query capability; the recommendation UI (how results are surfaced in web/mobile) is a separate feature.
- R5. **Backfill worker**: A dedicated worker service to process the English video catalog. Must be resumable/idempotent. Must include:
  - Configurable batch size and rate limits
  - Cost tracking per video and cumulative
  - Automatic pause if cost exceeds a configurable threshold
  - Dry-run mode that estimates cost without calling LLMs
- R6. **Incremental pipeline integration**: After backfill, scene vectorization becomes a required step in the existing manager enrichment workflow for new English video uploads. Note: unlike existing parallel steps (translate, chapters, metadata, embeddings) which all consume transcript text, scene vectorization needs video frame access via muxAssetId — it runs as an independent branch, not a simple addition to the existing parallel group.
- R7. **Existing scene metadata**: Where videos already have chapter output from the enrichment pipeline, use it as the starting point for segmentation rather than re-detecting from scratch.

## Storage Schema

Scene embeddings are stored in a dedicated pgvector table with full traceability to source video and scene boundaries:

```sql
CREATE TABLE scene_embeddings (
  id            SERIAL PRIMARY KEY,

  -- Traceability: which video and scene
  video_id      INTEGER NOT NULL,          -- FK to Strapi video record
  core_id       TEXT,                       -- video.coreId for cross-reference
  mux_asset_id  TEXT NOT NULL,              -- which Mux asset frames came from
  playback_id   TEXT NOT NULL,              -- for Mux thumbnail URL construction

  -- Scene boundaries
  scene_index   INTEGER NOT NULL,           -- 0-based order within the video
  start_seconds FLOAT NOT NULL,
  end_seconds   FLOAT,                      -- NULL for final scene (extends to end)

  -- Content (for debugging, tracing, and quality review)
  description   TEXT NOT NULL,              -- LLM-generated scene description
  chapter_title TEXT,                        -- from chapters.ts if available
  frame_count   INTEGER,                    -- how many frames were sent to LLM

  -- The embedding
  embedding     vector(1536) NOT NULL,
  model         TEXT NOT NULL DEFAULT 'text-embedding-3-small',

  -- Phase tracking
  language      TEXT NOT NULL DEFAULT 'en', -- which language transcript was used

  -- Metadata
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  -- Uniqueness: one embedding per scene per video
  UNIQUE(video_id, scene_index)
);

-- HNSW index for fast similarity search
CREATE INDEX scene_embeddings_hnsw
  ON scene_embeddings USING hnsw (embedding vector_cosine_ops);

-- Lookup by video (for "find scenes in this video" and deduplication)
CREATE INDEX scene_embeddings_video_id ON scene_embeddings(video_id);

-- Phase filtering (English prototype vs full catalog)
CREATE INDEX scene_embeddings_language ON scene_embeddings(language);
```

**How to trace an embedding back to its source:**

- `video_id` → Strapi Video record (title, slug, label, description)
- `video_id` → Video.variants → VideoVariant records (language-specific playback)
- `mux_asset_id` / `playback_id` → Mux asset (for re-extracting frames)
- `scene_index` + `start_seconds` / `end_seconds` → exact moment in the video
- `description` → what the LLM "saw" in this scene (stored for inspection)
- `chapter_title` → link to chapters.ts output if it was the scene source

**Recommendation query pattern:**

```sql
-- Find similar scenes from DIFFERENT videos
SELECT se.video_id, se.scene_index, se.description, se.start_seconds,
       1 - (se.embedding <=> $1) AS similarity
FROM scene_embeddings se
WHERE se.video_id != $2          -- exclude current video
  AND se.language = 'en'         -- Phase 1: English only
ORDER BY se.embedding <=> $1
LIMIT 10;
```

**Why this schema:**

- **Separate from `video_embeddings`** (feat-009): Different columns (timestamps, description) and different query patterns (scene similarity vs. transcript keyword search). Separate tables let feat-009 proceed as-is.
- **`video_id` as dedup key**: Language variants are VideoVariants under the same Video parent. Embedding once per Video and filtering by `video_id !=` gives implicit cross-variant deduplication.
- **`language` column**: Enables Phase 1 (English only) filtering and future Phase 2 expansion without schema changes.
- **`description` stored**: Enables quality review, debugging, and re-embedding with a different model without re-running the LLM.

## Rough Cost Model

**Phase 1 (English only) — order-of-magnitude estimates. Refine after R0 data audit.**

English subset is likely a fraction of the 50K total. Assuming ~5K-10K English videos:

- Short clips (~80%): 8K × 2 scenes = ~16K scene descriptions
- Feature films (~20%): 2K × 75 scenes = ~150K scene descriptions
- **Total: ~166K multimodal LLM calls**

At Gemini 2.5 Flash pricing (~$0.15/1M input tokens, ~$0.60/1M output tokens):

- Per scene: ~3 frames (thumbnails) + transcript chunk ≈ ~2K tokens input, ~500 tokens output
- **Total input: ~332M tokens → ~$50**
- **Total output: ~83M tokens → ~$50**
- **Embedding cost**: 166K × text-embedding-3-small ≈ ~$3
- **Phase 1 rough total: ~$100-$300**

**Full catalog estimate (Phase 2, for future funding request):**

- ~830K scene descriptions → ~$500-$1,500

Compare: Twelve Labs Embed at ~$0.03/min × estimated 500K+ total minutes = **$15K+**

## Success Criteria

- Recommendations surface genuinely different films/clips based on visual and thematic similarity, not just metadata overlap
- **Measurable quality bar**: Curate 50-100 seed videos with human-labeled "expected similar" results. Scene embeddings must surface at least 3 relevant cross-film results in top 10 for 80% of seed videos, outperforming transcript-only embeddings on the same evaluation set.
- Feature-length films are segmented into meaningful narrative scenes (not raw shot cuts)
- The backfill worker can process the English catalog without manual intervention (resumable on failure, cost-capped)
- New English uploads are automatically scene-vectorized as part of the enrichment pipeline
- Language variants of the same content are deduplicated in recommendation results
- **Phase gate**: Phase 1 results are evaluated before requesting Phase 2 funding

## Scope Boundaries

- **Phase 1 only**: English-language videos. Other languages are Phase 2, out of scope.
- **Not building a user-facing search UI** — this is the recommendation engine layer. Search (feat-010) is a separate concern.
- **Not replacing transcript embeddings** — scene embeddings complement them. Both live in pgvector in separate tables.
- **Hybrid approach**: Start with LLM-generated scene descriptions embedded as text vectors (ships faster, reuses existing infra). Native video embedding models (Twelve Labs, Gemini video embeddings) are a future upgrade path, not in scope now.
- **Not building the recommendation UI** — this provides the vector similarity query capability. How recommendations are surfaced in web/mobile is a separate feature.

## Key Decisions

- **English-first phased rollout**: Prototype with all English videos (~$100-$300 estimated cost). Prove value before investing in full 50K+ catalog. Phase 2 is a separate funding decision.
- **LLM descriptions over native video embeddings**: At scale, native video embedding APIs (Twelve Labs at ~$15K+) are 10-30x more expensive than LLM scene descriptions (~$500-$1,500 full catalog). LLM descriptions reuse existing infrastructure (text-embedding-3-small + pgvector) and provide good quality. Can upgrade selectively later.
- **Scene-level granularity**: Embeddings are per-scene, not per-frame or per-video. Short clips may be 1-3 scenes; feature films 50-200. This is the right unit for recommendations.
- **Build on existing chapters pipeline**: The `chapters.ts` service already produces transcript-based scene segmentation with timestamps. R1 extends this with visual shot detection for feature films rather than building scene detection from scratch.
- **Separate `scene_embeddings` table**: Scene embeddings have different columns (start/end timestamps, description text) and query patterns than transcript chunk embeddings. Separate tables let feat-009 proceed as-is and keep query logic clean. Resolve before feat-009 starts Apr 7.
- **Hybrid storage: pgvector + lightweight metadata**: Scene data lives in the `scene_embeddings` table with full traceability columns (video_id, mux_asset_id, timestamps, description) rather than as a Strapi content type. Keeps it lean for prototype; can promote to CMS entity later if human-in-the-loop editing is needed.
- **Backfill worker separate from manager**: The one-time catalog processing runs as a dedicated worker service (can scale independently, doesn't block the manager pipeline). Can reuse the same workflow code/libraries. New uploads use the integrated manager pipeline step.
- **Deduplication via Video → VideoVariant model**: Scene detection and embedding runs once per Video entity (the parent), not per VideoVariant. Recommendations filter by unique Video ID. Confirm during data audit (R0) that language variants are modeled as VideoVariants, not separate Video records.

## Dependencies / Assumptions

- **pgvector must be deployed first** (feat-009, scheduled Apr 7, 14-day duration → ~Apr 21) — R3, R4, R6 are blocked. R0, R1, R2, R5 scaffolding can proceed in parallel.
- **Existing chapters pipeline** in manager is working and produces scene-like segmentation
- **Mux thumbnail API** provides frame extraction at specific timestamps via `image.mux.com/{PLAYBACK_ID}/thumbnail.jpg?time=N` — confirm during planning
- **New multimodal LLM client needed** — existing OpenRouter client is text-only; R2 requires sending images alongside text
- **Railway worker constraints** — need to confirm Railway supports long-lived worker processes or design backfill as queue-based with short-lived jobs. Existing `railway.toml` has `restartPolicyMaxRetries: 3` which may not suit multi-day processing.

## Outstanding Questions

### Deferred to Planning

- [Affects R0][Data audit] Query CMS for English video count by label, duration distribution, and chapter metadata coverage. This gates the pipeline sizing.
- [Affects R1b][Needs research] Which visual scene detection libraries work best for narrative film content? PySceneDetect handles shot boundaries; evaluate options for combining with transcript-based scene detection.
- [Affects R2][Needs research] Which multimodal LLM gives best scene descriptions for the cost? Gemini 2.5 Flash vs GPT-4o vs others — benchmark quality and pricing at scale.
- [Affects R2][Technical] How many representative frames per scene should be sampled for description? 1 keyframe vs 3-5 frames affects description quality and API cost.
- [Affects R5][Technical] Backfill worker architecture — queue-based (process videos from a job queue) or single long-lived process? Depends on Railway constraints.
- [Affects R5][Needs research] Confirm Mux thumbnail API works for arbitrary timestamps and returns sufficient resolution for multimodal LLM input.
- [Affects R4][Technical] How will scene similarity interact with feat-010 semantic search API? Different query pattern (find similar scenes vs. keyword search).

## Visual Embedding Technology Research

**Researched Apr 2, 2026. Use to inform feat-040 (scene descriptions) model selection.**

### Approach Comparison

| Approach                                   | Est. Cost (50K videos) | Quality                       | Infra Complexity          |
| ------------------------------------------ | ---------------------- | ----------------------------- | ------------------------- |
| **Gemini 2.5 Flash describe + text-embed** | **$150-300**           | **High (narrative + visual)** | **Low (reuses existing)** |
| Gemini Embedding 2 (direct video embed)    | $2,000-5,000           | High (native multimodal)      | Medium (new index)        |
| Twelve Labs Embed (Marengo 3.0)            | $10,000+               | Highest (purpose-built)       | Medium (new index)        |
| CLIP/SigLIP local                          | ~$0 (compute only)     | Medium (visual only)          | Medium (new index + GPU)  |
| GPT-4o describe + text-embed               | $1,200-2,400           | High                          | Low                       |

### Recommended: Gemini 2.5 Flash "Describe then Embed"

- **Image input**: Accepts multiple images + text per request. ~1,290 tokens per image ≈ $0.000039/image.
- **At 3 frames/scene × 166K scenes (English)**: ~$58 in image tokens + ~$50 output tokens = **~$100-$300 total**.
- **Quality**: Strong at visual description, emotional tone, settings, actions. Best cost/quality ratio by a wide margin.
- **Why not GPT-4o**: 8x more expensive ($2.50/1M input vs $0.30/1M). Comparable quality.
- **Why not Claude**: Haiku is 3-4x more expensive, Sonnet 10x. Not justified at scale for scene description.

### Why Not CLIP/SigLIP Directly?

CLIP/SigLIP produce embeddings directly from images (512-1152 dims) in a shared text-image space. Strengths: zero marginal cost, text-to-image search works. But:

- Embeddings capture "what's in this image" not narrative meaning. Will find "beach scene" but miss "baptism at a river" vs "family swimming at a lake."
- **Incompatible vector space** with text-embedding-3-small — cannot mix in the same pgvector index.
- For ministry content requiring semantic nuance, CLIP alone is insufficient.

### Future Upgrade Path: Gemini Embedding 2

Google's multimodal embedding model (public preview, Mar 2026):

- 3072 dims (Matryoshka down to 768). Can target 1536 to match existing space.
- Accepts text, image, video, audio in one unified embedding space.
- **Video constraint**: max 80-120 seconds per clip → fits our scene-based approach.
- Pricing: ~$0.00079/frame. At 1fps for 60s scenes ≈ $0.047/scene.
- **When to adopt**: Once out of preview and pricing stabilizes. Store as a second signal in a separate column, combine scores at query time.

### Mux Thumbnail API (Confirmed)

- **URL**: `https://image.mux.com/{PLAYBACK_ID}/thumbnail.{png|jpg|webp}?time={SECONDS}`
- **Resolution**: Defaults to original video resolution. Supports `?width=512&height=512` for LLM-friendly sizes.
- **Rate limit**: 1 unique thumbnail per 10 seconds of video duration per asset. A 60-min film supports 360 thumbnails — plenty for 3 frames × 20 scenes.
- **Cost**: Included in Mux standard pricing. No per-thumbnail charge.
- **CDN cached**: Repeated requests for the same timestamp are free.

## Roadmap Tickets

This brainstorm produced the following roadmap features in `docs/roadmap/content-discovery/`:

| ID                                                                                   | Feature                             | Days | Start  | Depends on                   |
| ------------------------------------------------------------------------------------ | ----------------------------------- | ---- | ------ | ---------------------------- |
| [feat-037](../roadmap/content-discovery/feat-037-video-content-vectorization.md)     | Parent: Video Content Vectorization | 42   | Apr 21 | feat-009, feat-031           |
| [feat-038](../roadmap/content-discovery/feat-038-video-vectorization-data-audit.md)  | Data Audit                          | 3    | Apr 21 | feat-037                     |
| [feat-039](../roadmap/content-discovery/feat-039-chapter-based-scene-boundaries.md)  | Chapter-Based Scene Boundaries      | 7    | Apr 24 | feat-038                     |
| [feat-040](../roadmap/content-discovery/feat-040-multimodal-scene-descriptions.md)   | Multimodal Scene Descriptions       | 10   | May 1  | feat-039                     |
| [feat-041](../roadmap/content-discovery/feat-041-scene-embeddings-table.md)          | Scene Embeddings Table + Indexing   | 7    | May 11 | feat-009, feat-040           |
| [feat-042](../roadmap/content-discovery/feat-042-backfill-worker.md)                 | English Backfill Worker             | 10   | May 18 | feat-038, feat-040, feat-041 |
| [feat-043](../roadmap/content-discovery/feat-043-visual-shot-detection-fusion.md)    | Visual Shot Detection Fusion (P2)   | 10   | May 28 | feat-039                     |
| [feat-044](../roadmap/content-discovery/feat-044-recommendation-query-api.md)        | Recommendation Query API            | 7    | May 28 | feat-041, feat-042           |
| [feat-045](../roadmap/content-discovery/feat-045-pipeline-integration.md)            | Pipeline Integration                | 7    | Jun 4  | feat-041, feat-042           |
| [feat-046](../roadmap/content-discovery/feat-046-recommendations-demo-experience.md) | Recommendations Demo Experience     | 7    | Jun 4  | feat-044                     |

## Next Steps

→ `/ce:plan` for structured implementation planning (R0 data audit is first planning task).
