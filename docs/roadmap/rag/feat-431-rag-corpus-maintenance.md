---
id: "feat-431"
title: "Port RAG acquisition, ingestion, and maintenance"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-09-18"
duration: 5
depends_on: ["feat-430"]
blocks: ["feat-432"]
tags: ["rag", "acquisition", "indexing"]
---

## Problem

After preserving the corpus, Forge must own the mechanisms that maintain it. Historical scope: [jfrag #164](https://github.com/JesusFilm/jesusfilm-rag/issues/164).

## Entry Points — Read These First

1. jfrag acquisition, ingestion, registry, source-status, and production wrappers.
2. `apps/rag/CLAUDE.md` lane rules.

## Grep These

- `acquire-production`
- `index-production`
- `source-status`
- `idempotent`

## What To Build

Port acquisition, staging, normalization, chunking, embedding, indexing, and source-scoped maintenance commands.

## Constraints

- Only indexing writes corpus rows.
- Preserve source-scoped idempotence and embedding-model provenance.

## Verification

- Fake-based unit tests and real-adapter integration tests pass.
- Dry-run and explicit-target safeguards cover every production command.
