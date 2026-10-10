---
id: "feat-007"
title: "Topic Clustering from Enriched Metadata"
owner: "ekkasit"
priority: "P0"
status: "not-started"
start_date: "2026-04-01"
duration: 21
depends_on:
  - "feat-002"
  - "feat-003"
blocks:
  - "feat-020"
  - "feat-013"
  - "feat-036"
  - "feat-039"
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

The enrichment pipeline extracts topics, tags, and embeddings per video. To generate topic pages at scale, we need to cluster videos into coherent topic groups.

## Entry Points — Read These First

1. `apps/manager/src/services/metadata.ts` — `VideoMetadata` type: `{ topics: string[], tags: string[], speakers: string[] }`
2. `apps/manager/src/services/embeddings.ts` — `EmbeddingsResult` type: `{ chunks: Array<{ text: string, embedding: number[] }> }`
3. `apps/manager/src/services/storage.ts` — `downloadArtifact(assetId, 'metadata.json')` and `downloadArtifact(assetId, 'embeddings.json')` to read existing artifacts
4. `apps/cms/src/api/keyword/content-types/keyword/schema.json` — Keyword model with `value`, `source`, `language` fields
5. `apps/cms/src/api/video/content-types/video/schema.json` — Video model with `keywords` manyToMany relation

## Grep These

- `VideoMetadata` in `apps/manager/src/services/metadata.ts` — the extracted metadata type
- `EmbeddingsResult` in `apps/manager/src/services/embeddings.ts` — embedding storage format
- `chunkText` in `apps/manager/src/services/embeddings.ts` — how text is chunked (512 words)
- `text-embedding-3-small` in `apps/manager/src/services/embeddings.ts` — embedding model (1536 dimensions)

## What To Build

1. New file: `apps/manager/src/services/clustering.ts`

   ```typescript
   export type TopicCluster = {
     name: string // e.g. "Forgiveness"
     slug: string // e.g. "forgiveness"
     description: string // brief description for the topic
     parentCluster?: string // slug of parent for hierarchy
     videoIds: string[] // ordered by relevance
     confidence: number // 0-1, how coherent the cluster is
     sourceTopics: string[] // original AI-extracted topic strings that formed this cluster
   }

   export async function clusterVideosIntoTopics(
     videos: Array<{
       id: string
       metadata: VideoMetadata
       embeddings: EmbeddingsResult
     }>,
   ): Promise<TopicCluster[]>
   ```

2. Clustering approach:
   - **Step 1**: Group videos by exact topic string match (from `metadata.topics[]`)
   - **Step 2**: Merge near-duplicate topic groups using embedding similarity (e.g., "Forgiveness" and "Forgiving Others" may merge or become parent/child)
   - **Step 3**: For each group, compute a centroid embedding and find additional videos within a similarity threshold
   - **Step 4**: Build hierarchy — broad topics ("Love") containing narrower ones ("God's Love", "Loving Your Neighbor")

3. Use cosine similarity for embedding comparison. The embeddings are 1536-dim float arrays — compute dot product (vectors are already normalized by text-embedding-3-small).

4. Output to a JSON artifact: `clustering-result.json` stored in S3.

## Constraints

- Do NOT use external clustering libraries (sklearn, etc.) — this runs in Node.js. Use simple cosine similarity + threshold-based grouping.
- Do NOT call LLMs for clustering. Use the embeddings that already exist. LLMs are only for generating content later (Vlad Feature 3).
- Minimum 3 videos per cluster. Drop clusters with fewer.
- Maximum 2 levels of hierarchy for now (parent -> child). Do not build arbitrary depth.

## Verification

- Run on a sample of 100 enriched videos → produces clusters
- Each cluster has >= 3 videos
- No video appears in 0 clusters (every enriched video belongs to at least one topic)
- Clusters have human-readable names (derived from the most common topic string in the group)
- `JSON.parse(downloadArtifact('clustering-result.json'))` returns valid `TopicCluster[]`

## Dependencies

- **Vlad Feature 1** (metadata synced back to CMS) — OR read directly from S3 artifacts. Prefer S3 artifacts for the clustering step since it's a batch operation.
