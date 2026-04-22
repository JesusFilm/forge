# Scene Vectorization Pipeline — How It Works

## Overview

The scene vectorization pipeline processes JesusFilm's video catalog and creates searchable embeddings that power cross-film content recommendations. It analyzes each video's visual frames and transcript to extract structured signals (themes, bible verses, spiritual context, demographics), then converts those signals into mathematical vectors stored in PostgreSQL's pgvector extension.

## What Goes Into Each Embedding

Each scene in a video produces a single 1536-dimensional vector. That vector is generated from a **description string** that concatenates all extracted signals in priority order:

```
Themes: forgiveness, redemption, hope, reconciliation.
Bible verses: Romans 5:8, John 3:16, Ephesians 2:8-9.
Content: A father confronts his estranged son after years apart. The son asks for forgiveness and they embrace.
Tone: sorrowful, hopeful.
Demographics: young adult, adult.
Spiritual context: seeker, new believer, secular background.
```

This description is sent to OpenAI's `text-embedding-3-small` model, which returns a 1536-dimensional vector capturing the semantic meaning of the entire text. Themes appear first in the description to weight them more heavily in the embedding.

### Role of Visual Frames

Each scene analysis sends **3 representative thumbnail frames** from the Mux video to Gemini 2.5 Flash alongside the transcript text. The LLM sees both what is being said and what is being shown. This means:

- A dark, somber crucifixion scene gets different tone/themes than a bright celebration — even if both mention "sacrifice"
- Visual cues (a child's face, a crowd, a baptism at a river) influence demographic and spiritual context extraction
- Scenes with no dialogue still get analyzed based on the visual content

The images influence the **extracted signals**, which then shape the embedding. The embedding model itself (`text-embedding-3-small`) is text-only — it embeds the description string that was informed by both visual and textual analysis.

```
[3 Mux thumbnail frames] + [transcript chunk]
            ↓
    Gemini 2.5 Flash (multimodal LLM)
            ↓
    Structured signals (themes, tone, demographics, etc.)
            ↓
    Concatenated description text
            ↓
    text-embedding-3-small → 1536-dim vector
```

## Pipeline Steps (Per Video)

```
1. Fetch subtitle     → VTT file from Core API (human-produced transcript)
2. Generate chapters  → Gemini 2.5 Flash splits transcript into narrative chapters
3. Scene boundaries   → Map chapters to scenes with start/end timestamps
4. Scene analysis     → For each scene:
                         - 3 thumbnail frames from Mux + transcript chunk
                         - Sent to Gemini 2.5 Flash (multimodal)
                         - Extracts: themes, bible verses, content summary,
                           tone, demographics, spiritual context
5. Embed              → Scene descriptions → text-embedding-3-small → 1536-dim vectors
6. Index              → Vectors + metadata stored in pgvector (scene_embeddings table)
```

## Extracted Signals

### Themes (2-5 per scene)

The most important signal for ministry content. Captures the felt human need the scene addresses.

Examples: forgiveness, hope, grief, loneliness, identity, redemption, belonging, purpose, healing, doubt, courage, fear, reconciliation, guilt, mercy, faith, love, justice, peace, joy

**Why it matters**: Two completely different scenes about forgiveness — one from a feature film, one from an animated short — should recommend each other. Themes enable this cross-content discovery.

### Bible Verses (1-5 per scene)

Scripture references relevant to the scene's themes, in standard format.

Examples: Matthew 6:14-15, Ephesians 4:32, Romans 5:8, John 3:16

Sources: CMS metadata (existing references) + LLM-identified additional verses from the scene content.

### Content Summary (1-3 sentences)

Narrative description of what happens: dialogue, actions, message being communicated.

### Emotional Tone (1-2 words)

Mood of the scene.

Examples: contemplative, joyful, grieving, urgent, peaceful, hopeful, sorrowful, reverent, celebratory

### Demographics (0-3 per scene, enum-constrained)

Target audience signals, only when clearly evident from the content.

Values: `children`, `youth`, `young adult`, `adult`, `elderly`, `parent`, `student`, `family`

Empty when not clearly applicable (e.g., a landscape scene with narration).

### Spiritual Context (0-3 per scene, enum-constrained)

What spiritual background or faith journey stage the scene would resonate with most.

Values: `seeker`, `new believer`, `mature believer`, `skeptic`, `muslim background`, `hindu background`, `buddhist background`, `jewish background`, `secular background`, `animist background`, `culturally christian`, `persecuted believer`

Empty when not clearly applicable.

## How Recommendations Work

The embeddings enable two types of discovery:

### 1. Vector Similarity (Semantic Matching)

"Find scenes that feel like this one" — uses cosine distance between embedding vectors.

```sql
SELECT video_id, description, 1 - (embedding <=> $query_embedding) AS similarity
FROM scene_embeddings
WHERE video_id != $current_video
ORDER BY embedding <=> $query_embedding
LIMIT 10;
```

This finds thematically similar scenes across different films. A scene about forgiveness in "JESUS" will surface similar scenes in "Magdalena" or "Why Did Jesus Have to Die?" — even though they are completely different productions.

### 2. Metadata Filtering (Targeted Discovery)

"Find scenes for this audience" — uses the structured arrays stored alongside the embedding.

```sql
-- Scenes for seekers from a secular background
WHERE 'seeker' = ANY(spiritual_context)

-- Scenes targeting youth
WHERE 'youth' = ANY(demographics)

-- Scenes about forgiveness with relevant bible verses
WHERE 'forgiveness' = ANY(themes)
```

### Combined Query

The recommendation API will combine both — filter by audience, rank by vector similarity:

```sql
SELECT se.video_id, se.description,
       1 - (se.embedding <=> $query_embedding) AS similarity
FROM scene_embeddings se
JOIN video_variants vv ON vv.video_id = se.video_id
JOIN languages l ON vv.language_id = l.id
WHERE se.video_id != $current_video          -- exclude current video
  AND l.bcp_47 = $user_locale               -- only videos in user's language
ORDER BY se.embedding <=> $query_embedding
LIMIT 10;
```

## What's Stored in the Database

Each row in `scene_embeddings` represents one scene from one video:

| Column              | Type         | Description                                     |
| ------------------- | ------------ | ----------------------------------------------- |
| `video_id`          | INTEGER      | FK to the parent Video entity                   |
| `scene_index`       | INTEGER      | Scene position within the video (0-based)       |
| `start_seconds`     | FLOAT        | Scene start timestamp                           |
| `end_seconds`       | FLOAT        | Scene end timestamp                             |
| `description`       | TEXT         | Concatenated extraction (what gets embedded)    |
| `themes`            | TEXT[]       | Felt needs/themes as structured array           |
| `bible_verses`      | TEXT[]       | Scripture references                            |
| `demographics`      | TEXT[]       | Target audience (enum-constrained)              |
| `spiritual_context` | TEXT[]       | Faith journey stage (enum-constrained)          |
| `chapter_title`     | TEXT         | Chapter title from the transcript               |
| `embedding`         | vector(1536) | The searchable embedding vector                 |
| `model`             | TEXT         | Embedding model used (`text-embedding-3-small`) |
| `language`          | TEXT         | Transcript language used for analysis           |
| `mux_asset_id`      | TEXT         | Mux video asset (for thumbnail display)         |
| `playback_id`       | TEXT         | Mux playback ID (for video playback)            |

### Indexes

- **HNSW** on `embedding` — fast approximate nearest neighbor search
- **B-tree** on `video_id` — fast lookup by video
- **B-tree** on `language` — fast filtering by language

## Scale

| Metric               | Value                                           |
| -------------------- | ----------------------------------------------- |
| Videos processed     | 467/468                                         |
| Total scenes         | ~2,000                                          |
| Avg scenes per video | ~4-6 (episodes/segments), 15-40 (feature films) |
| Embedding dimensions | 1,536                                           |
| Processing cost      | ~$0.50-$0.80 per full catalog run               |
| Processing time      | ~2 hours                                        |
| Storage              | ~50MB in pgvector                               |

## Locale-Aware Deduplication

Each video is processed once using the best available subtitle (English preferred, then Spanish, then French). Language variants of the same film share a single `video_id` parent — the recommendation query excludes `video_id = current` to prevent recommending the same film in a different language.

A user watching in Spanish sees recommendations for videos that have a Spanish variant, regardless of which language was used for the scene analysis.

## Quality Guarantees

- **Structured output** (`response_format: json_schema`) guarantees valid JSON from Gemini — no parse failures
- **Bad frame detection** — LLM signals when thumbnails are dark/blank, pipeline retries with shifted timestamps
- **Enum constraints** on demographics and spiritual context — no casing inconsistencies or invented categories
- **Empty description filter** — scenes where the LLM extracts no signals are skipped (no garbage embeddings)
- **Embedding retry** with single-item fallback — transient API failures don't lose computed work
- **Resumable** — the pipeline can be stopped and restarted; already-indexed videos are skipped
