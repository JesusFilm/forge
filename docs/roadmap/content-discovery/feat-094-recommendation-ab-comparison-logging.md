---
id: "feat-094"
title: "Recommendation A/B Comparison Logging"
owner: "nisal"
priority: "P2"
status: "cancelled"
start_date: "2026-06-21"
duration: 7
depends_on:
  - "feat-091"
  - "feat-092"
blocks: []
tags:
  - "cms"
  - "web"
  - "infrastructure"
  - "personalization"
---

## Closure Decision

Cancelled on 2026-07-21. The proposed comparison requires the FPMC and
Two-Tower candidates from `feat-091` and `feat-092`, neither of which belongs to
the current recommendation architecture. Experiment logging should be designed
with whichever replacement personalized ranker is eventually selected.

## Problem

After FPMC (feat-091) and Two-Tower (feat-092) are live, there is no way to measure whether personalized recommendations actually improve user engagement compared to the content-similarity baseline. Without comparison data, model tuning is guesswork.

## Entry Points — Read These First

1. `apps/cms/src/api/scene-embedding/services/recommender.ts` — recommendation serving path where dual scores will be computed
2. `watch_events` table (feat-090) — existing interaction logging; impression logging follows the same pattern
3. `docs/brainstorms/2026-04-12-user-feedback-driven-recommendations-requirements.md` — R13-R14 (progressive rollout, A/B comparison)

## Grep These

- `queryPerVideo\|querySimilar` in `apps/cms/src/api/scene-embedding/` — recommendation endpoints
- `watch_events` in `apps/cms/src/` — event logging pattern to mirror

## What To Build

### Dual-score response

- Recommendation API returns both scores for each result:
  - `contentScore`: pure cosine similarity (the baseline)
  - `blendedScore`: model-blended score (FPMC or Two-Tower, depending on surface)
- The ranked order uses `blendedScore`; `contentScore` is logged for comparison
- Response shape is additive — existing consumers that don't read `contentScore` are unaffected

### Impression logging

New `recommendation_impressions` table:

```sql
CREATE TABLE IF NOT EXISTS recommendation_impressions (
  id                SERIAL PRIMARY KEY,
  session_id        UUID NOT NULL,
  source_video_id   INTEGER,
  surface           TEXT NOT NULL,
  recommended_ids   INTEGER[] NOT NULL,
  content_scores    FLOAT[] NOT NULL,
  blended_scores    FLOAT[] NOT NULL,
  model_version     TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rec_impressions_session
  ON recommendation_impressions(session_id);
CREATE INDEX IF NOT EXISTS rec_impressions_created
  ON recommendation_impressions(created_at);
```

- Logged on every recommendation response (server-side, no client instrumentation needed)
- `surface`: `"video-page"` (FPMC) or `"home"` / `"component"` (Two-Tower)
- Click-through is inferred by joining with `watch_events` — if a session watches a recommended video within the same session, that's a click-through

### Comparison export

- SQL queries or a simple script to compute:
  - Click-through rate (CTR) by surface and model version
  - Position-weighted CTR (clicks on rank-1 vs rank-5)
  - Comparison: CTR of blended vs what CTR would have been if ranked by `contentScore`
- No full A/B testing framework — manual analysis via SQL export

## Constraints

- No randomized A/B split in this ticket — all users see the blended ranking
- Comparison is observational: "what would the baseline have shown?" computed from logged `contentScore` rankings
- Impression logging must not add latency to the recommendation response (fire-and-forget insert)
- No dashboarding UI — export to CSV/JSON for analysis
- Impression data retention: 90 days rolling, then archive or delete

## Verification

1. Recommendation API response includes both `contentScore` and `blendedScore` for each result
2. `recommendation_impressions` table populates on every recommendation request
3. Click-through join query: `SELECT ... FROM recommendation_impressions ri JOIN watch_events we ON we.session_id = ri.session_id AND we.video_id = ANY(ri.recommended_ids)` returns matches
4. Comparison query shows whether blended ranking produces higher CTR than content-only ranking would have
5. Impression logging adds <5ms to recommendation response time
