---
date: 2026-04-12
topic: user-feedback-driven-recommendations
---

# User-Feedback-Driven Video Recommendations

## Problem Frame

JesusFilm's current recommendation system returns identical results for every user watching the same video — pure cosine similarity over scene embeddings. There is no learning from user behavior. A first-time visitor and a returning user who has watched 50 videos see the same "recommended" list.

The platform has no login system, so all personalization must work with anonymous session-based tracking. Users arrive from diverse geographies, devices, and languages. The system needs to learn from collective behavior (what do users actually watch next?) and individual session context (what has this user been watching?) to progressively improve recommendations.

This is the Phase 2 work deferred in R4b of the [Video Content Vectorization brainstorm](2026-04-02-video-content-vectorization-requirements.md).

## Requirements

### Foundation: Interaction Data Collection

- R1. **Watch event tracking**: Record user-video interactions in a `watch_events` table. Each event captures: session ID (cookie-based), video ID, watch duration, total video duration, and timestamp. Context signals captured at event time: geo country/region (from request headers), device type, browser language, and referrer type (direct/search/social/internal).
- R2. **Engagement threshold (detractor filtering)**: Only count a watch event as a positive signal if the user watched beyond a configurable minimum completion threshold (e.g., 30% of video duration). Events below this threshold are stored but flagged as bounces and excluded from recommendation training data.
- R3. **Session identity**: Sessions use a first-party UUID cookie set on first visit. No login required. The cookie persists across visits until cleared by the user. A session groups interactions within a single visit (expires after configurable inactivity window, e.g., 30 minutes), but the cookie ID links sessions from the same browser over time, enabling cross-visit learning in the co-occurrence and transition data.

### Surface 1: Video Page — "Watch Next" (FPMC)

- R4. **Factorized Personalized Markov Chains (FPMC)**: On single video pages, after the user has watched a video, use FPMC to predict the most likely next video. FPMC combines two signals:
  - **Global transition patterns**: "From video A, most users go to video B" (the Markov chain component).
  - **Session preference patterns**: "This session has been watching contemplative content" (the matrix factorization component).
- R5. **Blend with content similarity**: FPMC scores are blended with existing cosine similarity scores. The blend weight shifts over time as transition data accumulates: start at 90% content / 10% FPMC, progressively shift toward 50/50 as confidence in transition data grows. The blend weight is a function of how many transition observations exist for the source video.
- R6. **Fallback**: When a video has insufficient transition data (below a configurable minimum observation count), fall back to pure content similarity (the current system). Degradation must be invisible to the user.

### Surface 2: Home Page & Recommendation Components — Two-Tower Neural

- R7. **Two-Tower architecture**: For the home page and recommendation components embedded in other pages, use a Two-Tower neural model:
  - **Item tower (frozen)**: Project existing 1536-dim scene embeddings down to 256-dim via a learned linear projection. Pre-computed and stored in pgvector.
  - **User tower (learned)**: Takes the session's watch history (mean-pooled item embeddings) plus context features (geo, device, language) and produces a 256-dim user embedding via an MLP.
  - Recommendation score = dot product of user embedding and item embedding.
- R8. **Cold start (no session cookie)**: When no session data exists, the user tower uses only context features — geo region, device type, browser language, time of day — to produce a user embedding. The model learns regional and device-based viewing tendencies during training (e.g., "mobile users in Latin America who speak Spanish tend to watch X"). This produces a broad, diverse set of recommendations to start the user's journey.
- R9. **Warm session personalization**: As the session accumulates watch events (2+ videos), the user tower incorporates the mean-pooled embeddings of watched videos alongside context features. Recommendations become progressively more personalized within the session.

### Training & Serving Infrastructure

- R10. **Training pipeline**: An offline Python training job (PyTorch) that reads from the `watch_events` table, trains both the FPMC model and the Two-Tower user tower, and exports:
  - FPMC transition factors to PostgreSQL tables.
  - User tower model to ONNX format for Node.js serving.
  - Pre-computed item tower projections (256-dim) stored in pgvector.
- R11. **Serving in Node.js**: The user tower ONNX model runs in the Strapi/CMS process via `onnxruntime-node`. At request time: compute user embedding (~1ms forward pass), query pgvector for nearest item embeddings. No separate Python service in production.
- R12. **Retraining cadence**: The training pipeline runs on a configurable schedule (initially weekly, increase frequency as data volume grows). Each training run produces a versioned model artifact. Rollback is a config change pointing to a previous artifact version.

### Progressive Rollout

- R13. **Data-first rollout**: The system collects watch events from day one but does not change recommendation behavior until sufficient data exists. Minimum thresholds before activating each model:
  - FPMC: Activate per-video when that video has N+ observed transitions (configurable, start at 20).
  - Two-Tower: Activate when total sessions with 2+ videos exceed a global threshold (target: 50K sessions).
- R14. **A/B comparison**: The recommendation API returns both the content-similarity score and the model-blended score in its response. This enables comparison logging and future A/B testing without requiring a separate experimentation framework.

## Success Criteria

- Two users watching the same video see different "Watch Next" recommendations based on their session history.
- A returning user (same session cookie) sees recommendations that reflect their accumulated viewing patterns.
- A brand new user with no cookie sees recommendations influenced by their geo/device/language context, not identical to every other new user.
- Recommendation quality (measured by click-through rate on recommended videos) improves as watch event volume grows.
- The system degrades gracefully: when model data is insufficient, users see pure content-similarity recommendations (current behavior) with no visible difference.

## Scope Boundaries

- **No login system.** All personalization is session/cookie-based. Persistent user accounts are out of scope.
- **No explicit feedback UI.** No like/dislike/rating buttons in this scope. All signals are implicit (watch duration, completion, navigation patterns).
- **No real-time model updates.** Models are trained offline on a schedule, not updated per-event.
- **No A/B testing framework.** Comparison data is logged for manual analysis. A proper experimentation platform is future work.
- **Phase 1 languages only.** Recommendations operate within the existing Phase 1 locale scope (English, Spanish, French).
- **Web app first.** Instrument `apps/web` for watch event collection. Mobile (`apps/mobile-v2`) instrumentation is a follow-up.

## Key Decisions

- **FPMC for video page, Two-Tower for home/recs**: Sequential "watch next" prediction is a different problem from "personalized discovery." FPMC is purpose-built for the former (combines transition probabilities with personal preferences). Two-Tower is better for the latter (holistic session understanding + cold start from context features).
- **Session-based, not user-based**: No login system exists. Session cookies provide sufficient signal for both FPMC (session transitions feed global patterns) and Two-Tower (session history feeds the user tower). Cross-session learning happens through aggregated co-occurrence, not persistent user profiles.
- **Frozen item tower**: Existing scene embeddings from `text-embedding-3-small` are high-quality content representations. Learning item embeddings from scratch requires massive interaction data. Freezing the item tower and only learning the user tower is practical with 50K+ sessions.
- **ONNX serving in Node.js**: Keeps the serving stack unified (Strapi/Node.js). Avoids deploying a separate Python inference service. The user tower is small enough (<10MB) for `onnxruntime-node`.
- **Progressive activation, not big-bang launch**: Each video and the global model activate independently when their data thresholds are met. No "launch day" — recommendations get better continuously.

## Dependencies / Assumptions

- Scene embeddings (1536-dim) are already indexed in pgvector for ~50K videos (Phase 1 complete).
- The existing `recommender.ts` cosine similarity API continues to work as the candidate generator and fallback.
- Railway PostgreSQL supports the required table additions (`watch_events`, FPMC factor tables, 256-dim learned embedding column).
- `onnxruntime-node` is compatible with the Strapi/Node.js runtime on Railway.
- First-party UUID cookie for session tracking. GDPR consent banner may be needed for EU users — deferred to planning for legal review.

## Outstanding Questions

### Resolve Before Planning

(None — all blocking questions resolved.)

### Deferred to Planning

- [Affects R2][Needs research] What completion threshold best separates genuine engagement from bounces? Start at 30% and tune based on data distribution.
- [Affects R10][Technical] Should the training pipeline run as a Railway cron job, a GitHub Action, or a dedicated Railway service? Depends on training duration and resource requirements.
- [Affects R11][Needs research] Verify `onnxruntime-node` memory footprint and cold-start latency on Railway. If problematic, evaluate alternatives (TensorFlow.js, pre-computed user cluster embeddings).
- [Affects R7][Technical] Exact dimensionality for the shared embedding space (256 proposed). Should be validated during model experimentation.
- [Affects R4][Needs research] FPMC implementation: use RecBole's implementation for experimentation, then decide whether to port to custom PyTorch or keep RecBole in the training pipeline.
- [Affects R5][Technical] How to compute blend weight as a function of observation count. Linear ramp? Sigmoid? Needs tuning with real data.
- [Affects R8][Technical] Which geo/device/language features to encode and their cardinality. Depends on actual traffic distribution.

## Relationship to Existing Roadmap

This brainstorm supersedes the deferred R4b ("User-driven scoring") from the [Video Content Vectorization requirements](2026-04-02-video-content-vectorization-requirements.md). It also provides the data collection foundation that feat-063 ("Personalize Discovery Experiences", owner: tataihono) and feat-064 ("Optimize Through Data-Driven Insights") depend on.

Proposed new roadmap tickets (content-discovery lane, owner: nisal):

_Updated 2026-04-13: IDs renumbered from the original feat-084–088 because those IDs were taken by unrelated Manager/Platform tickets between when this brainstorm was written and when the roadmap work started. feat-086 is also already taken by "Search Extension — Experience Embeddings & Indexing." Next free block is feat-090 onward._

| ID       | Title                                     | Depends On         | Priority |
| -------- | ----------------------------------------- | ------------------ | -------- |
| feat-090 | Watch Event Collection & Session Tracking | feat-046           | P1       |
| feat-091 | FPMC Video Page Recommendations           | feat-090           | P1       |
| feat-092 | Two-Tower Neural Recommendation Model     | feat-090           | P1       |
| feat-093 | Cold Start Context-Based Recommendations  | feat-092           | P2       |
| feat-094 | Recommendation A/B Comparison Logging     | feat-091, feat-092 | P2       |

## Next Steps

Resolve the cookie/consent question (above), then:

→ `/ce:plan` for structured implementation planning

---

## Roadmap Ticket Generation Prompt

Use the following prompt with `/ce:plan` or manually to generate the roadmap tickets in `docs/roadmap/content-discovery/`:

```
Generate roadmap tickets for user-feedback-driven recommendations based on
docs/brainstorms/2026-04-12-user-feedback-driven-recommendations-requirements.md.

Create these tickets in docs/roadmap/content-discovery/:

1. feat-090-watch-event-collection.md
   - owner: nisal, priority: P1, status: not-started
   - start_date: 2026-04-21, duration: 10
   - depends_on: [feat-046]
   - blocks: [feat-091, feat-092]
   - tags: [cms, web, infrastructure, personalization]
   - Scope: watch_events table in CMS PostgreSQL, session cookie middleware
     in apps/web, event emission from video player (view, progress, complete),
     detractor threshold filtering, geo/device/language context capture.

2. feat-091-fpmc-video-page-recommendations.md
   - owner: nisal, priority: P1, status: not-started
   - start_date: 2026-05-01, duration: 14
   - depends_on: [feat-090]
   - blocks: [feat-094]
   - tags: [cms, web, ai-pipeline, personalization]
   - Scope: FPMC model training pipeline (Python/PyTorch/RecBole), transition
     factor storage in PostgreSQL, blend logic in recommender.ts (cosine +
     FPMC weighted by observation count), progressive per-video activation.

3. feat-092-two-tower-neural-recommendations.md
   - owner: nisal, priority: P1, status: not-started
   - start_date: 2026-05-15, duration: 21
   - depends_on: [feat-090]
   - blocks: [feat-093, feat-094]
   - tags: [cms, web, ai-pipeline, personalization, pgvector]
   - Scope: Two-Tower model (frozen item tower from scene embeddings, learned
     user tower from session sequences + context), PyTorch training pipeline,
     ONNX export, onnxruntime-node serving in Strapi, 256-dim learned item
     embeddings in pgvector, home page and recommendation component integration.

4. feat-093-cold-start-context-recommendations.md
   - owner: nisal, priority: P2, status: not-started
   - start_date: 2026-06-05, duration: 7
   - depends_on: [feat-092]
   - tags: [web, personalization]
   - Scope: Context-only user tower inference for sessions with no cookie.
     Geo region, device type, browser language, time of day as input features.
     Broad diverse video spread as output. Graceful fallback to popular/trending.

5. feat-094-recommendation-ab-comparison-logging.md
   - owner: nisal, priority: P2, status: not-started
   - start_date: 2026-06-12, duration: 7
   - depends_on: [feat-091, feat-092]
   - tags: [cms, web, infrastructure, personalization]
   - Scope: Dual-score response from recommendation API (content-similarity
     score + model-blended score). Impression logging (which recommendations
     were shown, which were clicked). Comparison dashboard or export for
     manual analysis.

Also update:
- feat-063: add depends_on feat-090 (watch events are prerequisite for personalization)
- docs/roadmap/README.md: regenerate via apps/roadmap/scripts/generate-roadmap-readme.js

Ensure bidirectional dependency linking (depends_on ↔ blocks).
```
