---
id: "feat-362"
title: "Watch search native-language Candidate recall"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-13"
duration: 2
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

Candidate Watch search queries all localized title fields through one Typesense
request, but Typesense parses the query with the locale of the first field.
Exact titles in other scripts can therefore be missing from retrieval even
when the correct localized title is indexed.

## Entry Points — Read These First

1. `docs/plans/2026-08-13-001-fix-candidate-native-language-query-routing-plan.md`
2. `apps/admin/src/services/typesense-watch-search-lexical.ts`
3. `apps/admin/src/services/typesense-watch-search-schema.ts`
4. `apps/admin/src/services/typesense-watch-search-indexer.ts`
5. `apps/admin/src/services/typesense-watch-search-query-plan.ts`
6. `apps/admin/src/services/typesense-watch-search.service.ts`
7. `apps/admin/src/scripts/benchmark-watch-search-candidate.ts`

## Grep These

- `candidateWatchCollectionSchemas|buildTypesenseWatchCandidateProjectionSnapshot`
- `watchLexicalManifestQueryFields|lexicalLaneRequest`
- `candidateWatchSearchApplicationRevision|evaluateCandidateQualification`

## What To Build

- Give Candidate one locale-neutral exact-title key while keeping Current and
  Candidate localized partial-title indexes unchanged.
- Keep every metadata language eligible, but order metadata tokenizer fields
  using bounded server-side language evidence.
- Preserve existing request fan-out, timeouts, result contracts, and general
  ranking behavior.
- Build and validate a fresh immutable Evaluation generation without moving the
  Serving pointer.

## Constraints

- Do not change the frontend, GraphQL contract, Current search, playback
  behavior, or public Watch traffic.
- Do not add per-language requests, script hard filters, statistical language
  models, or title-specific ranking rules.
- Candidate must match or beat Current at p50, p95, and p99 and must not regress
  request, payload, RAM, import-peak, or reliability bounds.

## Verification

- Run the focused projection, schema, query-plan, service, generation, and
  qualification tests listed in the implementation plan.
- Run Admin typecheck and lint.
- Qualify the exact Evaluation generation with the paired production-shaped
  benchmark and private Admin comparison page.

## Completion

- Candidate global exact-title recall, localized partial matching, and the
  existing title/metadata/semantic ranker were qualified and promoted through
  the guarded Serving pointer.
- Candidate result projection now keeps visible card evidence inside the
  display-or-target language boundary and falls back to localized catalog copy
  for unrelated or unknown evidence languages.
- The presentation correction adds no search request, embedding, schema field,
  index rebuild, or ranking change. Focused service tests pin mismatch,
  unknown-language, and selected-target evidence behavior alongside the
  existing Typesense request count.
