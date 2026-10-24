---
id: "feat-287"
title: "Admin Watch search script language detection"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on:
  - "feat-254"
blocks: []
tags:
  - "admin"
  - "watch"
  - "search"
  - "multilingual"
---

## Problem

Admin Watch search can resolve a Russian-script query on an English Watch route
as an English route search when the web client does not send an explicit target
language. The server only detects languages named by slug or English name in
the query, so arbitrary Cyrillic search text falls through to route language.

## Scope

- Add server-side script detection after explicit target and query-named
  language resolution.
- Keep existing explicit language, named-language, route, display, browser, and
  fallback priority semantics intact.
- Cover Cyrillic queries so Russian-language text does not silently inherit an
  English route.

## Verification

```
pnpm --filter @forge/admin test -- search-language-resolution.test.ts
```
