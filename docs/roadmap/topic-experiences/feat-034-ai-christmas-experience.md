---
id: "feat-034"
title: "AI-Generated Christmas Experience"
owner: "ekkasit"
priority: "P0"
status: "in-progress"
start_date: "2026-04-01"
duration: 14
depends_on:
  - "feat-022"
  - "feat-026"
blocks: []
tags:
  - "web"
  - "ai-pipeline"
---

## Problem

The Easter experience proved that manually curated CMS content could power polished front-end pages. The next step was to demonstrate that AI could assemble a complete themed experience automatically, drawing from content across the internet, the Bible, and the video library — without manual editorial curation.

## Entry Points — Read These First

1. `apps/web/src/app/[slug]/[locale]/page.tsx` — renders the Christmas experience at `/watch/christmas`
2. The Christmas experience content in Strapi CMS — an Experience entity with AI-generated section blocks
3. `apps/cms/src/api/experience/` — Experience content type that holds the generated content

## Grep These

- `christmas` in `apps/cms/src/` — Christmas-related CMS content and seeding
- `/watch/christmas` in `apps/web/src/` — Christmas route references
- `christmas` in `apps/` — all Christmas-related code across apps

## What Was Built

1. Created a complete Christmas experience page assembled entirely by AI.
2. AI drew from content across the internet, the Bible, and the JFP video library to compose themed section blocks.
3. Demonstrated that the Experience content type and section component system built for Easter can be driven by AI generation, not just manual curation.
4. Live at https://watch.jesusfilm.org/watch/christmas.

## Verification

- https://watch.jesusfilm.org/watch/christmas — live production page
- The experience renders with AI-generated section content using the same component system as Easter
