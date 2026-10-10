---
id: "feat-264"
title: "Watch mobile section CTA alignment"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-home"
  - "mobile"
  - "responsive-design"
---

## Problem

Watch home section headers stack their Watch CTA below the title at mobile
widths. The action should remain in the right-side header position used at
larger breakpoints while the title wraps within the remaining space.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeSection.tsx` - responsive section
   heading and CTA layout.
2. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` - Watch home
   rendering coverage.

## Grep These

- `flex-col gap-6 lg:flex-row`
- `WatchHomeSection`
- `WatchHomePage`

## What To Build

1. Keep the section heading and Watch CTA in a horizontal row on mobile.
2. Allow the heading column to shrink and wrap without shrinking the CTA.
3. Preserve the existing desktop alignment and visual styling.

## Constraints

- Do not change the CTA destination or interaction behavior.
- Do not change card, carousel, or section data behavior.

## Verification

- Focused Watch home component tests pass.
- Type checking and formatting pass for the touched app.
- A mobile browser smoke confirms the title and CTA occupy the same header row,
  with the CTA remaining to the right.

## Completion Notes

- The section header now uses a horizontal flex row at every breakpoint.
- The heading column can shrink and wrap while the Watch CTA remains
  non-shrinking on the right.
- Focused tests, web type checking, formatting, lint, and a 390 x 844 browser
  smoke validate the responsive contract.
