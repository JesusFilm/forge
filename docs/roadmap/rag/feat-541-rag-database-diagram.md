---
id: "feat-541"
title: "Document the RAG database schema as a complete ERD"
owner: "jaco"
priority: "P2"
status: "complete"
start_date: "2026-09-23"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "postgresql", "documentation"]
---

## Problem

Engineers sharing the RAG data model need one complete, source-cited
entity-relationship diagram that covers the existing corpus schema and the
consumer-registry schema proposed in draft PR #2397, without reading four
migration files and a Prisma datamodel side by side.

## Entry Points — Read These First

1. `apps/rag/prisma/schema.prisma` and `apps/rag/prisma/migrations/*/migration.sql`.
2. PR #2397's `20260923000000_consumer_registry_foundation/migration.sql` at the pinned revision in the artifact README.
3. `docs/diagrams/rag-database/README.md` — legend, revision pins, source inventory and limitations.

## Grep These

`CREATE TABLE`, `FOREIGN KEY`, `CREATE CONSTRAINT TRIGGER`, `consumer_private`, `erDiagram`.

## What To Build

Create `docs/diagrams/rag-database/schema.mmd` as a Mermaid `erDiagram`, with rendered SVG and PNG and a README. List every table, every column with data type, nullability and default, primary keys, foreign keys, unique/index/check constraints, and relationship cardinality and delete behaviour. Distinguish existing tables from draft additions, and real foreign keys from logical references inferred from code. Cite the defining migration for each table and pin the revisions inspected. Label anything inferred or unavailable instead of silently filling it in.

## Constraints

Documentation only. No application, schema, data, credentials, deployment or settings changes. The draft registry is a pinned snapshot, not evidence of deployment. No implementation dependency on merging that draft.

## Verification

Render Mermaid to SVG and PNG, inspect the image, script-check that every entity and attribute in the source appears in the SVG, compare every column and constraint to the pinned migrations, run Prettier on changed Markdown and `git diff --check`.

## Resolution

Created `docs/diagrams/rag-database/schema.mmd`, `schema.svg`, `schema.png` and the README. The ERD covers 13 tables, 102 columns, eight foreign keys and five labelled logical references, with per-table source citations, revision pins, a legend, index/trigger/privilege inventories and an explicit list of what could not be established. Draft documentation PR: [#2398](https://github.com/JesusFilm/forge/pull/2398).
