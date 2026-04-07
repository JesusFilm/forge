---
id: "feat-053"
title: "AI Video Inspiration Platform"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-05-01"
duration: 31
depends_on: []
blocks: []
tags:
  - "web"
  - "manager"
  - "ai-pipeline"
---

## Problem

Teams need a curated place to explore inspiring AI-generated video examples, patterns, prompts, and creative directions without digging through scattered links and private notes. A dedicated inspiration platform turns experiments into reusable fuel for future creation work.

## Entry Points — Read These First

1. `apps/web/src/app/page.tsx` — public content entrypoint
2. `apps/web/src/lib/content.ts` — CMS-backed content fetch pattern
3. `apps/manager/src/app/dashboard/page.tsx` — internal curation/admin shell
4. `apps/cms/src/api/experience/content-types/experience/schema.json` — current content modeling pattern
5. `apps/cms/src/components/sections/media-collection.json` — existing collection-style presentation building block

## Grep These

- `media-collection` in `apps/cms/src/components/sections/`
- `content.ts` in `apps/web/src/lib/`
- `dashboard` in `apps/manager/src/app/`
- `experience` in `apps/cms/src/api/`

## What To Build

1. Create a browsable inspiration library for examples, prompt recipes, categories, and creative notes.
2. Allow internal curation so strong examples can be tagged by theme, style, audience, and production technique.
3. Support public or semi-public publishing of curated inspiration collections.
4. Reuse existing CMS section patterns where possible instead of inventing a one-off presentation system.

## Constraints

- Do NOT couple this to contest-only flows; the inspiration library should stand on its own.
- Keep curation lightweight enough that adding a new example is faster than writing a long document.
- Avoid hardcoding examples in frontend code when CMS can model them.

## Verification

- Curators can add and categorize inspiration items
- Users can browse inspiration by theme or collection
- The platform supports at least one CMS-driven public presentation surface
