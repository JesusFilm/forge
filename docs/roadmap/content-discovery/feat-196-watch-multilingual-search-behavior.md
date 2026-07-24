---
id: "feat-196"
title: "Watch multilingual search behavior"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-06-22"
duration: 5
depends_on: []
blocks:
  - "feat-308"
tags:
  - "admin"
  - "watch"
  - "search"
  - "multilingual"
  - "i18n"
  - "launch-readiness"
---

## Problem

Watch search currently filters by the active site language. That makes a query
in another language, such as Russian typed while the site is in English, fail
silently or return poor results even when matching content exists in the
queried language.

The search experience should detect likely query language and give users a
useful path instead of a dead end.

Roadmap window: next week, June 22-26, 2026.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-193-watch-search-readiness-eval-suite.md`
   - multilingual eval coverage that should verify this behavior.
2. `docs/roadmap/content-discovery/feat-191-continue-multilingual-embedding-repair-and-backfill.md`
   - current multilingual embedding repair context.
3. `docs/roadmap/topic-experiences/feat-107-watch-language-switch-pending-feedback.md`
   - Watch language switch feedback context.
4. `docs/roadmap/platform/feat-169-watch-language-picker-search-ranking.md`
   - Watch language picker search ranking context.
5. `apps/admin/src/services/search-eval-locale-profiles.ts`
   - locale profile/eval support.
6. `apps/admin/src/services/hybrid-search.service.ts`
   - search language/filter behavior.
7. `apps/admin/src/services/search-trace-query-classifier.ts`
   - existing query classification patterns that may be reusable.

## What To Build

1. Detect the likely language of the user's query.
2. Compare detected query language with the active site language.
3. When they differ, choose and implement the product behavior:
   - show matching-language results;
   - suggest switching language;
   - expose a language selector in the search experience.
4. Improve no-result states so users are told when results may exist in another
   language.
5. Add multilingual query cases to the Watch search readiness eval suite.

## Acceptance Criteria

- Detect likely query language.
- If query language differs from current site language, show
  matching-language results, suggest switching language, or expose a language
  selector.
- No-result states explain when results may exist in another language.
- Multilingual behavior is covered in the search eval suite.

## Verification

- A Russian query on an English page no longer fails silently when Russian
  content exists.
- The selected behavior is covered by focused service/UI tests where the
  affected code lives.
- The Mastra eval report includes multilingual cases before and after the
  change.
