---
id: "feat-410"
title: "Manager dark contrast audit"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on:
  - "feat-406"
  - "feat-407"
  - "feat-408"
  - "feat-409"
blocks: []
tags:
  - "platform"
  - "manager"
  - "design-system"
  - "accessibility"
---

## Problem

The Manager dark theme has the intended warm charcoal foundation, but several
late stylesheet rules still win with light-theme literals or whole-card opacity.
Coverage labels, completed workflow states, secondary copy, disabled SEO
explanations, and empty Shorts thumbnails can therefore lose contrast or depth.

## Entry Points - Read These First

1. `apps/manager/src/app/globals.css` - Manager tokens and final cascade winners.
2. `docs/plans/2026-08-21-0913-fix-manager-dark-contrast-plan.md` - affected
   selector matrix and verification contract.

## Grep These

- `.stat-legend-item--human`
- `.jobs-step-dot-completed`
- `.jobs-progress-summary-completed`
- `.jobs-review-loading`
- `.agents-row-meta`
- `.seo-candidate-ticket.is-mismatch`
- `.shorts-picker-thumb`

## What To Build

1. Map affected dark Coverage legend consumers to the established human, AI,
   and none semantic text tokens.
2. Restore visible success treatment to completed Jobs, Smart Crop, and Shorts
   workflow summaries and indicators.
3. Map dark secondary copy to the existing muted token.
4. Keep disabled SEO mismatch explanations readable without blanket opacity.
5. Give empty and error Shorts thumbnails depth with existing surface tokens.
6. Review every affected route and interaction state in light and dark themes.

## Constraints

- Preserve light-theme rendering and the `#141414` dark sidebar.
- Do not add colors, tokens, runtime dependencies, or behavior changes.
- Do not change routing, data fetching, workflows, hydration, or theme sync.

## Verification

- Run the focused Manager theme and affected-feature tests in the linked plan.
- Run Manager TypeScript validation and changed-file formatting.
- Inspect the shared shell, Coverage, Jobs, Smart Crop, Shorts, SEO, and Agents
  routes at desktop and narrow widths in both themes.
- Measure every foreground/surface pair in the plan's affected-selector matrix.
- Confirm browser console output is clean and capture key-screen screenshots.
