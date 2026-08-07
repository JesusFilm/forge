---
id: "feat-339"
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
`/watch/jesus.html/romanian.html`, but production search returned no results for
the title queries `Isus`, `Iisus`, and `JESUS` or for the topic queries
`fiul risipitor`, `anxietate`, `iertare`, and `Crăciun`.

The primary root cause was in the Typesense transcript projection. Localized
subtitle transcript chunks were indexed as private solely when a video lacked a
same-language published `VideoLocale`/title, even though the persisted
transcript pointed to an exact, live subtitle source for that language. This
suppressed the strongest native-language search evidence before retrieval.

A separate inventory gap remains possible: some videos are playable in the
requested language but have no localized searchable title, metadata, or
transcript evidence. Those candidates need a bounded English evidence recovery
path. Fallback evidence must remain candidate-level and may survive only when
indexed availability proves requested-target audio or subtitles before result
pagination.

## Entry Points

- Linear FGE-3 and GitHub PR #1736
- `apps/admin/src/services/typesense-watch-search-indexer.ts`
- `apps/admin/src/services/typesense-watch-search-indexer.test.ts`
- `apps/admin/src/services/typesense-watch-search.service.ts`
- `apps/admin/src/services/typesense-watch-search.service.test.ts`
- `apps/admin/src/services/watch-search-query-normalization.ts`
- `apps/admin/src/services/watch-search-query-normalization.test.ts`
- `apps/web/src/i18n/__tests__/messages-parity.test.ts`
- `apps/web/messages/ro.json`

## What To Build

1. Make an exact live subtitle source sufficient to project its same-language
   transcript chunks as public for every language, without requiring a
   same-language published `VideoLocale`/title. Keep deleted, mismatched,
   unavailable, provenance-less, and otherwise private evidence private.
2. Keep a separate bounded English evidence fallback in the Typesense title,
   metadata, and semantic lanes for non-English targets that have no localized
   searchable evidence. Preserve native-evidence priority.
3. Gate each fallback-only candidate on requested-target audio or subtitle
   availability before pagination. Fetch the full Typesense page prefix needed
   for deep offsets so ineligible English-only groups cannot consume page slots
   or hide later playable candidates.
4. Expand the Romanian title forms `Isus` and `Iisus` to the canonical `JESUS`
   title without mapping a query to a catalog or video ID.
5. Preserve existing thresholds, timeouts, candidate caps, one bounded
   cross-language fallback, and the public GraphQL shape.
6. Cover the original seven Romanian queries—`JESUS`, `Isus`, `Iisus`,
   `fiul risipitor`, `anxietate`, `iertare`, and `Crăciun`—with focused Admin
   regressions. Keep Romanian no-results and retry/recovery copy covered by the
   suite-wide catalog parity, translation, and ICU contracts.

## Constraints

- Do not mutate production catalog data.
- Do not add unbounded cross-language retrieval.
- Do not pin queries to a video ID or title record.
- Do not change Web request construction or the public GraphQL schema.
- Do not treat arbitrary transcript text or manager-selected source language as
  public subtitle provenance.

## Verification

- Focused Admin Typesense Watch search tests.
- Full Web catalog structural, translation, and ICU parity suite, which covers
  Romanian as a non-provisional locale.
- Admin and Web typecheck/lint for touched scope.
- Roadmap generation and repository diff checks.

## Completion Evidence

- Exact live subtitle provenance now grants public transcript visibility for
  every language even when the video has no same-language published
  `VideoLocale`/title; unrelated, deleted, mismatched, unavailable, and
  provenance-less transcript variants remain private.
- Bounded English evidence remains a separate candidate-level recovery path for
  non-English targets with no localized searchable evidence. Fallback-only
  candidates require requested-target audio or subtitles before pagination.
- Deep Typesense pagination now retrieves and fuses the necessary page prefix
  before applying the requested offset, preventing stronger ineligible
  English-only groups from starving later target-playable results.
- Romanian `Isus`/`Iisus` query variants expand to the canonical `JESUS` title,
  and focused regressions cover the original seven Romanian queries.
- Suite-wide catalog contracts assert Romanian no-results and retry/recovery
  messages are present, localized, and ICU-placeholder compatible with the
  English source catalog.
- Final focused-suite totals, typechecks, lint/format, roadmap drift, and diff
  gates will be recorded by the root implementation owner after validation.
