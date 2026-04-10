---
id: "feat-077"
title: "Roadmap Operations and Owner Hygiene"
owner: "josh"
priority: "P1"
status: "in-progress"
start_date: "2026-04-10"
duration: 14
depends_on:
  - "feat-033"
blocks: []
tags:
  - "roadmap"
  - "project-management"
  - "operations"
---

## Problem

The roadmap now reflects engineering work clearly, but it does not yet have an explicit owner responsible for keeping it current, actionable, and delegation-ready. Without that operating layer, priorities drift, stale tickets linger, and leadership has less confidence in using the roadmap as a live coordination tool.

## Entry Points — Read These First

1. `docs/roadmap/README.md` — current roadmap index and status snapshot
2. `docs/roadmap/platform/feat-033-roadmap-dashboard-app.md` — roadmap app foundation
3. `apps/roadmap/` — roadmap dashboard implementation
4. `USER.md` and `AGENTS.md` — owner mapping, PM role, and operating expectations

## What To Build

1. Add Josh as a first-class roadmap owner so PM work can be assigned explicitly.
   - Update `apps/roadmap/lib/features.ts` to include `josh` in `GITHUB_PROFILES`.
   - Use `openclaw` as the username and `https://avatars.githubusercontent.com/openclaw?v=4` for the avatar.
2. Update the About page team list.
   - Update `apps/roadmap/app/(public)/about/page.tsx` to include Josh in the `TEAM` array.
   - Adjust the grid layout from `sm:grid-cols-5` to `lg:grid-cols-6` to accommodate the 6th member.
3. Keep roadmap metadata healthy: owners, status, dependencies, due dates, and delegation readiness.
4. Regularly identify work that is ready to delegate, blocked, stale, or missing an owner.

## Constraints

- This ticket covers roadmap operations and hygiene, not product or platform implementation work.
- Roadmap changes should stay scoped to metadata, owner clarity, and planning structure.

## Verification

- Josh appears as an assignable owner in roadmap data and UI surfaces.
- Josh is visible in the Team section of the About page with the correct avatar.
- The roadmap app loads and renders correctly with the new owner.
