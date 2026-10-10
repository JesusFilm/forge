---
id: "feat-420"
title: "Recover Watch suggestions after Backspace-shortened queries"
owner: "vlad"
priority: "P1"
status: "complete"
completed_date: "2026-08-23"
start_date: "2026-08-23"
duration: 1
depends_on:
  - "feat-337"
tags:
  - "web"
  - "watch"
  - "search"
---

## Problem

On `/watch`, after suggestions display for a multi-word query ("Jesus for
kids"), Backspacing word-by-word to a shorter valid query ("Jesus") leaves the
suggestion panel permanently blank, while typing the same short query directly
works. The trigger is bidirectional: any normalization-neutral keystroke —
deleting **or adding** a trailing space — blanked the panel, so forward-typing
reports of the same blank state ("Jesus" → "Jesus ", pause) are this bug, not
a new one.

Root cause: `handleInputChange` unconditionally bumped the stale-response
generation ref and cleared the committed result on every keystroke, while the
debounced fetch effect is keyed on the normalized query (NFC + trim +
200-code-point cap). A keystroke that changes the raw input but not the
normalized query invalidated the pending timer or in-flight fetch without
re-running the effect, so no fetch was ever rescheduled. Every word-by-word
Backspace path crosses a trailing-space state (`"Jesus "` → `"Jesus"`).

## Entry Points — Read These First

1. `apps/web/src/components/SearchOverlay.tsx` — `handleInputChange` (the
   now-conditional `invalidateSuggestionRequest()` call), the debounced fetch
   effect keyed on `normalizedSuggestionQuery`/`suggestionRequestKey`, and
   `suggestionGenerationRef`.
2. `apps/web/src/lib/watch-search-query.ts` — `normalizeWatchSearchQuery`
   (NFC + trim + `MAX_WATCH_SEARCH_QUERY_CODE_POINTS` cap), the identity the
   guard compares.
3. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` —
   Backspace-shorten, trailing-space, normalization-cap, and in-flight
   interleaving regression tests.

## Grep These

```bash
rg -n "invalidateSuggestionRequest|suggestionGenerationRef" apps/web/src/components/SearchOverlay.tsx
rg -n "normalizeWatchSearchQuery" apps/web/src
rg -n "Backspace|trailing space" apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx
```

## What To Build

In `handleInputChange`, invalidate the suggestion request only when the
incoming value's normalized form differs from the current normalized
suggestion query. Panel visibility, suppression clearing, and the query update
stay unconditional. The stale-guard architecture (generation ref
capture-and-compare, request-key commit check, layout-effect bump, all
non-keystroke invalidation call sites) stays untouched.

## Constraints

- No admin/server suggestion service changes, no GraphQL or schema changes.
- Direct typing, ranking, exact `languageIdentity`, and the feat-412
  dropped-token recall are unchanged.
- Stale-response protection holds: a response for a superseded normalized
  query or language never displays.

## Verification

```bash
pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

Browser: type "Jesus for kids" on /watch, wait for suggestions, Backspace to
"Jesus" — suggestions repopulate after the debounce.
