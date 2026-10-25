---
id: "feat-194"
title: "Instagram discovery commentary exclusion filter"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-06-16"
duration: 1
depends_on:
  - "feat-175"
blocks:
  - "feat-240"
tags:
  - "mastra"
  - "instagram"
  - "ai-pipeline"
---

## Problem

The initial Instagram AI Christian discovery workflow is intentionally keyword
driven, so posts that talk about AI Christian content can pass the same
AI-generation and Christian keyword checks as actual AI-made Christian video
creations. Operators need a cheap precision improvement before the heavier
LLM relevance filter lands.

## Entry Points - Read These First

1. `apps/mastra/src/services/instagram-discovery/classifier.ts` - keyword
   signal lists and `qualifies()`.
2. `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts` -
   parse, dedupe, classify, cap, and report totals.
3. `apps/mastra/src/services/instagram-discovery/artifacts.ts` - persisted
   report schema.
4. `docs/plans/2026-06-11-002-feat-instagram-discovery-exclusion-filter-plan.md`
   - implementation plan and deferred relevance-filter boundary.

## Grep These

- `COMMENTARY_KEYWORDS` - conservative exclusion terms.
- `excludedCommentary` - report total for filtered commentary posts.
- `matchedCommentary` - classifier signal used for the exclusion decision.
- `instagram-ai-christian-discovery` - workflow id and tests.

## What To Build

- [x] Add a conservative commentary/news/tutorial keyword filter to the
      Instagram discovery classifier.
- [x] Require `!isCommentary` in `qualifies()` while preserving the existing
      AI-generation plus Christian keyword requirements.
- [x] Merge commentary matches across duplicate shortcode variants.
- [x] Add `totals.excludedCommentary` to the workflow result and persisted
      artifact schema.
- [x] Document that the LLM relevance check remains deferred follow-up work.

## Constraints

- Keep the filter deterministic and conservative; do not add model calls or new
  environment variables in this feature.
- Do not exclude broad words that collide with genuine Bible-story creations,
  such as Gospel attributions or Passion narrative terms.
- Preserve the existing bounded report schema and `maxResults` cap.

## Verification

- `pnpm --filter @forge/mastra test -- src/services/instagram-discovery/classifier.test.ts src/services/instagram-discovery/artifacts.test.ts src/mastra/workflows/instagram-ai-christian-discovery.test.ts`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`

## Plan

Implementation plan:
`docs/plans/2026-06-11-002-feat-instagram-discovery-exclusion-filter-plan.md`
