---
id: "feat-096"
title: "Manager Mobile Header and Title Spacing"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-22"
duration: 1
depends_on:
  - "feat-095"
blocks:
  - "feat-097"
  - "feat-098"
  - "feat-099"
tags:
  - "manager"
  - "design-system"
  - "mobile"
  - "styling"
---

## Problem

Two follow-up polish issues remain in the manager shell on mobile: notifications still sit in the lower action row instead of the top header row, and screen titles have too much vertical distance from their overline labels. The extra spacing weakens hierarchy across coverage and other dashboard screens that reuse the shared page-intro primitives.

## Entry Points — Read These First

1. `apps/manager/src/features/shell/manager-shell.tsx` — mobile top-row controls and lower action row.
2. `apps/manager/src/components/ui/page-intro.tsx` — shared `PageEyebrow`, `PageTitle`, and `PageDescription` spacing.
3. `apps/manager/src/features/coverage/coverage-report-client.tsx` — current coverage page intro usage.

## Grep These

- `aria-label="Notifications"`
- `PageTitle`
- `PageEyebrow`
- `PageIntro`

## What To Build

1. Move the mobile notifications control into the top header row while keeping desktop placement unchanged.
2. Remove the mobile notifications button from the lower action row so that row stays focused on page actions.
3. Tighten the default `PageTitle` spacing beneath `PageEyebrow` so coverage and other screens inherit the closer title/overline relationship.

## Constraints

- Preserve the current Studio visual language and tokens.
- Keep desktop behavior unchanged unless it naturally benefits from the shared spacing adjustment.
- Avoid screen-specific hacks when the shared primitive can carry the fix.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/coverage`
- Confirm on a mobile viewport that notifications render in the top row and the title sits closer to the overline.

## Completion Notes

- Notifications now render in the top mobile header row alongside the other header controls.
- The lower mobile action row is limited to page actions rather than account/system controls.
- Shared page-title spacing was tightened so coverage and other dashboard screens inherit a closer eyebrow-to-title relationship.
