---
id: "feat-179"
title: "Watch chapter navigation feedback"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-178"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "navigation"
---

## Problem

Watch chapter cards can feel unresponsive on slow server navigations because
the current page remains visible while the next watch route resolves. Users
need immediate feedback that their chapter click was accepted.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` - chapter card links.
2. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` -
   focused chapter carousel behavior coverage.
3. `apps/web/src/lib/routes.ts` - canonical watch URL builders and basePath
   contract.

## What To Build

1. Preserve canonical public audio-language watch links for chapter cards.
2. Show an immediate pending affordance when a normal chapter-card click starts
   navigation.
3. Do not hijack modified clicks such as open-in-new-tab or open-in-new-window.

## Verification

- Focused SiblingCarousel tests cover the pending click feedback and modified
  click behavior.
- `@forge/web` targeted tests pass.
- Browser smoke confirms a chapter click visibly acknowledges navigation.
