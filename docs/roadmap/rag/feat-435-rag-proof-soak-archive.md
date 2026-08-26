---
id: "feat-435"
title: "Prove RAG maintenance, soak, and archive jfrag"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-10-04"
duration: 7
depends_on: ["feat-434"]
blocks: []
tags: ["rag", "verification", "retirement"]
---

## Problem

Forge ownership is not proven until a new small source completes the full pipeline and the rollback window closes. Historical scope: [jfrag #168](https://github.com/JesusFilm/jesusfilm-rag/issues/168).

## Entry Points — Read These First

1. Forge acquisition/indexing/retrieval/dashboard/eval runbooks.
2. Cutover soak criteria, consumer inventory, snapshot retention, and archival approval.

## Grep These

- `acquire`
- `index`
- `dashboard`
- `archive`

## What To Build

Run one small source through acquire → stage → normalize → chunk → embed → index → retrieve → dashboard/eval, complete soak, take the final snapshot, and archive jfrag with a Forge pointer.

## Constraints

- Retirement requires approved rollback expiry and every consumer accounted for.
- Preserve final snapshot retention ownership and recovery documentation.

## Verification

- End-to-end evidence covers every pipeline stage without corpus text in reports.
- Seeker and NanoClaw pass soak; jfrag README points to `apps/rag/AGENTS.md` and the migration record.
