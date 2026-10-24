---
id: "feat-412"
title: "Recover Watch suggestions for near-miss multi-word queries"
owner: "vlad"
priority: "P1"
status: "complete"
completed_date: "2026-08-22"
start_date: "2026-08-22"
duration: 1
depends_on:
  - "feat-352"
blocks:
  - "feat-413"
tags:
  - "admin"
  - "watch"
  - "search"
  - "typesense"
---

## Problem

A multi-word Watch query such as "Jesus for kids" returns no suggestions even
though the catalog carries "The Story of Jesus for Children". The suggestion
candidate request uses `drop_tokens_threshold: 0`, so one unmatched token
("kids") empties Typesense recall; and even when candidates exist, phrase
extraction only anchors on the whole query as a contiguous window prefix, and
the direct-content tiers require the whole multi-word query to be a literal
title or word prefix.

## Entry Points — Read These First

1. `apps/admin/src/services/typesense-watch-search-suggestions.ts` — candidate
   request (`suggestionRequest`), phrase extraction (`phraseWindows`), direct
   match tiers (`matchTier`), and phrase validation.
2. `apps/admin/src/services/typesense-watch-search-suggestions.test.ts` —
   suggestion service scenarios including the multi-token recall cases.

## Grep These

```bash
rg -n "drop_tokens_threshold|matchTier|phraseWindows" apps/admin/src/services/typesense-watch-search-suggestions.ts
rg -n "matchesQueryTokens|MULTI_TOKEN" apps/admin/src/services
```

## What To Build

1. Relax the suggestion candidate request to `drop_tokens_threshold: 1` only
   for queries with three or more word tokens, so Typesense may drop tokens
   when the full query has zero hits. Keep phrase validation strict at 0 so a
   displayed phrase is still guaranteed to return a lexical result.
2. Add a phrase-extraction fallback: when the whole query is not a contiguous
   window prefix of a candidate text, anchor windows on words matching a
   meaningful (non-stop-word) query token and keep only windows that cover
   every query token as a word prefix, with at most one dropped token and only
   for three-plus-token queries.
3. Add a lower direct-content match tier for multi-word queries: a title
   matches when every query token prefixes some title word, allowing at most
   one dropped token for three-plus-token queries and requiring at least one
   matched non-stop-word token.

## Constraints

- Two-token and single-token queries keep strict all-token behavior — no drop.
- Never let a matched-stop-words-only overlap (for example "the … of")
  qualify a title or phrase.
- Do not change the GraphQL or Web contracts; no UI empty-state work.
- Keep ranking deterministic; the new tier sorts after the existing tiers.

## Verification

```bash
pnpm --filter @forge/admin test -- src/services/typesense-watch-search-suggestions.test.ts src/graphql/queries/watch-search.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
pnpm exec prettier --check apps/admin/src/services/typesense-watch-search-suggestions.ts apps/admin/src/services/typesense-watch-search-suggestions.test.ts docs/roadmap/content-discovery/feat-412-watch-search-suggestion-multi-token-recall.md
```
