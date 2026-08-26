---
id: "feat-429"
title: "Rehearse the RAG corpus copy locally"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-09-12"
duration: 4
depends_on: ["feat-428"]
blocks: ["feat-430"]
tags: ["rag", "data-migration", "verification"]
---

## Problem

The production copy needs a resumable local rehearsal proving existing embeddings can move unchanged. Historical scope: [jfrag #162](https://github.com/JesusFilm/jesusfilm-rag/issues/162).

## Entry Points — Read These First

1. Source and target schema/migration histories.
2. Existing retrieval eval and corpus provenance tools.

## Grep These

- `embedding_model`
- `1536`
- `checksum`
- `resume`

## What To Build

Create read-only preflight, resumable copy, reconciliation, and rollback-safe local rehearsal tooling.

## Constraints

- Never re-index or re-embed.
- Reports contain counts/hashes/IDs only, never corpus text or credentials.

## Verification

- Reconcile counts, integrity, provenance, dimensions, deterministic samples/hashes, retrieval, and eval.
- Interrupt and resume the copy without duplicates or loss.
