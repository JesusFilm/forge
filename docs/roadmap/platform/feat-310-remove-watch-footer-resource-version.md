---
id: "feat-310"
title: "Remove Watch footer resource version"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
---

## Problem

The shared Watch footer displays the internal-looking label
`Resources (fea8f46)` beneath the ministry address. This versioned copy is not
useful to viewers and should not appear in the public footer.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeFooter.tsx` - the shared Watch footer
   and address column.
2. `apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx` - focused
   footer content and layout contracts.

## Grep These

- `resourcesVersion`
- `fea8f46`
- `100 Lake Hart Drive`

## What To Build

1. Remove the versioned Resources label from beneath the Watch footer address.
2. Preserve the Resources navigation link and all other footer content.
3. Add focused regression coverage for the address-column content.

## Constraints

- Do not remove or rename the Resources navigation action.
- Do not change footer destinations, layout, localization, or layering.
- Do not remove the catalog key because it may be used by other surfaces.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/__tests__/WatchHomeFooter.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke confirms the address column ends after `Orlando, FL, 32832`.

## Completion Notes

- Removed the versioned Resources label and its preceding line break from the
  shared Watch footer address column.
- Preserved the Resources navigation action and added focused coverage for both
  contracts.
- Focused tests, Web typecheck, targeted ESLint, Prettier, and `git diff
--check` passed.
- Browser verification against the snapshot-backed local Watch stack confirmed
  the footer address ends after `Orlando, FL, 32832`, the resource version is
  absent, and the Resources navigation link remains present.
- Page-loading performance is unaffected: the change only removes static
  server-rendered markup and does not alter hydration, media, routing, or
  client initialization.
