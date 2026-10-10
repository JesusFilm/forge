---
id: "feat-634"
title: "Keep Decorative Watch Home Backdrops Out of the Preload Queue"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Problem

The full-viewport blurred backdrop duplicates a hero image but is decorative.
Marking it `priority` creates a second full-width image preload that can compete
with the actual hero frame during the LCP window.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - current
   experience-backed homepage and localized homepage backdrop.
2. `apps/web/src/components/home/WatchHomePage.tsx` - legacy homepage renderer.
3. `apps/web/src/components/home/WatchHomeHero.tsx` - legacy thumbnail hero
   backdrop.

## What To Build

- Keep decorative blurred backdrops out of the image preload priority queue.
- Preserve the actual hero frame and active thumbnail loading behavior.

## Verification

- Run scoped formatting and lint checks for touched Web files.
- Run Web typecheck and `git diff --check`.
- Confirm no `priority` prop remains on the decorative backdrop images.

## Resolution

- Removed `priority` from the decorative blurred backdrop images in the active
  and legacy Watch home renderers. The active hero media and thumbnail
  prioritization are unchanged, so the decorative duplicate no longer creates a
  competing full-width preload.
- Web typecheck, scoped ESLint, formatting, and `git diff --check` pass.
