---
id: "feat-100"
title: "Manager Agents Page Separator Reduction"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-22"
duration: 1
depends_on:
  - "feat-091"
blocks: []
tags:
  - "manager"
  - "agents"
  - "mobile"
  - "styling"
---

## Problem

The agents dashboard stacks too many horizontal separators in a short vertical span. On mobile, the shared page header divider and the section-level borders for `Active` and `Paused` make the empty state feel over-ruled and visually heavy.

## Entry Points — Read These First

1. `apps/manager/src/features/agents/agents-page.tsx` — page layout and section grouping.
2. `apps/manager/src/components/ui/page-intro.tsx` — shared page intro divider behavior.

## Grep These

- `AgentsPage`
- `PageIntro`
- `border-t border-border/70`

## What To Build

1. Remove redundant horizontal separators from the agents dashboard layout.
2. Keep the page hierarchy readable through spacing rather than stacked rules.
3. Preserve existing copy, actions, and empty-state behavior.

## Constraints

- Keep the change scoped to the agents page layout.
- Do not restyle the automation cards or modal flows.
- Use existing spacing and border tokens.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/agents`
- Confirm the page no longer stacks multiple horizontal dividers between the intro, active section, and paused section.

## Completion Notes

- Removed the shared intro divider for the agents dashboard by passing `border-b-0 pb-0` to `PageIntro`.
- Replaced the `Active` and `Paused` section top borders with spacing-only separation in `apps/manager/src/features/agents/agents-page.tsx`.
- Verified the result on the local mobile agents route.
