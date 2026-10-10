---
id: "feat-092"
title: "Two-Tower Neural Recommendation Model"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: "2026-05-24"
duration: 21
depends_on:
  - "feat-090"
blocks:
  - "feat-093"
  - "feat-094"
tags:
  - "cms"
  - "web"
  - "ai-pipeline"
  - "personalization"
  - "pgvector"
---

## Closure Decision

Cancelled on 2026-07-21. The proposed Two-Tower/ONNX pipeline was never adopted
and depends on the superseded `feat-090` anonymous session architecture. A
future learned recommender should begin with current Admin-owned Watch events,
catalog embeddings, and an explicit evaluation and serving design rather than
implement this historical model contract.

## Problem

The home page and recommendation components need session-aware personalization beyond sequential "watch next" prediction. A Two-Tower neural model learns a shared embedding space where user sessions and video content can be compared via dot product, enabling personalized discovery based on the full session context — not just the last-watched video.

## Entry Points — Read These First

1. `apps/cms/src/api/scene-embedding/services/recommender.ts` — current recommendation query; Two-Tower results will be served alongside or instead of cosine similarity for home/recs surfaces
2. `apps/cms/src/bootstrap/ensure-pgvector.ts` — pgvector table creation pattern for the 256-dim learned item embeddings
3. `apps/cms/src/api/scene-embedding/services/indexer.ts` — existing embedding indexing pattern
4. `docs/brainstorms/2026-04-12-user-feedback-driven-recommendations-requirements.md` — R7-R9 (Two-Tower requirements)

## Grep These

- `vector(1536)` in `apps/cms/src/` — existing embedding columns; the learned projection is `vector(256)`
- `onnx\|onnxruntime` in `apps/cms/` — check if already a dependency
- `recommender` in `apps/cms/src/api/scene-embedding/` — serving path
- `watch_events` in `apps/cms/src/` — training data source

## What To Build

### Item tower (offline, pre-computed)

- Linear projection: 1536-dim scene embeddings → 256-dim learned item embeddings
- Projection matrix learned during training, applied to all scene embeddings
- Store 256-dim embeddings in a new pgvector column or table alongside the 1536-dim originals
- HNSW index on the 256-dim column for fast ANN retrieval

### User tower (online, per-request)

- Input: mean-pooled 256-dim embeddings of the session's watched videos + context features (geo region, device type, browser language, time of day)
- Architecture: 2-layer MLP → 256-dim user embedding
- Forward pass at request time via `onnxruntime-node` (~1ms)
- Output: 256-dim user embedding → dot product against item embeddings in pgvector

### Training pipeline (offline, Python)

- PyTorch training job reading from `watch_events`
- Contrastive learning: positive pairs from session co-occurrence, negatives sampled
- Trains both the item projection matrix and user tower MLP jointly
- Exports: item projection to PostgreSQL (bulk update 256-dim column), user tower to ONNX
- Versioned artifacts; rollback via config pointing to previous version
- Retraining cadence: weekly initially, increase as data grows

### Serving (CMS)

- `onnxruntime-node` dependency added to `apps/cms`
- At request time: load ONNX model → compute user embedding → pgvector ANN query for nearest 256-dim items
- Activate when total sessions with 2+ videos exceed 50K (global threshold)
- Below threshold: fall back to existing cosine similarity on 1536-dim embeddings

## Constraints

- Frozen item tower: do not learn item embeddings from scratch; project existing scene embeddings
- User tower model must be <10MB for reasonable `onnxruntime-node` memory footprint
- Cold start (no session data) handled by feat-093, not this ticket — here, sessions with no history get existing cosine similarity
- No real-time model updates; batch training only
- Phase 1 languages only (en, es, fr)

## Verification

1. `onnxruntime-node` loads the ONNX model and produces a 256-dim vector in <5ms
2. pgvector ANN query on 256-dim embeddings returns results in <50ms
3. Two sessions with different watch histories produce different user embeddings
4. Recommendations for a session that watched contemplative content skew toward contemplative videos
5. A session below the 2-video threshold falls back to cosine similarity transparently
6. Global activation: when `SELECT COUNT(DISTINCT session_id) FROM watch_events GROUP BY session_id HAVING COUNT(*) >= 2` exceeds 50K, Two-Tower activates
7. Model rollback: changing the ONNX artifact version restores previous behavior
