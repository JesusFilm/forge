---
id: "feat-638"
title: "Cover Watch homepage promise rejection handling"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "reliability"
---

## Goal

Prove the Watch homepage handles rejection from its concurrent message-loading promise without creating an orphaned rejection.

## Entry points

- `apps/web/src/app/[locale]/[htmlLang]/page.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/page.test.tsx`

## Constraints

- Keep the concurrent `Promise.all` loading of hero data, builder page data, and client messages.
- Preserve the originating rejection for the route's error boundary.

## Verification

- Reject client-message loading while other homepage work is pending; assert the page rejects with that error and emits no `unhandledRejection`.
- Run the homepage route tests, Web typecheck, and lint.

## Tracking

- Linear: FGE-158
