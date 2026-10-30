---
id: "feat-917"
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

## October 30 integration evidence

- Integrated actual main `a3a8f8796a8c25749c4cd02432397772dbf93cef` while
  retaining only the three decorative-backdrop `priority` removals as the
  production delta. Hero media, foreground thumbnail priority, queue, modal,
  attachment and poster behavior are unchanged.
- Renamed this ticket from `feat-634` to `feat-917`: retained PRs #2652 and
  #2614 use `feat-634` for different work. Preserved both claims and the
  current main README; updated only this row and its counter contribution.
- All 149 focused home tests pass. Web typecheck, scoped ESLint and formatting
  pass. Typecheck initially exposed missing local Admin dependency links;
  reusing the matching existing cache restored them without a source change.
- Complete here denotes the narrow source implementation. Independent review,
  normal commit hooks, published-candidate CI and actual-route/legacy
  preload, appearance and matched loading acceptance remain pending.
  FGE-160 stays in its existing review state; no deployed resolution is claimed.
- The September audit's byte samples are historical. Removing `priority`
  does not establish lower total bytes or faster LCP. Verify complete HTML
  and HTTP Link/image preload identities on root and localized homes at
  mobile/desktop widths, authored and legacy controls, and paired request,
  LCP and CLS observations before making a loading claim.
- PR #2630 remains based on this PR's branch but its current head does not
  contain the original parent tip. Reconcile its actual ancestry and surviving
  recipe-only delta separately; do not assume a tested stack or fold #2638's
  distinct deterministic-opening scope into this change.
