---
id: "feat-424"
title: "Port RAG environment contracts and secret procedures"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-08-27"
duration: 2
depends_on: ["feat-423"]
blocks: ["feat-425"]
tags: ["rag", "infrastructure", "security"]
---

## Problem

RAG configuration and secret provisioning must move without exposing values or weakening fail-fast validation. Historical scope: [jfrag #157](https://github.com/JesusFilm/jesusfilm-rag/issues/157).

## Entry Points — Read These First

1. `apps/rag/CLAUDE.md` — secret and deployment constraints.
2. jfrag `src/config/env.ts`, `.env.example`, and Railway configuration at the fresh source tip.

## Grep These

- `SERVE_BEARER_TOKENS`
- `DATABASE_URL`
- `OPENROUTER`
- `JESUSFILM_GATEWAY`

## What To Build

Port typed environment contracts, redacted diagnostics, example names, and an operator-only secret-provisioning procedure with explicit service/environment targets.

## Constraints

- Never print, commit, or transcribe secret values.
- Do not create the database or deploy service code in this ticket.

## Verification

- Unit tests cover missing, malformed, fallback, and redaction behavior.
- Operator preflight names exact Railway targets without values.
