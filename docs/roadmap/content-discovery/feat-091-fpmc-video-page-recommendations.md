---
id: "feat-091"
title: "FPMC Video Page Recommendations"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: "2026-05-10"
duration: 14
depends_on:
  - "feat-090"
blocks:
  - "feat-094"
tags:
  - "cms"
  - "web"
  - "ai-pipeline"
  - "personalization"
---

## Closure Decision

Cancelled on 2026-07-21. The proposed FPMC implementation depends on the
anonymous session-event and legacy CMS architecture from `feat-090`, which has
been superseded by authenticated Admin-owned watch events in `feat-229`. If
sequence-based personalization is prioritized later, it should be planned
against the current Watch event and recommendation services.

## Problem

On video pages, "watch next" recommendations are pure cosine similarity — every user sees the same list. Factorized Personalized Markov Chains (FPMC) combine global transition patterns ("from video A, most users go to video B") with session preference patterns ("this session watches contemplative content") to predict the most likely next video for each session.

## Entry Points — Read These First

1. `apps/cms/src/api/scene-embedding/services/recommender.ts` — current cosine similarity recommendation query; blend logic will be added here
2. `apps/cms/src/api/scene-embedding/services/recommender.ts:deduplicateResults` — 3-layer dedup that must work with blended scores
3. `docs/brainstorms/2026-04-12-user-feedback-driven-recommendations-requirements.md` — R4-R6 (FPMC requirements)
4. `watch_events` table (feat-090) — source data for training

## Grep These

- `queryPerVideo\|querySimilar` in `apps/cms/src/api/scene-embedding/` — recommendation entry points
- `deduplicateResults` in `apps/cms/src/` — dedup that must handle blended scores
- `watch_events` in `apps/cms/src/` — interaction data source

## What To Build

### Training pipeline (offline, Python)

- Python script using PyTorch (or RecBole for experimentation)
- Reads non-bounce `watch_events` grouped by `session_id`, ordered by `created_at`
- Trains FPMC model: learns transition matrix (video A → video B) factorized with session latent factors
- Exports transition factors to PostgreSQL tables:
  - `fpmc_transitions(from_video_id, to_video_id, transition_score)` — global transition probabilities
  - `fpmc_factors(video_id, factor_vector)` — latent factor embeddings for matrix factorization component
- Training job runs as a Railway cron or GitHub Action (decide during planning)
- Versioned model artifacts; rollback is a config change

### Blend logic (CMS recommender.ts)

- For each recommendation request on a video page:
  1. Get cosine similarity candidates (existing path)
  2. Get FPMC transition scores for the source video
  3. Blend: `score = (1 - w) * cosine + w * fpmc` where `w` is a function of observation count
  4. Blend weight ramp: start at `w=0.1` (90% content, 10% FPMC), shift toward `w=0.5` as transition observations grow
- Accept optional `sessionId` parameter to incorporate session-specific factors when available

### Progressive activation

- Per-video activation threshold: only use FPMC scores when the source video has >= 20 observed transitions
- Below threshold: pure cosine similarity (current behavior, invisible to user)
- Activation check is a simple count query against `fpmc_transitions`

## Constraints

- Fallback must be invisible — when FPMC data is insufficient, users see the same results as today
- Do not retrain on every request; models are batch-trained offline
- Blend weight formula must be tunable without redeployment (configurable constant or env var)
- Phase 1 languages only (en, es, fr)
- Do not modify the search API — FPMC applies to video page recommendations only

## Verification

1. Two users watching the same video with different session histories see different "watch next" lists
2. A video with 20+ transitions shows blended scores; a video with <20 transitions shows pure cosine
3. Blend weight at 20 observations is ~0.1; at 200+ observations approaches 0.5
4. Recommendation quality: for 50 seed videos with sufficient transitions, at least 30% of top-5 results differ from pure cosine baseline
5. Training pipeline completes in <1 hour for current data volume
6. Rollback: switching model version restores previous recommendation behavior
