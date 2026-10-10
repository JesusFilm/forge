---
id: "feat-326"
title: "Admin search results pagination"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-02"
duration: 1
depends_on:
  - "feat-136"
blocks: []
tags:
  - "admin"
  - "search"
  - "observability"
  - "ux"
---

## Problem

The Admin search analytics page loads a bounded set of recent Watch search
requests, but the table has no pagination controls. Operators can only inspect
the first visible slice. Long query text also stretches the table and makes the
surface harder to scan.

## Scope

- Add URL-backed pagination for the `/dashboard/search` request table.
- Keep page metrics based on the loaded analytics window.
- Reset pagination when the operator changes the window.
- Bound long query text in the table so it wraps or truncates without forcing
  horizontal table scroll.

## Verification

```
pnpm --filter @forge/admin test -- ops-data.test.ts
pnpm --filter @forge/admin typecheck
```
