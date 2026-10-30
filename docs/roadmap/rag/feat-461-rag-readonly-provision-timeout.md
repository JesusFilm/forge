---
id: "feat-461"
title: "Bound RAG production reader provisioning for network latency"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-07"
duration: 1
depends_on: ["feat-460"]
blocks: ["feat-435"]
tags: ["rag", "postgres", "security", "railway"]
---

## Problem

The first guarded production reader provisioning attempt reached the exact
Railway `forge/production` RAG PostgreSQL target but failed without committing.
A transaction-wrapped SQL rehearsal completed in about five seconds, identifying
Prisma's default five-second interactive transaction timeout as the boundary.

## What To Change

- Give the provisioning transaction an explicit bounded wait and execution
  timeout that accommodates the production proxy latency.
- Preserve atomic rollback, redacted errors, and every existing production
  guard.
- Re-run the local PostgreSQL reader/writer privilege contract before another
  production attempt.

## Verification

- Confirm the failed production attempt left no reader roles or privilege
  changes.
- Confirm the exact SQL sequence succeeds inside an explicit production
  rollback rehearsal.
- Run the RAG role integration test, unit tests, lint, and typecheck.

## Resolution

Implemented in [Forge PR #2185](https://github.com/JesusFilm/forge/pull/2185).
The provisioner retains one atomic transaction and now allows 10 seconds to
acquire it and 30 seconds to execute it. The reader/writer PostgreSQL integration
contract, RAG typecheck, lint, dependency checks, and formatting pass. The exact
production SQL sequence also completed in an explicit rollback rehearsal, with
no persistent production changes.
