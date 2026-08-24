---
id: "feat-413"
title: "Recover valid Watch suggestions hidden by canonical grouping"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-08-23"
duration: 1
depends_on:
  - "feat-412"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "typesense"
  - "reliability"
---

## Problem

Watch suggestion candidate recall groups Typesense hits by
`canonicalVideoId` with `group_limit: 1`. Local phrase and direct-match proof
therefore inspect only Typesense's selected representative. If that document
fails local proof while another language variant or sibling document in the
same canonical group would pass, the valid suggestion remains hidden.

## Entry Points — Read These First

1. `apps/admin/src/services/typesense-watch-search-suggestions.ts` —
   `suggestionRequest` owns canonical grouping, `directMatchCandidates` applies
   local proof, and `hydrateDirectMatches` resolves accepted candidates.
2. `apps/admin/src/services/typesense-watch-search-suggestions.test.ts` —
   grouped Typesense fixtures, language-identity filtering, direct-match
   ranking, and phrase-validation coverage.
3. `docs/roadmap/content-discovery/feat-412-watch-search-suggestion-multi-token-recall.md`
   — bounded token-recall and local-proof contracts that this follow-up must
   preserve.

## Grep These

```bash
rg -n "group_by|group_limit|grouped_hits|directMatchCandidates|hydrateDirectMatches" apps/admin/src/services/typesense-watch-search-suggestions.ts
rg -n "group_key|canonicalVideoId|languageIdentity|relaxed" apps/admin/src/services/typesense-watch-search-suggestions.test.ts
```

## What To Build

1. Recall a small bounded set of representatives per canonical group instead
   of only the first Typesense representative.
2. Apply the existing phrase and direct-match proof to those representatives,
   then retain at most one accepted direct candidate per canonical group.
3. Select the accepted representative deterministically using the existing
   match-tier and Typesense-order precedence, preserving global response caps
   and phrase-before-content ordering.
4. Add regression coverage where the first representative fails local proof
   but a later sibling in the same canonical group passes, plus coverage that
   duplicate siblings do not produce duplicate suggestions.

## Constraints

- Keep the exact `languageIdentity` request filter and existing localized-field
  boundaries unchanged.
- Do not broaden or redesign global suggestion ranking, grouping identity, or
  result caps.
- Keep the additional per-group recall explicitly bounded; do not request or
  scan every sibling document.
- Do not change GraphQL, Web, schema, generated clients, or empty-state
  behavior.
- Preserve strict phrase validation and feat-412's bounded multi-token proof.

## Verification

```bash
pnpm --filter @forge/admin test -- src/services/typesense-watch-search-suggestions.test.ts src/graphql/queries/watch-search.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
pnpm exec prettier --check apps/admin/src/services/typesense-watch-search-suggestions.ts apps/admin/src/services/typesense-watch-search-suggestions.test.ts docs/roadmap/content-discovery/feat-412-watch-search-suggestion-multi-token-recall.md docs/roadmap/content-discovery/feat-413-watch-suggestion-canonical-group-representative-recall.md
```

## Non-Goals

- Changing language identity selection or fallback semantics.
- Broadly retuning Typesense relevance, match tiers, or cross-group ranking.
