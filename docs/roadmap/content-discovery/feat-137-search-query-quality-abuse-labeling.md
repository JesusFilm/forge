---
id: "feat-137"
title: "Search query quality and abuse labeling"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-25"
duration: 3
depends_on:
  - "feat-136"
blocks:
  - "feat-138"
  - "feat-143"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
  - "safety"
---

## Historical Note

This completed ticket references legacy Admin search-eval harness paths that
were removed by `feat-155`. Use `apps/admin/src/services/search-trace-query-classifier.ts`
and the Mastra search-eval workflows for current work.

## Problem

Production search traces will include useful viewer intent, but they will also
include low-quality, navigational, spammy, adversarial, or abusive queries.
Mastra eval generation should not blindly sample every trace as if it were a
good candidate.

Admin needs transparent first-pass quality and abuse labels, and Mastra may use
optional LLM classification only for ambiguous or high-impact samples.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - rules-first plus optional LLM classification decision.
2. `docs/roadmap/content-discovery/feat-136-admin-search-trace-storage-retention.md`
   - trace table and retention contract this ticket builds on.
3. `apps/admin/src/app/api/search/route.ts`
   - REST search validation and query bounds.
4. `apps/admin/src/graphql/queries/hybrid-search.ts`
   - GraphQL search validation and query bounds.
5. `apps/admin/src/services/hybrid-search.service.ts`
   - shared place to attach product-level labels to search outcomes.
6. `apps/admin/src/services/search-trace-query-classifier.ts`
   - optional offline query classification client.
7. `apps/mastra/src/services/eval-query-generator.ts`
   - current eval query generation client style.
8. `apps/admin/prisma/schema.prisma`
   - trace label storage and indexes.

## Grep These

```
rg -n "q \\(search query\\)|query.length|trim\\(\\)|search trace|SearchTrace" apps/admin/src
rg -n "OpenRouter|classification|schema validation" apps/admin/src/services/search-trace-query-classifier.ts apps/mastra/src/services/eval-query-generator.ts
rg -n "spam|abuse|prompt|injection|moderation|quality" apps/admin/src docs/roadmap docs/brainstorms
```

## What To Build

1. Add deterministic rule-based labels for search traces, such as valid viewer
   intent, empty/too-short, navigational, catalog lookup, malformed, repeated
   spam, abusive, prompt-injection-like, and unknown.
2. Store label source, label version, and label timestamp with each trace so
   later eval sampling can explain why a trace was included or excluded.
3. Add optional LLM classification for ambiguous or high-impact samples only.
   The LLM classifier must write a separate label source and keep sanitized
   prompts/results.
4. Add sampling filters that let Mastra request valid candidate traces while
   excluding obvious bad-actor or low-signal traces.
5. Add tests that lock the rules-first behavior before any LLM classifier is
   called.

## Constraints

- Rules must run first and be understandable without an LLM.
- LLM classification is optional, bounded, and only for ambiguous or
  high-impact samples.
- Do not retain raw per-query traces longer than 30 days.
- Do not store LLM prompts that include tokens, cookies, IP addresses, or full
  user identifiers.
- Do not use quality labels to censor live search results in this ticket.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Labeling should operate on Admin/Core-owned traces and content
  references.
- Do not place Mastra in the live search request path.

## Verification

- New traces receive deterministic quality/abuse labels without calling an LLM.
- Ambiguous/high-impact samples can be queued or classified by an optional LLM
  path with safe logging and bounded output.
- Sampling filters can select valid viewer-intent traces and exclude detractor
  or bad-actor queries.
- Raw trace retention behavior from `feat-136` still deletes per-query data
  after 30 days.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/admin test -- hybrid-search.service.test.ts app/api/search/route.test.ts graphql/queries/hybrid-search.test.ts search-eval/query-generator.test.ts
pnpm --filter @forge/admin typecheck
```
