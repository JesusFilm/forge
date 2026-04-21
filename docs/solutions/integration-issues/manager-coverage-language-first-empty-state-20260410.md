---
title: "Manager Coverage Language-First Empty State"
category: integration-issues
date: 2026-04-10
severity: medium
tags:
  - manager
  - coverage
  - empty-state
  - query-params
  - language-selection
affected_components:
  - apps/manager/src/app/dashboard/coverage/page.tsx
  - apps/manager/src/features/coverage/LanguageGeoSelector.tsx
  - apps/manager/src/features/coverage/coverage-empty-state.tsx
  - apps/manager/src/features/coverage/coverage-report-client.tsx
  - apps/manager/src/features/coverage/language-selection.ts
related_docs:
  - docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md
  - docs/solutions/platform/restoring-upstream-ui-verbatim.md
---

# Manager Coverage Language-First Empty State

## Problem

The coverage dashboard rendered the full collection list even when no language was selected, which made the page feel broken and diluted the point of the report. After introducing preset language actions, a second regression appeared: legacy URLs using `languageIds` could override new preset clicks that wrote `languageId`.

## Root Cause

Two small mismatches compounded:

1. The page had no dedicated "choose a language first" state, so the default view looked like empty or irrelevant report data instead of an intentional entry point.
2. Coverage routing accepted both `languageId` and `languageIds`, but new navigation paths only wrote the singular key while some reads still preferred the plural key.

## Solution

### Add a real language-first entry state

Render a dedicated empty state when no language is selected:

- hide collection cards and collection filters until the user chooses a language
- offer preset shortcuts for English, French, Spanish, and Modern Standard Arabic
- keep a "Browse all languages" action that opens the existing selector instead of trapping the user in presets only
- reuse existing app palette values rather than introducing one-off colors

### Normalize coverage language query params

Move the parsing and write logic into shared helpers:

- parse incoming language ids once
- prefer `languageId` as the canonical query param
- still accept legacy `languageIds` links
- delete both keys before writing the next selection so stale params cannot win

## Prevention

1. When a report depends on required context, give it an explicit first-run state instead of rendering partial report chrome with misleading data.
2. If old and new query params must coexist temporarily, centralize parsing and normalization in one helper used by every read and write path.
3. For parity work, reuse existing palette tokens or established literal colors already present in the app unless product explicitly asks for a new color.

## Verification

- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager test -- --run src/features/coverage/language-selection.test.ts src/features/coverage/coverage-empty-state.test.ts`

## Related References

- `apps/manager/src/features/coverage/coverage-empty-state.tsx`
- `apps/manager/src/features/coverage/language-selection.ts`
- `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`
