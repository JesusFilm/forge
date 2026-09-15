---
title: "Remove repeated work from contextual recommendation recovery"
date: "2026-09-15"
status: "in-progress"
ticket: "feat-496"
---

## Scope

Fix the legacy contextual recovery request that continues past Web's existing
6.5-second deadline. Preserve public GraphQL/REST shapes, every seed embedding,
per-seed candidate limits, exact cosine scores, visibility/playability filters,
family exclusions and shared identity deduplication. Keep the homepage block
removed and its launch gate off. Deploy through normal PR-to-main only.

## Evidence

Production trace `6aa884cf000000001196f4c3ad9f3914` shows primary semantic
retrieval failing, followed by `ContextualSceneRecommendations` running 34 raw
queries for 8.2 seconds. Web aborts after 6.5 seconds; database work continues.
An earlier condensed trace omitted these descendants; absence from that view
was not evidence that GraphQL or SQL never started.

On the local catalog, Augustine has 35 seed chunks. The compatibility service
takes 32.5 seconds and 37 database calls. EXPLAIN shows the playable-dub lateral
lookup repeatedly scanning languages for every candidate chunk. A combined
query without materializing parsed seed vectors still takes 30.6 seconds,
because PostgreSQL reparses the vector text for each comparison. Disabling JIT
does not fix the baseline.

## Implementation and verification

1. Materialize preferred playable dubs by edition, eligible candidate chunks,
   and parsed seed vectors once in a combined query. Preserve each seed's
   best-per-video limit, then select the highest-scoring occurrence per video.
   Transfer metadata and vector text only for surviving candidates.
2. Use the combined retrieval for multi-chunk seeds. Retain single-chunk
   behavior and the final shared deduplicator. Do not sample away film chapters
   or switch to approximate retrieval to obtain this speedup.
3. Compare final results against the original query loop on a real catalog,
   including long and short videos and multiple locales. Use isolated SQL
   fixtures for publication, deleted rows, family exclusions, playback choice,
   contract provenance, duplicate identities and best-scene selection.
4. Run scoped and full Admin tests, real-Postgres regressions, types, lint,
   formatting and a production build. Verify Web's recovery caller locally.
5. Review and compound; merge after CI, verify deployment and fixed production
   windows. Continue examining primary delivery failures if they persist.
