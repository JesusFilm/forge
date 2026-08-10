---
id: "feat-344"
title: "Watch cross-platform display title fallback"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-08-10"
duration: 3
depends_on:
  - "feat-336"
blocks: []
tags:
  - "admin"
  - "web"
  - "mobile"
  - "tv"
  - "watch"
  - "i18n"
---

## Problem

PR #1870 fixed blank localized-title fallback in Watch language inventory and
Web route snapshots, but other public producers and clients still fall directly
from a missing or whitespace-only title to a raw Video slug or internal ID.
The Watch home carousel, search, history, downloads, recommendations, mobile,
and TV can therefore display identifiers such as `miraculous-catch-of-fish`.

## Entry Points

1. `packages/content-display/src/index.ts`
2. `apps/admin/src/services/typesense-watch-search-locales.ts`
3. `apps/web/src/lib/watch-home.ts`
4. `apps/mobile/src/lib/watchHome/model.ts`
5. `apps/tv/src/lib/watchHome/model.ts`
6. `docs/plans/2026-08-10-001-fix-video-display-title-fallback-plan.md`

## What To Build

1. Share one display-title policy across Admin, Web, mobile, and TV: the first
   trimmed requested-language title, then published English, then a humanized
   Video slug.
2. Apply it at public producer/model boundaries and defensive legacy-data
   readers without changing URL, storage, cache, analytics, or playback
   identity.
3. Preserve requested-language descriptions and other localized fields when
   only the title falls back.
4. Preserve authored Experience overrides and intentionally titleless cards;
   never display `coreId`, `documentId`, or another internal ID as title copy.

## Constraints

- Keep public English candidates published and visible.
- Keep GraphQL locale additions title-only and bounded; do not add per-card
  requests or heavy mobile/TV media fields.
- Repair only allowlisted legacy fields whose historical producer stored a raw
  slug as placeholder text.
- Do not change public Watch route shapes or deploy directly to production.

## Verification

- Shared policy, Admin producer, Web, mobile, and TV focused tests cover
  requested, whitespace, English, unrelated locale, and humanized-slug cases.
- Tests prove requested descriptions and raw route/storage identity remain
  unchanged and intentionally titleless authored cards remain titleless.
- Browser QA of `/watch/jula.html` shows a readable carousel title, stable
  navigation and loading, and no new console errors.
- Relevant typechecks, lint, formatting, and CI-sensitive checks pass.

