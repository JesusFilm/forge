---
id: "feat-413"
title: "Rank canonical content for common English seeker phrases"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "search"
  - "typesense"
  - "ranking"
  - "evaluation"
---

## Problem

Watch search treats common seeker language as generic lexical or semantic input.
For `Jesus for kids`, the canonical playable feature film
`the-story-of-jesus-for-children` is recalled but ranks fourth behind less
specific results. The Candidate evaluation suite also lacks versioned,
case-level judgments for the common English phrases named in Linear issue
[FGE-30](https://linear.app/jesus-film-project/issue/FGE-30/p1-rank-canonical-content-for-common-english-seeker-phrases).

## Entry Points — Read These First

1. `docs/plans/2026-08-21-2253-fix-common-phrase-ranking-plan.md` — reviewed
   requirements, ranking design, rollout boundary, implementation units, and
   verification contract.
2. `apps/admin/src/services/typesense-watch-search.service.ts` — bounded
   Candidate retrieval, grouping, hydration, and ranking integration.
3. `apps/admin/src/services/typesense-watch-search-ranking.ts` — categorical
   evidence tiers and deterministic group ordering.
4. `apps/admin/src/services/typesense-watch-search-profile.ts` — Current,
   Evaluation, and Serving profile identity.
5. `apps/admin/src/scripts/benchmark-watch-search-candidate.ts` — Candidate
   benchmark execution, result projection, and report generation.
6. `apps/admin/src/scripts/watch-search-candidate-benchmark-cases.ts` — existing
   multilingual exact-title controls from FGE-14.

## Grep These

- `title-and-brand-v1`
- `candidateWatchSearchRankingRevision`
- `WatchSearchEvidenceTier`
- `rankWatchSearchGroups`
- `CandidateBenchmarkCase`
- `WATCH_SEARCH_SERVING_QRELS_REVISION`
- `1_cl-0-0`
- `the-story-of-jesus-for-children`

## What To Build

1. Add a reviewed, English-only canonical-intent catalog that maps normalized
   `Jesus for kids` and `Jesus for children` to stable canonical identity
   `core:1_cl-0-0`.
2. Add a `CANONICAL_INTENT` ranking tier in a new
   `canonical-intent-v2` implementation. Resolve aliases only against canonical
   groups already returned by the existing bounded retrieval requests; never
   classify alias evidence as exact-title proof.
3. Keep `title-and-brand-v1` executable for accepted Serving evidence and make
   the selected ranking revision part of the Candidate profile identity so
   Evaluation can run `canonical-intent-v2` without invalidating Serving.
4. Add a versioned, slug-based evaluation matrix for all FGE-30 phrases and
   report distinct case-level intent-query success separately from exact-title
   success. All attempts for a case must satisfy its judgment.
5. Preserve the physical application revision `watch-search-candidate/v2`, the
   number and bytes of Typesense retrieval requests, semantic-degradation
   behavior, FGE-14 exact-title controls, and post-merge qualification gates.

## Constraints

- One PR for FGE-30 only; do not absorb FGE-25 availability ordering, FGE-6
  no-result UX, or FGE-70 JESUS chapter discovery.
- No raw alias may enter `title_exact_keys`, `searchTitle`, visible metadata, or
  public GraphQL evidence.
- A real exact-title match always outranks canonical-intent evidence.
- Do not add Typesense subsearches, fields, schema changes, or a physical
  generation rebuild for this ranking-only change.
- Do not promote Evaluation, deploy code directly, or change production
  Serving in this PR. `canonical-intent-v2` requires fresh reviewed
  qualification after merge.

## Verification

- Focused catalog, ranker, profile, service, benchmark, and qualification tests
  cover aliases, collisions, exact-title precedence, semantic degradation,
  per-case judgments, and dual-revision Serving safety.
- Candidate service tests prove `the-story-of-jesus-for-children` ranks first
  for both reviewed phrases with English target audio and `FEATURE_FILM`.
- Snapshot or request-shape tests prove Typesense multi-search count and request
  bytes are unchanged.
- Run Admin format, typecheck, lint, focused/full tests, benchmark identity and
  capacity gates, and SSR/hydration/media checks where applicable. This PR has
  no frontend render-path changes, so page-loading browser performance checks
  are expected to be not applicable.
- Capture read-only production API evidence for all versioned phrases and record
  that live Candidate comparison remains a post-merge Evaluation prerequisite.
