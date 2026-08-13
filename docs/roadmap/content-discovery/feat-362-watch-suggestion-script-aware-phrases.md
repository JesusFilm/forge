---
id: "feat-362"
title: "Add script-aware multilingual Watch query phrases"
owner: "urim"
priority: "P2"
status: "not-started"
duration: 2
depends_on:
  - "feat-361"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "i18n"
---

## Problem

Watch query-phrase extraction is whitespace/window based. That is independent
from multilingual direct-match recall and remains a weak fit for CJK/no-space
scripts and other locale-specific word boundaries.

## Entry Points - Read These First

1. `docs/plans/2026-08-13-1954-multilingual-watch-suggestion-recall-plan.md`
2. `apps/admin/src/services/typesense-watch-search-suggestions.ts`
3. `apps/admin/src/services/typesense-watch-search-suggestions.test.ts`

## What To Build

1. Evaluate `Intl.Segmenter` word-like segmentation against a frozen multilingual
   title/description corpus before changing visible query phrase rows.
2. Define script-aware token/window behavior, locale-scoped optional stop words,
   and a Unicode fallback for runtimes without a suitable segmenter.
3. Preserve the six-row cap, exact public-language validation, cache behavior,
   and direct-match/explicit-submit contracts.

## Verification

- CJK/no-space, RTL, diacritics, apostrophes, and hyphens have approved phrase
  snapshots and submitting every displayed phrase returns a result in the exact
  selected public language.
- Existing English phrase quality and suggestion latency do not regress.
