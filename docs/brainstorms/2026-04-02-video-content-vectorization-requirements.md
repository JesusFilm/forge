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

**Phase 1 — English / Spanish / French prototype (this scope)**: Process videos in three languages: English, Spanish, and French. Three languages are required to verify that recommendations never bleed across locales — a user watching in English must not be recommended the same film dubbed in Spanish. This also exercises the Video → VideoVariant deduplication model under real multilingual conditions. Prove recommendation quality, validate the pipeline, and establish cost baseline. This is the fundable proof of concept.

**Phase 2 — Full catalog (future, funding-dependent)**: If Phase 1 demonstrates value, expand to all 50K+ videos across all languages. Phase 2 is explicitly out of scope for this requirements doc.

All requirements below are scoped to Phase 1 (English, Spanish, French) unless stated otherwise.

## Requirements

- R0. **Data audit (prerequisite)**: Before committing to the pipeline, query the CMS to determine: (a) video count by label type and duration distribution for English, Spanish, and French videos, (b) how many have existing chapter/scene metadata from the enrichment pipeline, (c) whether the Video → VideoVariant model provides implicit deduplication or whether separate Video records exist for the same content in different languages. **Critical**: confirm that the same film in English, Spanish, and French share a single Video parent with separate VideoVariant records — if not, the dedup strategy must be revised.
- R1. **Scene segmentation**: Break videos into meaningful narrative scenes with precise start/end timestamps.
  - R1a. **Transcript-based segmentation**: Extend the existing `chapters.ts` service output (which already produces titles, start/end timestamps, and summaries via LLM) as the baseline for scene boundaries. For short clips that are a single scene, chapter output may be sufficient without further segmentation.
  - R1b. **Visual shot detection + fusion**: For feature-length films, augment transcript-based boundaries with visual shot detection to produce more accurate narrative scene boundaries. This is a research-heavy component — evaluate libraries and approaches during planning.
- R2. **Scene analysis**: For each scene, feed the **actual video segment** (not still frames) + transcript + CMS metadata to a multimodal LLM to extract structured signals. The LLM receives the moving video clip via Mux and the transcript chunk from the chapters pipeline.
  **Inputs** (what the LLM receives):
  - Video segment (actual moving video via Gemini video input, not stills)
  - Transcript text for the scene (from chapters pipeline)
  - CMS metadata for the parent video (existing bible verse references, video label/type)
    **Extracted signals** (what the LLM outputs — ordered by importance):
  - **Felt needs/themes** (MOST IMPORTANT): the human need the scene addresses — forgiveness, hope, grief, loneliness, identity, redemption, fear, belonging, purpose, healing, doubt, courage, etc. Two completely different scenes addressing the same felt need should recommend each other. This is the primary signal for ministry content.
  - **Bible verses**: scripture references relevant to the scene. Sourced from CMS metadata where available + LLM-identified additional references. E.g., a scene about forgiveness → Matthew 6:14-15, Ephesians 4:32.
  - **Content**: narrative summary — what is happening, the dialogue, the message being communicated
  - **Emotional tone**: contemplative, joyful, grieving, urgent, peaceful, hopeful, sorrowful
  - **Demographics** (where extractable): target audience signals — age group (children, youth, young adult, adult, elderly), life stage (student, parent, married, widowed, incarcerated), cultural context. Not every scene will have clear demographic signals — extract only when evident from the content.
    All extracted signals are concatenated into a single text block for embedding, with felt needs/themes weighted by appearing first and repeated. Structured fields (themes, verses, demographics) are also stored as arrays for filtering and display.
    Note: this requires a new multimodal LLM client — the existing OpenRouter `embeddings.ts` is text-only and cannot process video. Gemini 2.5 Flash accepts video input natively (up to ~1hr clips).
- R3. **Scene embedding and storage**: Embed each scene description using the existing text embedding pipeline (`text-embedding-3-small`, 1536 dims) and store in a **separate `scene_embeddings` table** in pgvector with full traceability back to source video and scene.
- R4. **Cross-film recommendation**: Given a scene or video, find visually and thematically similar scenes from _different_ films using vector similarity. Deduplication across language variants uses the Video → VideoVariant parent relationship (embed once per Video, not per variant). Recommendations are filtered by locale — a user's locale determines which language results they see. **No human tags**: existing CMS tags are unreliable; all semantic signal comes from LLM-generated scene descriptions. This scope includes the vector similarity query capability; the recommendation UI (how results are surfaced in web/mobile) is a separate feature.
- R4a. **Locale-aware filtering**: The recommendation query accepts a `language` parameter and only returns scenes from videos that have a variant in that language. A user watching in Spanish sees recommendations for videos available in Spanish, regardless of which language variant was used for scene analysis.
- R4b. **User-driven scoring (future)**: Recommendation ranking will eventually incorporate user feedback signals (clicks, watch time, explicit ratings). Phase 1 prototype uses pure vector similarity. The feedback loop is explicitly out of scope for Phase 1 but the API should be designed to accept an optional re-ranking parameter for future use.
- R5. **Backfill worker**: A dedicated worker service to process the English, Spanish, and French video catalog. Must be resumable/idempotent. Must include:
  - Configurable batch size and rate limits
  - Cost tracking per video and cumulative
  - Automatic pause if cost exceeds a configurable threshold
  - Dry-run mode that estimates cost without calling LLMs
- R6. **Incremental pipeline integration**: After backfill, scene vectorization becomes a required step in the existing manager enrichment workflow for new video uploads in supported languages (en, es, fr). Note: unlike existing parallel steps (translate, chapters, metadata, embeddings) which all consume transcript text, scene vectorization needs video frame access via muxAssetId — it runs as an independent branch, not a simple addition to the existing parallel group.
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

  -- Extracted signals (for embedding, filtering, and display)
  description   TEXT NOT NULL,              -- concatenated extraction (all signals) — this is what gets embedded
  themes        TEXT[] DEFAULT '{}',        -- felt needs/themes: {"forgiveness","redemption","grief","hope"}
  bible_verses  TEXT[] DEFAULT '{}',        -- {"Matthew 6:14-15","Ephesians 4:32"}
  demographics  TEXT[] DEFAULT '{}',        -- {"youth","student"} — empty if not extractable
  chapter_title TEXT,                        -- from chapters.ts if available

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
- `mux_asset_id` / `playback_id` → Mux asset (for replaying the video segment)
- `scene_index` + `start_seconds` / `end_seconds` → exact moment in the video
- `description` → concatenated LLM extraction (themes, verses, content, tone, demographics)
- `themes` → felt needs/themes as structured array (for filtering and display)
- `bible_verses` → scripture references as structured array
- `demographics` → target audience signals as structured array (may be empty)
- `chapter_title` → link to chapters.ts output if it was the scene source

**Recommendation query pattern:**

```sql
-- Find similar scenes from DIFFERENT videos, locale-aware
-- $3 = user's locale (en, es, fr). Only return videos that have a variant in the user's language.
SELECT se.video_id, se.scene_index, se.description, se.start_seconds,
       1 - (se.embedding <=> $1) AS similarity
FROM scene_embeddings se
JOIN video_variants vv ON vv.video_id = se.video_id
JOIN languages l ON vv.language_id = l.id
WHERE se.video_id != $2          -- exclude current video
  AND l.bcp47 = $3               -- only videos available in user's locale
  AND se.language IN ('en', 'es', 'fr')  -- Phase 1 languages
ORDER BY se.embedding <=> $1
LIMIT 10;
```

**Why this schema:**

- **Separate from `video_embeddings`** (feat-009): Different columns (timestamps, description) and different query patterns (scene similarity vs. transcript keyword search). Separate tables let feat-009 proceed as-is.
- **`video_id` as dedup key**: Language variants are VideoVariants under the same Video parent. Embedding once per Video and filtering by `video_id !=` gives implicit cross-variant deduplication.
- **`language` column**: Enables Phase 1 (en, es, fr) filtering and future Phase 2 expansion without schema changes.
- **`description` stored**: Enables quality review, debugging, and re-embedding with a different model without re-running the LLM.

## Rough Cost Model

**Phase 1 (English + Spanish + French) — updated with R0 data audit results (Apr 6, 2026).**

### R0 Data Audit Results

**Video count by label (published, en/es/fr variants):**

| Label       | en  | es  | fr  | Total variants               |
| ----------- | --- | --- | --- | ---------------------------- |
| segment     | 398 | 340 | 376 | 1,114                        |
| episode     | 395 | 187 | 226 | 808                          |
| shortFilm   | 150 | 65  | 65  | 280                          |
| collection  | 44  | 36  | 37  | 117 (containers, duration=0) |
| series      | 53  | 18  | 35  | 106 (containers, duration=0) |
| featureFilm | 12  | 10  | 10  | 32                           |

- **Unique Video entities with en/es/fr variants: 1,052** (not 5K-10K as originally estimated)
- **Processable videos** (duration > 0, excluding collection/series containers): **955**

**Dedup model: CONFIRMED.** Language variants share a single Video parent:

- 607 Videos have variants in all 3 languages (en+es+fr)
- 191 Videos have variants in 2 languages
- 254 Videos have variants in only 1 language
- The Video → VideoVariant dedup strategy is sound. No revision needed.

**Duration distribution:**

- Segments: median 177s, all under 30min
- Episodes: median 248s, 63% under 5min, 37% between 5-30min
- ShortFilms: median 185s, 72% under 5min, 2 outliers over 30min
- FeatureFilms: median 4,792s (~80min), 81% (26/32) over 30min

**Chapter coverage: ZERO.** Enrichment pipeline tables are empty (0 enrichment jobs). All 955 processable videos will need chapters generated from scratch before scene vectorization.

### Revised Cost Estimate

Scene analysis runs once per unique Video entity (955 processable). The catalog is dramatically smaller than originally estimated (955 vs 5K-10K), which reduces cost by ~5-10x.

- Segments + episodes + shortFilms (~943 videos, median ~190s): ~943 × 3 scenes avg = ~2,829 scene descriptions
- Feature films (~12 unique videos, median ~80min): ~12 × 60 scenes avg = ~720 scene descriptions
- **Total: ~3,549 multimodal LLM calls**

At Gemini 2.5 Flash pricing (~$0.15/1M input tokens, ~$0.60/1M output tokens):

- Per scene: video segment (~30-120s avg) + transcript chunk + metadata
- Gemini 2.5 Flash video input: ~260 tokens/second of video. Avg scene ~60s = ~15,600 video tokens + ~500 transcript tokens + ~200 metadata tokens ≈ ~16.3K input tokens, ~800 output tokens (structured extraction)
- **Total input: 3,549 × 16.3K = ~57.8M tokens → ~$8.67**
- **Total output: 3,549 × 800 = ~2.8M tokens → ~$1.70**
- **Embedding cost**: 3,549 × text-embedding-3-small ≈ ~$0.07
- **Phase 1 revised total: ~$10-$15** (was $600-$900 based on 5K-10K estimate)
- Even accounting for chapter generation overhead (no existing chapters), total cost remains well under $50.

**Full catalog estimate (Phase 2, for future funding request):**

- Total published videos: 1,096. Even at all-language scale, the catalog is far smaller than the original 50K estimate (which likely counted all video_variants, not unique videos).
- ~5,000 scenes → ~$15-$25

Compare: Twelve Labs Embed at ~$0.03/min × estimated total minutes = significantly more expensive. Our approach remains the clear winner at this catalog size.

## Success Criteria

- Recommendations surface genuinely different films/clips based on visual and thematic similarity, not just metadata overlap
- **Measurable quality bar**: Curate 50-100 seed videos with human-labeled "expected similar" results. Scene embeddings must surface at least 3 relevant cross-film results in top 10 for 80% of seed videos, outperforming transcript-only embeddings on the same evaluation set.
- Feature-length films are segmented into meaningful narrative scenes (not raw shot cuts)
- The backfill worker can process the en/es/fr catalog without manual intervention (resumable on failure, cost-capped)
- New uploads in supported languages (en, es, fr) are automatically scene-vectorized as part of the enrichment pipeline
- **No locale bleed**: A user watching in Spanish never sees recommendations for the same video in English or French. Verified by testing seed videos across all three locales.
- **No human tags**: All semantic signal comes from LLM-generated scene descriptions. Existing CMS tags are not used for similarity or filtering.
- Language variants of the same content are deduplicated in recommendation results
- **Scoring is pure vector similarity** for Phase 1. User-driven feedback loop (clicks, watch time, ratings) is a Phase 2 concern — but the API accepts an optional re-ranking parameter to prepare for it.
- **Phase gate**: Phase 1 results are evaluated before requesting Phase 2 funding

## Scope Boundaries

- **Phase 1 only**: English, Spanish, and French videos. Other languages are Phase 2, out of scope.
- **Not building a user-facing search UI** — this is the recommendation engine layer. Search (feat-010) is a separate concern.
- **Not replacing transcript embeddings** — scene embeddings complement them. Both live in pgvector in separate tables.
- **Hybrid approach**: Start with LLM-generated scene descriptions embedded as text vectors (ships faster, reuses existing infra). Native video embedding models (Twelve Labs, Gemini video embeddings) are a future upgrade path, not in scope now.
- **Not building the recommendation UI** — this provides the vector similarity query capability. How recommendations are surfaced in web/mobile is a separate feature.
- **No human tags for similarity** — existing CMS tags are unreliable. All semantic signal comes from LLM-generated scene descriptions. If tags improve, they can be incorporated later.
- **No user feedback loop in Phase 1** — scoring is pure vector similarity. User-driven re-ranking (implicit and explicit signals) is a future enhancement. The API should be structured to accept re-ranking parameters but no feedback infrastructure is built.

## Key Decisions

- **Three-language prototype (en/es/fr)**: Process English, Spanish, and French videos (~$2-$5 actual cost per R0 audit). Three languages are the minimum to prove locale-aware deduplication actually works — you can't verify "no locale bleed" with one language. Catalog is 955 processable videos (was estimated at 5K-10K). Phase 2 is a separate funding decision.
- **Still frames via OpenRouter, not native video** (revised Apr 6, 2026): Send 3 representative thumbnail frames per scene + transcript to Gemini 2.5 Flash via the existing OpenRouter client. This avoids a new Google AI SDK dependency, new API keys, and Mux signing keys. The Core API-synced Mux assets have public playback — thumbnail URLs work without signing. Tradeoff: stills miss motion/pacing, but for dialogue-heavy ministry content, transcript + frames captures 90%+ of thematic signal. Can upgrade to native video later if quality evaluation shows gaps.
- **Felt needs/themes are the primary signal**: For ministry content, thematic similarity matters more than visual similarity. Two completely different scenes about forgiveness should recommend each other. The LLM prompt prioritizes felt needs/themes extraction, and themes appear first in the concatenated description to weight them in the embedding.
- **LLM structured extraction over native video embeddings**: Native video embedding APIs (Twelve Labs at ~$15K+) produce opaque vectors. Our approach extracts human-readable structured signals (themes, verses, demographics, content) that can be inspected, filtered, and displayed — plus the embedding. Full catalog at ~$2K-$4K vs Twelve Labs ~$15K+.
- **Scene-level granularity**: Embeddings are per-scene, not per-frame or per-video. Short clips may be 1-3 scenes; feature films 50-200. This is the right unit for recommendations.
- **Build on existing chapters pipeline**: The `chapters.ts` service already produces transcript-based scene segmentation with timestamps. R1 extends this with visual shot detection for feature films rather than building scene detection from scratch.
- **Bible verses from metadata + LLM**: CMS metadata provides existing verse references where available. The LLM identifies additional relevant scripture from scene context. Both are stored in the `bible_verses` array.
- **Demographics where extractable**: Target audience signals (age group, life stage, cultural context) are extracted when evident from the content. Not every scene will have clear demographic signals — the field may be empty. Stored as a structured array for optional filtering.
- **Separate `scene_embeddings` table**: Scene embeddings have different columns (timestamps, themes, verses, demographics) and query patterns than transcript chunk embeddings. Separate tables let feat-009 proceed as-is and keep query logic clean.
- **Hybrid storage: pgvector + lightweight metadata**: Scene data lives in the `scene_embeddings` table with full traceability columns rather than as a Strapi content type. Keeps it lean for prototype; can promote to CMS entity later if human-in-the-loop editing is needed.
- **Scene analysis pipeline decoupled from enrichment** (decided Apr 6, 2026): The scene analysis pipeline (subtitle → chapters → scene boundaries → Gemini analysis) runs as a standalone workflow, not as steps in the enrichment pipeline. Reasons: (1) 974 videos already have human-produced subtitles from the Core API sync — no Mux transcription needed; (2) scene analysis is sequentially dependent on chapters, unlike the parallel enrichment steps; (3) the backfill worker needs to process videos independently of enrichment. Triggered via `POST /api/scene-analysis`. The enrichment pipeline remains unchanged for its original purpose (transcription, translation, chapters, metadata, embeddings).
- **Use existing Core API subtitles, not Mux transcription** (decided Apr 6, 2026): The `video_subtitles` table has VTT URLs for 974 videos from the Core API sync. These are human-produced transcripts, higher quality than Mux auto-generated subtitles. The scene analysis pipeline fetches and parses these VTT files directly. Of these, 462 videos have both English subtitles and Mux video data — the immediately processable set for Phase 1.
- **Backfill worker separate from manager**: The one-time catalog processing runs as a dedicated worker service (can scale independently, doesn't block the manager pipeline). Can reuse the same workflow code/libraries. New uploads use the integrated manager pipeline step.
- **Deduplication via Video → VideoVariant model**: Scene detection and embedding runs once per Video entity (the parent), not per VideoVariant. Recommendations filter by unique Video ID. Confirm during data audit (R0) that language variants are modeled as VideoVariants, not separate Video records.
- **No human tags for similarity**: Existing CMS tags are unreliable. All semantic signal comes from LLM extraction against the actual video + transcript. If tags improve, they can be incorporated later.
- **Pure vector similarity for Phase 1 scoring**: No user feedback loop, no click-through weighting, no personalization. Get the prototype working first. The recommendation API accepts an optional `rerank` parameter (no-op in Phase 1) so the interface is ready for user-driven scoring in Phase 2.

## Dependencies / Assumptions

- **pgvector must be deployed first** (feat-009, scheduled Apr 7, 14-day duration → ~Apr 21) — R3, R4, R6 are blocked. R0, R1, R2, R5 scaffolding can proceed in parallel.
- **Existing chapters pipeline** in manager is working and produces scene-like segmentation
- **Gemini 2.5 Flash video input**: Accepts video natively (up to ~1hr). Scene segments are passed as video input alongside transcript text and CMS metadata. Confirm during planning: how to pass a Mux video URL directly to Gemini vs downloading the segment first.
- **Mux video segment access**: Need to confirm how to extract a video segment (start/end timestamps) from Mux for Gemini input. Options: (a) Mux clip API, (b) download full video and trim, (c) pass Mux stream URL with timestamp params. The thumbnail API (`image.mux.com/{PLAYBACK_ID}/thumbnail.jpg?time=N`) is still useful for recommendation card display but NOT for scene analysis input.
- **New multimodal LLM client needed** — existing OpenRouter client is text-only; R2 requires sending video + text to Gemini
- **Railway worker constraints** — need to confirm Railway supports long-lived worker processes or design backfill as queue-based with short-lived jobs. Existing `railway.toml` has `restartPolicyMaxRetries: 3` which may not suit multi-day processing.

## Outstanding Questions

### Deferred to Planning

- ~~[Affects R0][Data audit] Query CMS for en/es/fr video count by label, duration distribution, chapter metadata coverage, and Video→VideoVariant dedup model.~~ **DONE (Apr 6, 2026)**: 955 processable videos, dedup confirmed, zero chapter coverage. See Rough Cost Model section.
- [Affects R1b][Needs research] Which visual scene detection libraries work best for narrative film content? PySceneDetect handles shot boundaries; evaluate options for combining with transcript-based scene detection.
- [Affects R2][Needs research] Confirm Gemini 2.5 Flash video input: how to pass a Mux video segment (start/end timestamps) — Mux clip API, signed URL with range params, or download-and-trim?
- [Affects R2][Technical] What is the optimal scene segment length for Gemini video input? Short scenes (<30s) vs long scenes (>5min) may need different handling.
- [Affects R5][Technical] Backfill worker architecture — queue-based (process videos from a job queue) or single long-lived process? Depends on Railway constraints.
- [Affects R4][Technical] How will scene similarity interact with feat-010 semantic search API? Different query pattern (find similar scenes vs. keyword search).

## Technology Research

**Researched Apr 2, 2026. Updated Apr 6, 2026.**

### Approach Comparison

| Approach                                         | Est. Cost (Phase 1 en/es/fr) | Quality                         | Infra Complexity          |
| ------------------------------------------------ | ---------------------------- | ------------------------------- | ------------------------- |
| **Gemini 2.5 Flash video + text-embed (chosen)** | **$600-900**                 | **High (temporal + narrative)** | **Low (reuses existing)** |
| Gemini 2.5 Flash stills + text-embed (previous)  | $130-400                     | Medium (misses motion/pacing)   | Low                       |
| Gemini Embedding 2 (direct video embed)          | $2,000-5,000                 | High (native multimodal)        | Medium (new index)        |
| Twelve Labs Embed (Marengo 3.0)                  | $10,000+                     | Highest (purpose-built)         | Medium (new index)        |
| CLIP/SigLIP local                                | ~$0 (compute only)           | Low (visual only, no narrative) | Medium (new index + GPU)  |

### Chosen: Gemini 2.5 Flash Video Segments + text-embed

- **Video input**: Accepts video natively at ~260 tokens/second. A 60s scene ≈ 15,600 video tokens.
- **Why video over stills**: Netflix and YouTube both process actual video (temporal signals, motion, pacing) not keyframes. Stills miss scene dynamics that carry meaning — a still of someone walking by water doesn't tell you if it's a peaceful reflection or a panicked escape.
- **Structured extraction**: Unlike opaque embedding models, our approach extracts human-readable signals (themes, verses, demographics) alongside the embedding input. This enables filtering, display, and quality inspection.
- **Why not GPT-4o**: 8x more expensive for comparable quality.
- **Why not Claude**: Haiku 3-4x more expensive, Sonnet 10x. Not justified at scale.
- **Why not CLIP/SigLIP**: Captures "what's in this image" not narrative meaning. Will find "beach scene" but miss "baptism at a river" vs "family swimming at a lake." Incompatible vector space with text-embedding-3-small. Insufficient for ministry content requiring felt-need/theme nuance.

### Future Upgrade Path: Gemini Embedding 2

Google's multimodal embedding model (public preview, Mar 2026):

- 3072 dims (Matryoshka down to 768). Can target 1536 to match existing space.
- Accepts text, image, video, audio in one unified embedding space.
- **Video constraint**: max 80-120 seconds per clip → fits our scene-based approach.
- **When to adopt**: Once out of preview and pricing stabilizes. Could replace the describe-then-embed pipeline with direct video embeddings, but loses the structured signal extraction (themes, verses, demographics).

### Mux Video & Thumbnail Access

**For scene analysis (video segments)**:

- **Research needed**: How to pass a scene segment (start/end timestamps) to Gemini. Options: (a) Mux clip API, (b) download full video and trim with ffmpeg, (c) Mux signed URL with range params. Evaluate during feat-040 planning.

**For recommendation card display (thumbnails)**:

- **URL**: `https://image.mux.com/{PLAYBACK_ID}/thumbnail.{png|jpg|webp}?time={SECONDS}`
- **Resolution**: Supports `?width=512&height=512` for card-friendly sizes.
- **Cost**: Included in Mux standard pricing. No per-thumbnail charge. CDN cached.

## Roadmap Tickets

This brainstorm produced the following roadmap features in `docs/roadmap/content-discovery/`:

| ID                                                                                   | Feature                             | Days | Start  | Depends on                   |
| ------------------------------------------------------------------------------------ | ----------------------------------- | ---- | ------ | ---------------------------- |
| [feat-037](../roadmap/content-discovery/feat-037-video-content-vectorization.md)     | Parent: Video Content Vectorization | 42   | Apr 21 | feat-009, feat-031           |
| [feat-038](../roadmap/content-discovery/feat-038-video-vectorization-data-audit.md)  | Data Audit                          | 3    | Apr 21 | feat-037                     |
| [feat-039](../roadmap/content-discovery/feat-039-chapter-based-scene-boundaries.md)  | Chapter-Based Scene Boundaries      | 7    | Apr 24 | feat-038                     |
| [feat-040](../roadmap/content-discovery/feat-040-multimodal-scene-descriptions.md)   | Multimodal Scene Analysis           | 10   | May 1  | feat-039                     |
| [feat-041](../roadmap/content-discovery/feat-041-scene-embeddings-table.md)          | Scene Embeddings Table + Indexing   | 7    | May 11 | feat-009, feat-040           |
| [feat-042](../roadmap/content-discovery/feat-042-backfill-worker.md)                 | Phase 1 Backfill Worker (en/es/fr)  | 10   | May 18 | feat-038, feat-040, feat-041 |
| [feat-043](../roadmap/content-discovery/feat-043-visual-shot-detection-fusion.md)    | Visual Shot Detection Fusion (P2)   | 10   | May 28 | feat-039                     |
| [feat-044](../roadmap/content-discovery/feat-044-recommendation-query-api.md)        | Recommendation Query API            | 7    | May 28 | feat-041, feat-042           |
| [feat-045](../roadmap/content-discovery/feat-045-pipeline-integration.md)            | Pipeline Integration                | 7    | Jun 4  | feat-041, feat-042           |
| [feat-046](../roadmap/content-discovery/feat-046-recommendations-demo-experience.md) | Recommendations Demo Experience     | 7    | Jun 4  | feat-044                     |

## Next Steps

→ `/ce:plan` for structured implementation planning (R0 data audit is first planning task).
