---
id: "feat-541"
title: "Document RAG database and R1 consumer registry visually"
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

J054 needs a shareable schema diagram combining the existing corpus and draft PR #2397's isolated R1 consumer registry.

## Entry Points — Read These First

1. `apps/rag/prisma/schema.prisma` and `apps/rag/prisma/migrations/*/migration.sql`.
2. PR #2397's `20260923000000_consumer_registry_foundation/migration.sql` at the pinned revision in the artifact README.

## Grep These

`CREATE TABLE`, `FOREIGN KEY`, `CREATE CONSTRAINT TRIGGER`, `consumer_private`.

## What To Build

Create `docs/diagrams/rag-database/schema.mmd`, rendered SVG, and README with provenance, regeneration instructions, constraints and limitations. Use separate labeled groups for existing and draft additions; distinguish logical links from foreign keys. Review SQL constraints and visually inspect the render before sharing a documentation-only draft PR.

## Constraints

Documentation only. No application, schema, data, credentials, deployment or settings changes. R1 is a draft snapshot, not evidence of deployment. No implementation dependency on merging R1.

## Verification

Render Mermaid, inspect the image, compare all table and FK names to pinned migrations, run Prettier on changed Markdown and `git diff --check`.

## Resolution

Created `docs/diagrams/rag-database/schema.mmd`, `schema.svg` and the accompanying README investigation notes. All 13 tables and eight FKs reviewed; Mermaid rendering, visual inspection and documentation formatting checked. Draft PR link recorded below before delivery.
