---
id: "feat-426"
title: "Port shared RAG contracts and pure cores"
owner: "jaco"
priority: "P0"
status: "in-progress"
start_date: "2026-09-01"
duration: 4
depends_on: ["feat-425"]
blocks: ["feat-427"]
tags: ["rag", "contracts", "architecture"]
---

## Problem

Runtime-neutral `/v1` contracts and pure acquisition/indexing/retrieval cores must move before concrete adapters. Historical scope: [jfrag #159](https://github.com/JesusFilm/jesusfilm-rag/issues/159).

## Entry Points — Read These First

1. `packages/rag-contracts/CLAUDE.md`.
2. `apps/rag/.dependency-cruiser.cjs`.
3. jfrag `src/contracts`, pure cores, and contract-artifact tests.

## Grep These

- `RetrievalPolicy`
- `RawDocument`
- `/v1/search`
- `openapi.v1.json`

## What To Build

Move shared wire contracts into `packages/rag-contracts` and pure port-based core logic into the matching `apps/rag/src` lanes.

## Constraints

- Preserve `/v1` compatibility and mechanism-not-policy semantics.
- No concrete database, HTTP fetch, or embedding adapters.

## Verification

- Contract drift, unit, typecheck, lint, and dependency-cruiser checks pass.
- Consumers can import contracts without importing `apps/rag`.
