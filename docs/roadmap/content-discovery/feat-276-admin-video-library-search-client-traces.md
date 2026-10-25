---
id: "feat-276"
title: "Admin video library search client traces"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on:
  - "feat-273"
blocks: []
tags:
  - "admin"
  - "search"
  - "observability"
  - "media-library"
---

## Problem

Admins are reporting confusing search results from the experience editor media
library, especially when adding items to media collection blocks. Existing
search traces capture public Watch search behavior, but editor video picker
searches are not identified by client source, so operators cannot isolate
media collection picker searches from other admin-driven searches.

## Scope

- Trace server-action video library searches from the experience editor.
- Attach a closed client identifier for media collection, carousel, and generic
  video picker searches.
- Keep trace metadata bounded and free of user identifiers, auth material,
  scoring payloads, or raw query copies beyond the existing search trace raw
  query field and retention policy.

## Verification

```
pnpm --filter @forge/admin test -- search-trace.service.test.ts experience-editor.test.tsx
pnpm --filter @forge/admin typecheck
```
