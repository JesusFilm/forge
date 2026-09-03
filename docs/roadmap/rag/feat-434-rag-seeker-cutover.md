---
id: "feat-434"
title: "Cut Seeker over to Forge RAG with rollback"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-10-01"
duration: 3
depends_on: ["feat-432"]
blocks: ["feat-435"]
tags: ["rag", "seeker", "cutover"]
---

## Problem

Seeker must switch atomically to Forge RAG while the old endpoint remains recoverable. Historical scope: [jfrag #167](https://github.com/JesusFilm/jesusfilm-rag/issues/167).

## Entry Points — Read These First

1. `apps/mastra/src/services/jesusfilm-rag-client.ts` and its package guide.
2. `apps/mastra/src/config/env.ts`, `apps/mastra/.env.example`, and `apps/mastra/src/config/env.test.ts` — `JESUSFILM_RAG_BASE_URL` / `JESUSFILM_RAG_ALLOWED_HOSTS` contract and production host guard.
3. `docs/roadmap/rag/evidence/feat-430/production-copy-reconciliation.json` and the eval receipt delivered by `feat-432` — production equivalence evidence required before cutover.
4. `docs/roadmap/rag/evidence/feat-434/seeker-cutover.md` — planned redacted cutover, smoke, monitoring, and exact rollback-value receipt.

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

## Resolution

PR #2153 shipped the production guard while intentionally leaving this feature
in progress until the live cutover. The follow-up closure PR records the
successful Railway-private variable cutover and Seeker retrieval smoke in
`docs/roadmap/rag/evidence/feat-434/seeker-cutover.md`.
