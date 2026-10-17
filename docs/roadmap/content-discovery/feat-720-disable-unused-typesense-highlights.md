---
id: "feat-720"
title: "Disable unused Typesense search highlights"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "search"
  - "typesense"
  - "multilingual"
  - "observability"
---

## Problem

Production `@forge/admin/search` runs Typesense 30.2 and repeatedly logs errors
from `Collection::highlight_text` while generating default snippets for Turkish
Unicode text. Forge search consumers use document fields and ranking metadata,
not Typesense's `highlights` response. Leaving implicit highlighting enabled
therefore exercises a faulty upstream path, wastes work, and creates false
error-level telemetry without providing application value.

## Entry Points — Read These First

1. `apps/admin/src/services/typesense-client.ts` — shared multi-search request boundary.
2. `apps/admin/src/services/typesense-client.test.ts` — HTTP request contract tests.
3. `apps/admin/src/services/typesense-watch-search.service.ts` — primary lexical and semantic search requests.
4. Typesense 30.2 `src/collection.cpp`, `Collection::highlight_text` — source of the production error template.

## Grep These

- `TypesenseSearchRequest|multiSearch` in `apps/admin/src/services`
- `highlights|highlight_fields|matched_tokens` in `apps/admin/src`
- `snippet_start_offset|collection.cpp:5951` in production Typesense logs

## What To Build

- Default every shared Typesense multi-search request to
  `highlight_fields: "none"` before serialization.
- Preserve an explicitly supplied `highlight_fields` value for future callers
  that intentionally consume highlighting.
- Pin both behaviors in the Typesense client unit tests.

## Constraints

- Do not change query text, queried fields, filters, grouping, ranking, or result
  document projections.
- Do not mutate the production Typesense deployment or its stored collection.
- Keep highlighting available as an explicit per-request opt-in.

## Verification

- `typesense-client.test.ts` proves implicit requests disable highlighting and
  explicit highlighting remains unchanged.
- Admin focused tests, typecheck, lint, and formatting pass.
- After normal PR-to-main deployment, production Typesense logs contain no new
  `snippet_start_offset` entries during representative multilingual searches.
