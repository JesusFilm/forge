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

1. `JesusFilm/jesusfilm-rag/src/db/schema.ts`, `JesusFilm/jesusfilm-rag/migrations/`, and the Forge schema/migration paths delivered by `feat-425` — source and target database contracts.
2. `JesusFilm/jesusfilm-rag/scripts/copy-raws.sh`, `JesusFilm/jesusfilm-rag/scripts/eval.ts`, `JesusFilm/jesusfilm-rag/eval/qa-golden.yaml`, and `JesusFilm/jesusfilm-rag/src/retrieval/retrieve.ts` — existing copy, reconciliation, and retrieval-equivalence inputs.
3. `docs/roadmap/rag/evidence/feat-429/local-copy-reconciliation.json` — planned redacted machine-readable rehearsal receipt produced by this ticket.

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
