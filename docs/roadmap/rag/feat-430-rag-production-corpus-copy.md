---
id: "feat-430"
title: "Copy the production RAG corpus into Forge Railway"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-16"
duration: 2
depends_on: ["feat-429"]
blocks: ["feat-431"]
tags: ["rag", "data-migration", "railway"]
---

## Problem

The verified production corpus and vectors must be copied without disturbing jfrag production. Historical scope: [jfrag #163](https://github.com/JesusFilm/jesusfilm-rag/issues/163).

## Entry Points — Read These First

1. `docs/roadmap/rag/evidence/feat-429/local-copy-reconciliation.json` and the Forge copy command delivered by `feat-429` — approved rehearsal receipt and exact resumable command.
2. `JesusFilm/jesusfilm-rag/docs/decisions/0014-bulk-copy-raw-documents-to-prod.md` and `JesusFilm/jesusfilm-rag/docs/ops/copy-raws.md` — source snapshot, cutoff, copy, and recovery constraints.
3. `docs/roadmap/rag/evidence/feat-430/production-copy-reconciliation.json` — planned redacted production copy receipt produced by this ticket.

## Grep These

- `dry-run`
- `source snapshot`
- `reconciliation`
- `rollback`

## What To Build

Execute the approved database-to-database copy and record redacted operational evidence.

## Constraints

- Operator execution only against explicitly named services/environments.
- Keep source production untouched and rollback-ready.

## Verification

- Production reconciliation matches the local rehearsal gates.
- Forge retrieval/eval meets recorded tolerance with no unexplained loss.

## Progress — 2026-08-28

The production database copy is complete and the redacted receipt at
`docs/roadmap/rag/evidence/feat-430/production-copy-reconciliation.json` is
equivalent: all seven table counts, integrity checks, fingerprints, embedding
provenance/dimensions, and stored-vector retrieval probes match, with zero
embedding calls. The source backup is retained and jfrag remains online.

PR [#2090](https://github.com/JesusFilm/forge/pull/2090) merged through the
normal PR-to-main flow with the matching `EMBED_QUERY_INSTRUCTION` production
configuration. The operator then independently ran the documented count and
integrity queries in the Forge Railway production database: every table count
matched the receipt and every orphan/null integrity count was zero.

The production data-copy scope is complete. Consumer cutover and its live
service soak remain owned by the later cutover tickets; jfrag and the retained
backup remain available for rollback until those gates complete.
