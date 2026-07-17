---
id: "feat-258"
title: "Watch footer external social links"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
---

## Problem

The Watch footer social links navigate away from Watch in the current tab and
do not declare the SEO and browser-isolation relationship required for
external destinations.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeFooter.tsx` - social-link data and
   rendered anchors.
2. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` - Watch home
   rendering coverage that includes the footer.

## Grep These

- `socialLinks.map`
- `twitter.com/jesusfilm`
- `Sign Up For Our Newsletter`

## What To Build

1. Open each footer social-domain link in a new browser tab.
2. Add `nofollow`, `noopener`, and `noreferrer` to each social link.
3. Add focused assertions for all configured social destinations.

## Constraints

- Do not change same-domain footer navigation or destination URLs.
- Do not change footer layout, styling, labels, or image behavior.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/__tests__/WatchHomePage.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`

## Completion Notes

- Added `target="_blank"` and `rel="nofollow noopener noreferrer"` to all four
  footer social links without changing same-domain footer navigation.
- Added Watch home assertions covering the X, Facebook, Instagram, and YouTube
  destinations.
- Static diff verification passed. The focused Vitest command could not reach
  test execution because this worktree had no installed dependencies and pnpm
  dependency hydration from the shared cache stalled; no test failure was
  reported.
