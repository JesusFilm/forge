---
id: "feat-338"
title: "Watch Search Chinese lexical identity"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-08-06"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "typesense"
  - "multilingual"
  - "i18n"
---

## Problem

Modern Watch Search detects `耶稣` as Mandarin but returns no localized title
match for the canonical JESUS film. The localized title is indexed under the
`chinese-simplified` language identity while playback targets
`mandarin-china`, so the lexical filter excludes the correct document and
semantic transcript results fill the page.

## Entry Points - Read These First

1. `apps/admin/src/services/search-language-resolution.ts`
2. `apps/admin/src/services/typesense-watch-search.service.ts`
3. `apps/admin/src/services/typesense-watch-search-lexical.ts`
4. `apps/admin/src/services/typesense-watch-search.service.test.ts`
5. `apps/admin/src/services/typesense-watch-search-lexical.test.ts`

## Grep These

- `QUERY_SCRIPT_LANGUAGE_HINTS|queryScriptLanguage` in `apps/admin/src/services`
- `lexicalLanguageSlug|lexicalLanguageIdentities` in `apps/admin/src/services`
- `mandarin-china|chinese-simplified|zh-Hans` in `apps/admin/src`

## What Changed

- Added a query-script context that keeps the inferred Mandarin playback target
  separate from the `zh` tokenizer and exact Chinese localization slugs.
- Routed Han lexical requests through `chinese-simplified` and
  `chinese-traditional` without widening the exact Typesense identity facet.
- Preserved English lexical behavior when Mandarin playback is selected.
- Added production-shaped JESUS fixtures where localized title slugs differ
  from the playable `mandarin-china` audio slug.

## Constraints

- Preserve the public GraphQL response contract and the current Web request.
- Keep exact Forge language slugs as the lexical identity boundary; do not use
  BCP-47 prefix matching as language identity.
- Keep Mandarin target-audio hydration ahead of subtitle and fallback options.
- Do not deploy or rebuild production indexes from a workstation.

## Verification

- `pnpm --filter @forge/admin test -- src/services/search-language-resolution.test.ts src/services/typesense-watch-search.service.test.ts src/services/typesense-watch-search-lexical.test.ts` — 55 tests passed.
- `pnpm --filter @forge/admin test` — 4,272 tests passed, 2 skipped, 1 todo.
- `pnpm typecheck` — 19 workspace packages passed.
- `pnpm lint` — 20 workspace packages passed.
- Focused Prettier check and `git diff --check` passed.
