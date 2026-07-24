---
id: "feat-308"
title: "Watch Romanian playable search inventory"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-254"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "multilingual"
  - "i18n"
  - "production-bug"
---

## Problem

Romanian Watch inventory includes a published, playable `JESUS` dub at
`/watch/jesus.html/romanian.html`, but production search returns no results for
the title variants `Isus`, `Iisus`, and `JESUS` or for the reported topic
queries `fiul risipitor`, `anxietate`, `iertare`, and `Crăciun`.

Search candidate retrieval currently requires localized metadata or transcript
evidence before target-language watchability is evaluated. A Romanian-playable
video with only English searchable evidence is therefore invisible.

## Entry Points

- `docs/plans/2026-07-24-001-fix-watch-romanian-playable-search-plan.md`
- `apps/admin/src/services/watch-search.service.ts`
- `apps/admin/src/services/hybrid-search-keyword-first-retrievers.ts`
- `apps/admin/src/services/hybrid-search-retrievers.ts`
- `apps/admin/src/services/search-watchability.ts`
- `apps/admin/src/services/watch-search.service.test.ts`

## What To Build

1. Add language-scoped Romanian lexical normalization for the title forms
   `Isus` and `Iisus` without mapping queries to catalog or video IDs.
2. Add one bounded English evidence fallback to the existing title, metadata,
   and semantic retrieval lanes.
3. Require Romanian target audio or subtitles before a fallback-only candidate
   can enter ranking.
4. Preserve existing relevance thresholds, timeouts, lane caps, visibility
   filters, ranking, evidence, pagination, and public GraphQL shape.
5. Cover all seven production queries with positive Romanian-playable fixtures
   and English-only exclusion cases.

## Constraints

- Do not mutate production catalog data.
- Do not add unbounded cross-language retrieval.
- Do not pin queries to a video ID or title record.
- Do not change Web request construction or the public GraphQL schema.
- Preserve localized Romanian recovery copy for legitimate no-result searches.

## Verification

- Focused Admin normalization and Watch search service tests.
- Admin typecheck and repository diff checks.
- Romanian Watch browser smoke covering all seven reported queries.
- Production-facing proof records direct playable Romanian result URLs and
  localized no-result recovery where no relevant Romanian-playable candidate
  exists.
