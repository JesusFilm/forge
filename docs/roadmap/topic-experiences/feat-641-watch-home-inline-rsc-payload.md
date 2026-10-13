---
id: "feat-641"
title: "Reduce Watch home inline RSC payload"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags: [watch, performance, rsc]
---

## Problem

The `/watch` route embeds a large React Server Component flight payload in its HTML. The home hero carousel repeats derived stream, poster, thumbnail and alt-text values across its rotation pools.

## Entry Points — Read These First

- `apps/web/src/lib/watch-home-carousel-sequence.ts`
- `apps/web/src/components/home/WatchHomePage.tsx`
- `apps/web/src/components/home/WatchHomeExperiencePage.tsx`
- `apps/web/src/components/home/WatchHomeTvCarousel.tsx`

## What To Build

Encode carousel pools in a compact wire format at the server/client boundary and reconstruct the omitted values in the client carousel. Preserve authored overrides and round-trip behavior.

## Constraints

Keep initial hero slides and carousel rotation behavior unchanged. Do not modify analytics or other routes.

## Verification

Measure production `/watch` HTML and Brotli size before and after; test exact round-trip behavior for standard and authored values; run focused tests, typecheck, lint and production build.
