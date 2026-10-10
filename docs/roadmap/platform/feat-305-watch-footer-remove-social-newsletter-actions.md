---
id: "feat-305"
title: "Remove Watch footer social and newsletter actions"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
---

## Problem

The Watch footer still includes social-media icons and a newsletter subscription
button that should no longer appear on Watch pages.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeFooter.tsx` - social-link data and the
   newsletter footer action.
2. `apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx` - focused
   footer rendering contracts.

## Grep These

- `socialLinks`
- `twitter.com/jesusfilm`
- `Sign Up For Our Newsletter`

## What To Build

1. Remove the X, Facebook, Instagram, and YouTube links from the shared Watch
   footer.
2. Remove the newsletter subscription button from the shared Watch footer.
3. Preserve the logo, navigation, Give Now action, contact details, legal links,
   three-column contact layout, and sticky-player layering.
4. Add focused regression coverage for the removed actions.

## Constraints

- Do not change the remaining footer destinations or localized labels.
- Do not remove social or newsletter content outside the Watch footer.
- Do not change the contact-information layout.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/__tests__/WatchHomeFooter.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke confirms the removed actions are absent and the remaining
  footer layout is intact.

## Completion Notes

- Removed the four social destinations and the newsletter subscription action
  from the shared Watch footer.
- Preserved the logo, navigation, Give Now action, contact details, legal links,
  three-column contact layout, and footer stacking layer.
- Focused tests, Web typecheck, targeted ESLint, Prettier, and browser
  verification passed. The browser found zero matching social/newsletter
  destinations, retained one Give Now action and three contact columns, and
  reported no page errors.
