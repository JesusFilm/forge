---
id: "feat-352"
title: "Guarantee Watch query suggestion results"
owner: "urim"
priority: "P1"
status: "complete"
completed_date: "2026-08-12"
start_date: "2026-08-12"
duration: 1
depends_on:
  - "feat-337"
blocks:
  - "feat-363"
tags:
  - "admin"
  - "watch"
  - "search"
  - "typesense"
  - "reliability"
---

## Problem

Watch autocomplete extracts useful-looking query phrases from lexical title and description hits, but extraction alone does not guarantee that submitting each displayed phrase will return a lexical result in the selected Search language.

## Entry Points — Read These First

1. `docs/plans/2026-08-12-001-fix-watch-search-suggestion-result-validation-plan.md` — result guarantee, cache, deadline, and degradation decisions.
2. `apps/admin/src/services/typesense-watch-search-suggestions.ts` — phrase extraction, direct matches, request admission, and validation.
3. `apps/admin/src/services/bounded-ttl-promise-cache.ts` — bounded single-value and batched cache contracts.
4. `apps/admin/src/services/typesense-client.ts` — Typesense request and per-call timeout support.
5. `apps/admin/src/services/typesense-watch-search-suggestions.test.ts` — service result, cache, failure, and deadline scenarios.
6. `apps/admin/src/services/bounded-ttl-promise-cache.test.ts` — batch coalescing, partial misses, expiry, eviction, and failure cleanup.

## Grep These

```bash
rg -n "validateQuerySuggestions|phraseValidationRequest|WATCH_SEARCH_PHRASE_VALIDATION" apps/admin/src/services
rg -n "cachedBoundedTtlBatchValues|suggestionRequestState" apps/admin/src/services
rg -n "phrase_validation_unavailable|watchSearchSuggestions" apps/admin/src apps/web/src
```

## What To Build

1. Validate the existing maximum of six ranked phrase candidates against the same localized lexical fields and exact public language identity.
2. Batch all uncached existence checks into one Typesense multi-search request with `per_page: 1`.
3. Cache positive and negative verdicts for 60 seconds in a 512-entry, Prisma-owned process-local cache that survives per-request service construction.
4. Preserve ranked phrase order and omit phrases without a hit.
5. If validation fails, omit query phrases while preserving direct matches and explicit search submission.
6. Give validation a 750-millisecond Typesense deadline so the dependent stage remains inside Web's existing autocomplete timeout.

## Constraints

- Do not invoke full hybrid search, semantic search, transcripts, watchability, analytics, or submitted-search traces while typing.
- Do not add or change the GraphQL or Web contracts.
- Never issue sequential per-phrase network requests.

## Verification

```bash
pnpm --filter @forge/admin test -- src/services/bounded-ttl-promise-cache.test.ts src/services/typesense-watch-search-suggestions.test.ts src/services/typesense-client.test.ts src/graphql/queries/watch-search.test.ts src/graphql/public-resolvers.regression.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
pnpm exec prettier --check apps/admin/src/services/bounded-ttl-promise-cache.ts apps/admin/src/services/bounded-ttl-promise-cache.test.ts apps/admin/src/services/typesense-client.ts apps/admin/src/services/typesense-client.test.ts apps/admin/src/services/typesense-watch-search-suggestions.ts apps/admin/src/services/typesense-watch-search-suggestions.test.ts docs/plans/2026-08-12-001-fix-watch-search-suggestion-result-validation-plan.md docs/roadmap/content-discovery/feat-337-watch-search-suggestions.md docs/roadmap/content-discovery/feat-352-watch-search-suggestion-result-validation.md docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md
```

Use the local Watch modal at `http://localhost:3000/watch` with Admin and Typesense running. Verify a validated phrase appears before direct matches on desktop and narrow mobile, refocusing restores the existing panel without another browser request, and Enter/Search remains the only full-search submission path.

## Completion Evidence

- Local GraphQL returned six validated English query phrases before video and collection direct matches for `jesu`.
- The cold local request completed in 62 ms; the repeated warm-cache request completed in 32 ms and returned the same ordered six phrases.
- Browser smoke showed the six suggestions-first/direct-matches-second layout against the running Watch, Admin, and Typesense stack.
- The focused Web interaction suite passed 109 tests, including narrow-layout scrolling, refocus cache restoration, language-panel replacement, grouping, and explicit-submit behavior.
- Focused Admin validation, cache, client, resolver, typecheck, lint, and format checks passed.
