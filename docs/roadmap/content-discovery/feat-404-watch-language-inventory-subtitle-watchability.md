---
id: "feat-404"
title: "Watch language inventory subtitle watchability"
owner: "vlad"
priority: "P2"
status: "complete"
completed_date: "2026-08-20"
start_date: "2026-08-20"
duration: 2
depends_on:
  - "feat-346"
  - "feat-403"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "content-discovery"
  - "subtitles"
---

## Problem

The Admin Watch language inventory can classify a video as subtitle-only when
the selected fallback audio does not expose a usable VTT for that video
edition. The Web link can carry the correct subtitle intent and still reach a
player that cannot activate it.

This gap predates feat-403. Feat-403 does not make it worse because it preserves
the existing fallback-audio path.

## Entry Points - Read These First

1. `apps/admin/src/services/video.service.ts` - builds subtitle-only inventory
   candidates and selects `watchLanguageSlug`.
2. `apps/admin/src/services/search-watchability.ts` - existing watchability
   contract for usable VTT, direct ownership, and edition-compatible fallback
   audio.
3. `apps/web/src/lib/watch-language-inventory.ts` - consumes the Admin
   `watchLanguageSlug` and adds one-shot subtitle intent.

## What To Build

- Require a usable nonblank VTT for subtitle-only inventory rows.
- Respect direct subtitle ownership.
- Select fallback audio from the subtitle's video edition.
- Add database-level coverage for SRT-only, direct-sibling, and cross-edition
  cases.

## Constraints

- Preserve exact language slug identity.
- Do not infer language relationships from BCP-47 prefixes.
- Keep public Watch URL shapes unchanged.

## Verification

- Run the Admin inventory database tests.
- Verify a subtitle-only inventory card activates its requested subtitle.
- Confirm fully dubbed inventory routes remain unchanged.
