---
id: "feat-430"
title: "Copy the production RAG corpus into Forge Railway"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-09-16"
duration: 2
depends_on: ["feat-429"]
blocks: ["feat-431"]
tags: ["rag", "data-migration", "railway"]
---

## Problem

The verified production corpus and vectors must be copied without disturbing jfrag production. Historical scope: [jfrag #163](https://github.com/JesusFilm/jesusfilm-rag/issues/163).

## Entry Points — Read These First

1. `feat-429` rehearsal receipts and copy runbook.
2. Source snapshot/cutoff and recovery procedure approved by operators.

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
