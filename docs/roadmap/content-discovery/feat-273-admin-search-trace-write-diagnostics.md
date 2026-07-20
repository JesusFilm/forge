---
id: "feat-273"
title: "Admin search trace write diagnostics"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on:
  - "feat-272"
blocks: []
tags:
  - "admin"
  - "search"
  - "observability"
  - "production"
---

## Problem

Production trace capture still reports `PrismaClientValidationError`, but the
safe trace failure log records only the error class. Operators cannot tell
whether Prisma rejected a stale generated-client field, a JSON value, or an
argument mismatch without adding more context.

## What Changed

Trace failure logs now include a bounded, query-redacted Prisma validation
summary. The summary keeps diagnostic lines such as `Unknown argument` or
`Invalid value`, but drops the Prisma invocation block that may contain raw
query text or trace metadata.

## Verification

```
pnpm --filter @forge/admin test -- search-trace.service.test.ts
pnpm --filter @forge/admin typecheck
```
