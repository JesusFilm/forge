---
id: "feat-637"
title: "Make every Watch home category reachable"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags: [web, watch, accessibility]
---

## Problem

The Watch home category carousel clips cards on mobile until Embla hydrates and
does not expose all categories at rest on desktop.

## Entry Points

1. `apps/web/src/components/home/WatchHomeCategoryRail.tsx`
2. `apps/web/src/components/home/__tests__/WatchHomeCategoryRail.test.tsx`

## What To Build

Use native horizontal overflow with snap points for narrow layouts and a
two-row, seven-column grid from 1440px. Keep visible, low-opacity arrow controls
for the scroll rail and a right-edge fade to cue overflow.

## Verification

Cover native scrolling, keyboard focus, category coverage, and desktop wrapping.
Run focused Web tests, typecheck, and lint; compare the rendered client boundary
to confirm the rail no longer needs carousel hydration for access.
