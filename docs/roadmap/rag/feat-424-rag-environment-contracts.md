---
id: "feat-424"
title: "Port RAG environment contracts and secret procedures"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-08-27"
duration: 2
depends_on: ["feat-423"]
blocks: ["feat-425"]
tags: ["rag", "infrastructure", "security"]
---

## Problem

RAG configuration and secret provisioning must move without exposing values or weakening fail-fast validation. Historical scope: [jfrag #157](https://github.com/JesusFilm/jesusfilm-rag/issues/157).

## Resolution

**Shipped:** 2026-08-27 via [PR #2061](https://github.com/JesusFilm/forge/pull/2061) (`feat(rag): port environment contracts and secret procedures`).

**What landed.** Forge RAG now has typed, target-aware environment validation; package-local development loading; fail-closed production database, model, dashboard, and write-host boundaries; scoped bearer validation; redacted diagnostics; and an operator runbook for Railway and Doppler target names. Database creation, schema migration, HTTP deployment, and caller cutover remain assigned to their later roadmap tickets.

**Verification.** All PR checks passed, including RAG lint, tests, build, format, CodeQL, and the aggregate CI gate. The real Doppler `forge-rag/prd` configuration passed the safe `production-read` preflight without printing values. The Railway receiver target was confirmed; the pre-feat-428 deployment failed safely because this ticket deliberately contains no HTTP runtime or start command.

**Unblocked.** `feat-425`.

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
