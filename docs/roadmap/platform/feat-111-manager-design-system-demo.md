---
id: "feat-111"
title: "Forge Design System Demo"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-14"
duration: 1
depends_on:
  - "feat-088"
blocks: []
tags:
  - "manager"
  - "design-system"
  - "tooling"
---

## Problem

Forge UI work has grown across Coverage, Jobs, Job Detail, Review Player, and Agents surfaces, but operators and engineers do not have one place to see the available UI patterns. This makes it easier to duplicate button, badge, card, form, table, and status styles.

## Scope

1. Add a Forge dashboard route at `apps/manager/src/app/dashboard/design-system/page.tsx`.
2. List reusable Forge UI component patterns and the source files that currently own behavior.
3. Showcase foundations, navigation, badges, buttons, forms, cards, tables, coverage indicators, job execution rows, review panels, agents rows, modal chrome, and feedback states.
4. Reuse existing Manager behavior classes while applying the current ElevenLabs-inspired visual direction to the demo.
5. Add the route to `apps/manager/src/features/nav/dashboard-nav.tsx`.

## What Was Built

1. Added `/dashboard/design-system` as an authenticated Forge dashboard page.
2. Added the System tab to the dashboard navigation.
3. Added a responsive component inventory and kitchen-sink examples for Forge UI foundations, actions, forms, coverage, jobs, review, agents, and feedback states.
4. Reused existing Manager behavior classes and added demo-scoped visual CSS.
5. Updated the demo styling to a crisp monochrome workspace direction inspired by the provided ElevenLabs references.
6. Retuned the demo after screenshot comparison: switched to a system UI font stack, reduced heavy font weights, warmed the gray palette, removed the over-gray product visuals, and reduced first-screen dead space.

## Verification

- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- Desktop Playwright screenshot: `output/playwright/manager-design-system.png`
- Mobile Playwright screenshot: `output/playwright/manager-design-system-mobile.png`
- Before tuning screenshot: `output/playwright/manager-design-system-before-tune.png`
- Before tuning mobile screenshot: `output/playwright/manager-design-system-mobile-before-tune.png`
