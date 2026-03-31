---
id: "feat-029"
title: "Easter Experience (First Production Launch)"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-03-10"
duration: 21
depends_on:
  - "feat-022"
  - "feat-023"
  - "feat-024"
  - "feat-028"
tags:
  - "cms"
  - "web"
  - "mobile"
---

## Problem

The Easter experience was the first production content launched on the platform — the forcing function that drove CMS content modeling, web rendering, mobile rendering, and content sync to completion. It needed to be live at https://watch.jesusfilm.org/watch/easter for the Easter season.

## Entry Points — Read These First

1. `apps/web/src/app/[slug]/[locale]/page.tsx` — renders the Easter experience at `/watch/easter`
2. `apps/cms/src/api/experience/` — Experience content type that holds Easter content
3. `apps/cms/src/bootstrap/` — Easter content seeding logic (evolved from bootstrap to API endpoint)
4. `apps/cms/src/api/seed-easter/` — dedicated seed-easter API endpoint for one-time content seeding

## Grep These

- `easter` in `apps/cms/src/` — all Easter-related CMS code
- `seed-easter\|easterSeed` in `apps/cms/src/` — seeding logic
- `/watch/easter` in `apps/web/src/` — Easter route references
- `EasterDates` in `apps/` — Easter-specific section component across all apps

## What Was Built

1. Created the Easter experience content in Strapi with all section types: VideoHero, Text, BibleQuotesCarousel, RelatedQuestions, Video, MediaCollection, NavigationCarousel, EasterDates, QuizButton.
2. Built the `/watch/easter` route on web with full section rendering.
3. Rendered the Easter experience in the Expo mobile app.
4. Evolved content seeding from manual scripts → bootstrap lifecycle → gated to production → replaced by core-sync → dedicated seed-easter API endpoint.
5. Aligned seed data with production content and ordering.

## Verification

- https://watch.jesusfilm.org/watch/easter — live production page
- `apps/cms/src/api/seed-easter/` — seed endpoint exists
- Easter experience renders correctly in both web and mobile apps
