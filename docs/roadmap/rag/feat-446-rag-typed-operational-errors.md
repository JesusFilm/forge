---
id: "feat-446"
title: "Complete typed operational errors across RAG"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-08-31"
duration: 2
depends_on: ["feat-431"]
blocks: []
tags: ["rag", "errors", "operations"]
---

## Problem

The maintenance hardening introduces typed errors for argument, fetch, and
corpus-state boundaries, but older RAG production paths still throw raw
`Error`. This remains inconsistent with the root error-handling rule.

## Entry Points — Read These First

1. `apps/rag/src/contracts/operational-error.ts` — current typed error contract.
2. `apps/rag/src/adapters/` and `apps/rag/scripts/` — remaining production throws.

## Grep These

- `throw new Error`
- `RagOperationalError`
- `EnvironmentConfigurationError`

## What To Build

Classify remaining production failures into stable typed error codes. Preserve
messages and causes, and update callers or tests that need to branch by type.

## Constraints

- Do not convert test sentinel errors that intentionally model arbitrary failures.
- Keep adapters dependent only on contracts.

## Verification

- No unapproved raw `throw new Error()` remains in RAG production code.
- Tests assert stable types/codes at configuration and external-I/O boundaries.
- `pnpm --filter @forge/rag test`, typecheck, lint, and depcruise pass.
