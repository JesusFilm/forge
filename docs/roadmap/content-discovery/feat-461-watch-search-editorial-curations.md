---
id: "feat-461"
title: "Watch Search editorial curations"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-07"
duration: 3
depends_on:
  - "feat-334"
blocks: []
tags:
  - "admin"
  - "search"
  - "typesense"
  - "multilingual"
  - "i18n"
---

## Problem

Searching for Rescue Project omits the Visual Vernacular Intro even though the
intro is a published member of that project. Broad parent-title inheritance
would also change unrelated JESUS clip searches.

## Entry Points — Read These First

1. `apps/admin/src/services/typesense-watch-search-indexer.ts`
2. `apps/admin/src/services/typesense-watch-search.service.ts`
3. `apps/admin/src/services/typesense-client.ts`
4. `apps/admin/prisma/schema.prisma`

## Grep These

- `watchLexicalCollectionSchema|lexicalLaneRequest`
- `rebuildTypesenseWatchSearchIndex|candidateWatchCollectionSchemas`
- `curation_sets|filter_curated_hits|curation_tags`

## What To Build

- Store logical exact-query curations and localized alias provenance in
  PostgreSQL, with a repository manifest as a deterministic recovery copy.
- Compile enabled records against each generation's published localized
  lexical documents into a versioned Typesense v30 curation set.
- Apply tagged curations only to the metadata lane and require normal language
  filters to apply to curated hits.
- Seed Rescue Project to include the Visual Vernacular Intro without affecting
  JESUS queries.

## Constraints

- Curations apply only to normalized exact queries.
- Published locales are the active scope; no cross-locale playback fallback is
  synthesized.
- Existing fusion determines final ordering, while the default first page must
  contain the curated intro.
- Reindex failure must preserve the current aliases and curation generation.

## Verification

- Compiler, Typesense client, indexer, search service, migration, and manifest
  tests pass.
- Rescue Project returns the Visual Vernacular Intro on the default first page.
- JESUS result behavior remains unchanged.
- Admin format, lint, typecheck, and test suites pass.
