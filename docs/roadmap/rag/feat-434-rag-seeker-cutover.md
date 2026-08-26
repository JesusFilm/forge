---
id: "feat-434"
title: "Cut Seeker over to Forge RAG with rollback"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-10-01"
duration: 3
depends_on: ["feat-433"]
blocks: ["feat-435"]
tags: ["rag", "seeker", "cutover"]
---

## Problem

Seeker must switch atomically to Forge RAG while the old endpoint remains recoverable. Historical scope: [jfrag #167](https://github.com/JesusFilm/jesusfilm-rag/issues/167).

## Entry Points — Read These First

1. `apps/mastra/src/services/jesusfilm-rag-client.ts` and its package guide.
2. Production reconciliation/eval receipts and approved rollback values.

## Grep These

- `JESUSFILM_RAG_BASE_URL`
- `JESUSFILM_RAG_ALLOWED_HOSTS`
- `jesusfilm-rag-client`

## What To Build

Prepare and execute an atomic base-URL/allowlist cutover, verify Seeker, and retain exact rollback values.

## Constraints

- Do not retire jfrag or its secrets during this ticket.
- Cutover is blocked unless reconciliation and eval gates are green.

## Verification

- Seeker retrieval smoke and eval use Forge RAG through the approved route.
- Rollback is exercised or safely rehearsed and timed.
