---
id: "feat-036"
title: "Semantic Visualization Workbench"
owner: "ekkasit"
priority: "P1"
status: "not-started"
start_date: "2026-05-19"
duration: 21
depends_on:
  - "feat-007"
blocks: []
tags:
  - "manager"
  - "search"
  - "ai-pipeline"
---

## Problem

Clustering and embeddings will exist as machine outputs, but the manager app still needs a human-readable way to inspect them. Operators need a visual workbench that explains natural topic clusters, nearest-neighbor matches, and graph relationships before those outputs drive topic generation.

## Entry Points — Read These First

1. `docs/roadmap/topic-experiences/feat-007-topic-clustering.md` — the clustering output contract to visualize
2. `apps/manager/src/services/embeddings.ts` — embedding storage shape and chunking model
3. `apps/manager/src/services/storage.ts` — artifact download pattern for clustering/embedding results
4. `apps/manager/src/app/dashboard/coverage/page.tsx` and `apps/manager/src/features/coverage/coverage-report-client.tsx` — manager route/component patterns to follow
5. `apps/manager/src/app/globals.css` — existing dashboard styling system

## Grep These

- `EmbeddingsResult|chunkText|text-embedding-3-small` in `apps/manager/src/services/embeddings.ts`
- `clustering-result.json` in `docs/roadmap/topic-experiences/feat-007-topic-clustering.md`
- `coverage` in `apps/manager/src/features/` for dashboard section patterns

## What To Build

1. New route: `apps/manager/src/app/dashboard/topics/page.tsx`
   - Cluster-first view with cards for topic clusters, confidence, size, and representative videos.
2. New route or pane: `apps/manager/src/app/dashboard/topics/graph/page.tsx`
   - Obsidian-like graph with video nodes, cluster nodes, and relationship edges.
3. New UI modules: `apps/manager/src/features/topics/`
   - Cluster detail panel showing source topics, related clusters, and outlier videos.
   - Video neighbor panel showing nearest vector matches and similarity scores.
4. Lightweight operator curation:
   - Mark a cluster as good/bad, pin/hide a relationship, rename a cluster label, or flag a split candidate.

## Constraints

- Use existing clustering/embedding outputs. Do NOT redesign the clustering algorithm in this feature.
- Keep human curation lightweight. Do NOT create a manual taxonomy editor.
- Keep rendering performant for large graphs; avoid loading the entire universe if a neighborhood view is enough.

## Verification

- Open `/dashboard/topics` and see cluster summaries based on actual clustering artifacts.
- Selecting a video reveals nearest semantic matches with stable similarity scores.
- The graph view makes cluster relationships explorable without locking up the page.
- A curation action persists and is visible on reload.
