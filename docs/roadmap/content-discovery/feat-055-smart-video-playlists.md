---
id: "feat-055"
title: "Smart Video Playlists"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-05-31"
duration: 31
depends_on:
  - "feat-044"
blocks: []
tags:
  - "search"
  - "playlist"
  - "ai-pipeline"
---

## Problem

Playlists are currently manual, which makes it hard to turn a new prompt, topic description, or embedding vector into a usable viewing journey. We need a smart playlist system that can generate and rank a playlist from text or vector input and then hand that playlist to downstream product surfaces.

## Entry Points — Read These First

1. `apps/cms/src/api/core-sync/gql/graphql.ts` — existing playlist operations already exposed from the Core API contract
2. `apps/manager/src/services/embeddings.ts` — embedding model and vector shape used elsewhere
3. `apps/manager/src/services/metadata.ts` — topic/theme extraction signal that can seed playlist generation
4. `apps/web/src/lib/content.ts` — web-side query location for playlist consumption
5. `docs/roadmap/content-discovery/feat-044-recommendation-query-api.md` — upstream scene-recommendation API contract

## Grep These

- `playlistCreate|playlistItemAdd` in `apps/cms/src/api/core-sync/gql/graphql.ts`
- `text-embedding-3-small` in `apps/manager/src/services/embeddings.ts`
- `topics|tags` in `apps/manager/src/services/metadata.ts`
- `graphql(` in `apps/web/src/lib/content.ts`

## What To Build

1. Accept a free-text request or vector input and turn it into a ranked playlist request.
2. Use the recommendation/query stack to fetch relevant videos or scenes, then collapse results into a playable sequence.
3. Decide whether smart playlists are ephemeral, persisted, or support both modes.
4. Connect generated playlists to the existing playlist contract instead of inventing another list primitive.
5. Keep room for manual edits on top of the auto-generated baseline.

## Constraints

- Do NOT hardcode playlists when the point is generation from text or vectors.
- Reuse existing playlist operations where they fit.
- Keep the generation logic debuggable; editors should be able to understand why items were chosen.

## Verification

- Generate a playlist from a text prompt and confirm it returns a coherent ordered set of videos
- Generate a playlist from a vector input and confirm the same pipeline works
- Persist or replay the generated playlist through the existing playlist contract
