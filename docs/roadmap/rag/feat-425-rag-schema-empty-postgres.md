---
id: "feat-425"
title: "Port the RAG schema and provision empty Postgres"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-08-29"
duration: 3
depends_on: ["feat-424"]
blocks: ["feat-426"]
tags: ["rag", "postgres", "migration"]
---

## Problem

Forge RAG needs a schema-compatible empty database before code or corpus can move. Historical scope: [jfrag #158](https://github.com/JesusFilm/jesusfilm-rag/issues/158).

## Entry Points — Read These First

1. jfrag schema, migrations, migration checker, and Railway database docs at the fresh source tip.
2. `apps/rag/CLAUDE.md` — database separation and production rules.

## Grep These

- `halfvec(1536)`
- `embedding_model`
- `migration`
- `pgvector`

## What To Build

Port schema and migrations, add drift checks, and document an explicit-target procedure to provision and verify an empty Railway Postgres service.

## Constraints

- Do not copy corpus rows or re-embed content.
- Provisioning is an operator action; no direct local production deploy.

## Verification

- Fresh local Postgres migrates from zero and schema drift is clean.
- Empty production verification records extensions, tables, indexes, and vector dimensions without row content.
