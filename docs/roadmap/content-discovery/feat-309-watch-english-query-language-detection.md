---
id: "feat-309"
title: "Watch English query language detection"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "multilingual"
  - "accessibility"
---

## Problem

Linear FGE-4 reproduces false blocking language confirmations for ordinary
English Watch searches. With English selected, `prodigal son` is identified as
Estonian and `resur` as French. Because search dispatch pauses for the
confirmation, the prior query's cards and result-state semantics remain visible
and appear to belong to the current input.

## Scope

- Treat short, unaccented Latin-script TinyLD mismatches as ambiguous when
  English is selected, while preserving explicit script hints, Unicode Latin
  diacritics, longer multilingual input, and non-English selected languages.
- Cover `prodigal son`, `resur`, and the complete common-English religious-query
  corpus from the implementation plan with deterministic and real TinyLD tests.
- While a genuine language confirmation is pending, expose its localized
  content as a polite status and suppress prior cards, pagination, loading,
  error, and no-results presentation.
- Preserve confirmation and manual search-language selection behavior.

## Boundaries

- FGE-22 owns generic query-state invalidation, late responses, pagination
  races, and search analytics attribution.
- FGE-23 owns broad Latin-script calibration, production acceptance matrices,
  and detector metrics.
- FGE-1 owns Spanish regional-variant identity. This change remains
  independently mergeable and does not implement same-primary variant rules.
- No Admin, GraphQL, ranking, embedding, or generated-type changes.

## Entry Points

- `docs/plans/2026-07-24-001-fix-watch-english-language-detection-plan.md`
- `apps/web/src/lib/search-query-language.ts`
- `apps/web/src/lib/search-query-language.test.ts`
- `apps/web/src/lib/search-query-language.tinyld.test.ts`
- `apps/web/src/components/SearchOverlay.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

## Verification

- Focused detector and rendered overlay regression suites.
- Web typecheck, lint, formatting, and `git diff --check`.
- Local browser smoke of `Bible Project` → `prodigal son`, `resur`, and a
  genuine multilingual confirmation after completed results.

## Completion Evidence

- Added a selected-English prior before TinyLD for ambiguous unaccented Latin
  queries, with named four-token and 20-letter boundaries. Explicit script
  hints, Unicode Latin diacritics, longer queries, and non-English selected
  languages retain their established detection paths.
- Added deterministic and real TinyLD coverage for the complete FGE-4 corpus,
  including `prodigal son` and `resur`, plus positive multilingual and Unicode
  cases.
- The existing confirmation is now a polite status and exclusively owns the
  pending presentation state. Rendered tests prove prior cards, pagination,
  loading, error, and no-results states are hidden while it is open, and that
  both acceptance and manual language selection retain their search behavior.
- The integrated focused suite passes 129 tests; Web typecheck, focused lint,
  formatting, and `git diff --check` pass. The full Web suite passed 2,437
  tests; its one persisted-localStorage failure passed independently with a
  fresh task-scoped store.
- Production browser verification reproduced the original `Bible Project` →
  `prodigal son` and `resur` stale-card confirmations. Local server startup was
  denied by the managed execution policy, so the fixed presentation lifecycle
  is evidenced by the rendered overlay suite rather than a local browser
  screenshot.
