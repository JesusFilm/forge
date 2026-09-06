---
id: "feat-448"
title: "Learned sequential profile and item representations"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: ""
duration: 12
depends_on:
  - "feat-369"
  - "feat-376"
  - "feat-378"
  - "feat-383"
  - "feat-387"
  - "feat-394"
blocks:
  - "feat-396"
tags:
  - "admin"
  - "recommendations"
  - "profiles"
  - "embeddings"
  - "machine-learning"
  - "candidates"
  - "pgvector"
---

## Problem

Semantic medoids provide an inspectable multi-interest profile baseline, but they cannot learn sequence, context, or behavioral relationships in one shared viewer–item space. Forge needs a governed successor to the cancelled `feat-092` that learns reusable profile and item representations without replacing evidence truth, consent controls, semantic fallback, or the independently observable candidate generators.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U31 contract.
2. `docs/roadmap/content-discovery/feat-092-two-tower-neural-recommendations.md` — cancelled historical proposal; use only as negative context.
3. `docs/roadmap/content-discovery/feat-369-recommendation-playback-episodes-active-playback.md`
4. `docs/roadmap/content-discovery/feat-378-consent-aware-recommendation-profile.md`
5. `docs/roadmap/content-discovery/feat-387-profile-conditioned-directional-cowatch.md`
6. `apps/admin/src/services/scene-recommendations-retriever.ts` — current pgvector semantic retrieval and fallback baseline.
7. `apps/admin/prisma/schema.prisma` — current Admin-owned data and pgvector authority.
8. `apps/admin/src/workflows/` — durable workflow patterns for projection publication.
9. `apps/admin/src/app/dashboard/search/[requestId]/page.tsx` — current trace-inspection pattern.

## Grep These

- `profile interest|medoid|centroid|session intent`
- `RecommendationProjectionVersion|privacyGeneration|watermark`
- `co-watch|lift|confidence`
- `embedding|pgvector|ANN|nearest neighbor`
- `training snapshot|artifact|model registry`

## What To Build

- Record a data-volume and evidence-readiness decision before selecting a training stack. The semantic-medoid profile remains the production baseline until the learned representation clears its gates.
- Build point-in-time training examples from source-neutral, consent- and integrity-eligible qualified sequences. Discovery source remains provenance and a possible feature; it cannot decide whether an otherwise equivalent outcome may influence the profile.
- Train a profile encoder from qualified viewing sequence, completions, explicit title feedback, recent session context, existing medoid interests, eligible search intent, language, device/surface context, and bounded recency. Keep durable and session representations separately identifiable.
- Train an item encoder from canonical identity, transcript, title/description, themes, series/course/format, language, duration, and the versioned directional co-watch features from `feat-387`; reserve versioned extension points for future visual and audio representations.
- Publish immutable, versioned profile and item embedding generations with training snapshot, feature schema, code/model digest, evidence watermark, integrity policy, consent generation, privacy generation, and expiry/staleness policy.
- Retrieve bounded profile-to-item ANN candidates behind the common generator seam. Keep semantic medoid candidates as control/fallback and retain all generator provenance through union, ranking, and composition.
- Use durable batch publication plus a bounded, separately versioned near-session update. Serving reads only complete published generations and never raw history or partial model state.
- Run the representation and ANN generator in shadow first; create a later controlled-exposure change only after its exact terminal decision is `promote-to-experiment`.

## Admin Evidence Gate

- Show readiness/data sufficiency, snapshot and feature lineage, sequence coverage, cold-start coverage, embedding drift, neighbor quality, semantic-medoid overlap, novelty, diversity, latency, staleness, publication fencing, fallback use, deletion propagation, and the terminal shadow decision.
- Compare profile/item ANN candidates with semantic medoids, directional co-watch, and the deterministic ranker without exposing raw histories, profile IDs, sequence examples, small-cohort membership, or vectors.
- Show exact source watermarks and privacy generations for every published artifact and prove a withdrawn/deleted contribution cannot reappear after rebuild or restore.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Admin owns training, publication, retrieval, evaluation, and artifact lifecycle; Watch receives only ordinary versioned recommendation results.
- The model is a projection of recommendation-owned eligible evidence, not a replacement authority for playback outcomes, consent, integrity, explicit feedback, co-watch truth, or catalog metadata.
- Raw vectors, profile identifiers, histories, sequences, and training examples never enter browser responses, request traces, logs, or general telemetry.
- Missing, stale, sparse, failed, withdrawn, or deleted learned state falls back to semantic medoids within the existing complete-service deadline.
- Publication is atomic, replayable, deletion-aware, and fenced by privacy/integrity generations; stale workers cannot reactivate influence.
- The ticket may conclude `not-ready` or `inconclusive` when data volume, coverage, privacy, quality, or latency is insufficient. Do not manufacture a live model to complete the ticket.
- Postgres/pgvector remains the initial serving authority unless measured capacity evidence justifies a separately reviewed index.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.

## Verification

- Test point-in-time sequence construction, source-neutral eligibility, consent and integrity exclusion, explicit-feedback semantics, language/context boundaries, cold start, and stale/missing optional inputs.
- Test deterministic snapshot reproduction, artifact digest/version compatibility, atomic publication, stale-worker fencing, replay, rollback, withdrawal, deletion, restore, and rebuild equivalence.
- Test ANN recall/coverage, semantic-medoid fallback, candidate provenance, duplicate suppression, playability/locale eligibility, sparse profiles, bounded session updates, and complete-service latency.
- Run offline representation and retrieval evaluation by cohort and outcome without using the same future outcome as both feature and label.
- Reconcile one profile/item generation, its ANN candidate run, fallback behavior, and a deletion rebuild in Admin.
- Run affected Admin tests, lint, and typecheck plus real-Postgres/pgvector integration and capacity checks.
- Run `pnpm --filter roadmap generate:readme` and `pnpm --filter roadmap lint` after updating roadmap metadata.
