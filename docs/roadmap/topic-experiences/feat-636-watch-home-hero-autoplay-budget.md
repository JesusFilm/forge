---
id: "feat-636"
title: "Bound Watch home hero autoplay media"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags: [web, watch, performance]
---

## Problem

The Watch home hero advances through autoplay videos indefinitely, making media
requests and mobile data use proportional to page dwell time.

## Entry Points

1. `apps/web/src/components/home/useWatchHomeTvCarousel.ts`
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx`
3. `apps/web/src/components/home/__tests__/useWatchHomeTvCarousel.test.ts`

## What To Build

Cap an automatic visit at three slides, then unmount the video and leave its poster
and timeline visible. An explicit timeline selection starts playback again and
resets the visit budget.

## Verification

Cover the budget boundary and explicit restart behavior. Run focused carousel tests,
Web typecheck and lint; inspect the final diff for unchanged selection behavior.
