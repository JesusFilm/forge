---
id: "feat-433"
title: "Add dual jfrag and Forge RAG operations"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-09-28"
duration: 3
depends_on: ["feat-432"]
blocks: ["feat-434"]
tags: ["rag", "operations", "rollback"]
---

## Problem

VM and NanoClaw tasks must support both services during cutover without ambiguous targets. Historical scope: [jfrag #166](https://github.com/JesusFilm/jesusfilm-rag/issues/166).

## Entry Points — Read These First

1. `JesusFilm/jesusfilm-rag/scripts/acquire-production.ts`, `JesusFilm/jesusfilm-rag/scripts/index-production.ts`, `JesusFilm/jesusfilm-rag/scripts/retrieve-production.ts`, `JesusFilm/jesusfilm-rag/scripts/eval-production.ts`, and `JesusFilm/jesusfilm-rag/scripts/source-status.ts` — operations that require explicit `:jfrag` and `:forge` task variants.
2. `docs/roadmap/rag/evidence/feat-433/task-inventory.md` — planned owner-approved VM/NanoClaw task inventory, including the external task-definition repository and exact paths discovered during implementation.
3. `apps/rag/AGENTS.md` and Forge operator commands delivered by `feat-431`/`feat-432` — target safety and rollback rules.

## Grep These

- `NanoClaw`
- `VM`
- `environment`
- `service`

## What To Build

Add explicitly targeted jfrag and Forge variants for maintenance, status, dashboard, and eval operations.

## Constraints

- No implicit production default or shared writable target.
- Preserve jfrag tasks until rollback expiry.

## Verification

- Dry-run receipts identify route, service, environment, and mutation/read-only mode.
- Both paths can run read-only checks without leaking credentials.
