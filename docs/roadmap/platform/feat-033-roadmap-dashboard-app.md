---
id: "feat-033"
title: "Roadmap Dashboard App"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-03-30"
duration: 2
depends_on: []
blocks: []
tags:
  - "roadmap"
---

## Problem

Stakeholders needed a visual way to see what work is planned, in progress, and complete — without navigating raw markdown files in a git repo. A dedicated roadmap dashboard app renders the feature files from `docs/roadmap/` as an interactive board.

## Entry Points — Read These First

1. `apps/roadmap/` — the Next.js roadmap dashboard app
2. `apps/roadmap/app/page.tsx` — main roadmap board page
3. `apps/roadmap/components/` — UI components (Sidebar, feature cards, lane views)
4. `apps/roadmap/lib/` — data loading from markdown feature files
5. `docs/roadmap/` — the source markdown files the app reads

## Grep These

- `getFeatures\|parseFeature\|loadRoadmap` in `apps/roadmap/` — data loading functions
- `status.*complete\|status.*in-progress` in `apps/roadmap/` — status rendering logic
- `docs/roadmap` in `apps/roadmap/` — references to the source data directory

## What Was Built

1. Built a Next.js App Router dashboard that reads feature files from `docs/roadmap/` subdirectories.
2. Parses YAML frontmatter and renders features grouped by lane (Content Discovery, Topic Experiences, Media Generation, Platform).
3. Shows feature status, owner, priority, timeline, and dependencies.
4. Includes a sidebar with navigation and an About page with team member profiles.
5. Deployed to Railway with Railpack builder after iterating through standalone mode issues.

## Verification

- `cd apps/roadmap && pnpm build` — app builds without errors
- `cd apps/roadmap && pnpm dev` — dashboard loads and renders feature cards
- Feature files from `docs/roadmap/` appear as cards on the board
