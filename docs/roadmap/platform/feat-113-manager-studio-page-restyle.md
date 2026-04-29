---
id: "feat-113"
title: "Manager Studio Page Restyle"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-16"
duration: 1
depends_on:
  - "feat-112"
blocks:
  - "feat-114"
tags:
  - "manager"
  - "design-system"
  - "styling"
---

## Problem

The Studio shell rollout aligned the frame, navigation, and shared controls, but Coverage, Jobs, Job Detail, Agents, and related working surfaces still use older panel, table, form, and empty-state styling. That makes the real app feel visually disconnected from the design-system route even when the information architecture is correct.

## Scope

1. Apply the Studio design-system visual language to existing page internals across Coverage, Jobs, Job Detail, Agents, and shared empty states.
2. Preserve current layouts, information density, and behaviors while changing styling only.
3. Reuse the design-system typography, borders, buttons, inputs, badges, and table language instead of inventing parallel variants.
4. Keep the authenticated shell unchanged except where page content spacing needs to match the design-system composition.

## Verification

- `pnpm --filter @forge/manager lint`
- Route screenshots for coverage, jobs, agents, and design-system comparison
- Visual spot checks captured in `output/playwright/restyle-interactions/`
