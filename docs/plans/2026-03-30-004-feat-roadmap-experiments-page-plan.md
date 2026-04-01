---
title: "feat: Add Experiments page to roadmap app"
type: feat
status: completed
date: 2026-03-30
origin: docs/brainstorms/2026-03-30-roadmap-experiments-page-requirements.md
---

# feat: Add Experiments page to roadmap app

## Overview

Add a new `/experiments` page to the roadmap app that showcases four active demo projects with non-technical descriptions, team avatars, and prominent demo links. Add a sidebar link under About for discoverability.

## Problem Frame

Stakeholders and non-technical team members need a single place to see what JFP is actively building and try each project. Currently there is no overview — people must know URLs and context independently. (see origin: docs/brainstorms/2026-03-30-roadmap-experiments-page-requirements.md)

## Requirements Trace

- R1. New `/experiments` route displaying four project cards
- R2. Each card: non-technical description, team avatars (via `getOwnerProfile`), prominent demo button(s)
- R3. Descriptions written for non-technical audience
- R4. "Experiments" link in sidebar under "About"
- R5. Four specific projects with defined teams and demo URLs (see origin doc for full detail)

## Scope Boundaries

- Static/hardcoded content only — same pattern as About page
- No analytics, filtering, or interactive features beyond demo links
- No markdown-driven content; data array in the page file

## Context & Research

### Relevant Code and Patterns

- `apps/roadmap/app/about/page.tsx` — primary pattern to follow: hardcoded data arrays, server component, `getOwnerProfile()` for avatars, Tailwind card styling with `border-[var(--color-border)] bg-[var(--color-card)]`
- `apps/roadmap/components/Sidebar.tsx` — navigation links in the top `<div>` section (lines 43-49), uses `linkClass()` for active state
- `apps/roadmap/lib/features.ts` — `getOwnerProfile()` returns `{ username, avatar }` for team member keys: `tataihono`, `nisal`, `ekkasit`, `urim`, `vlad`

### Institutional Learnings

- No relevant prior solutions in `docs/solutions/` — this is a straightforward static page addition.

## Key Technical Decisions

- **Server component**: No interactivity needed beyond links. Matches About page pattern.
- **Hardcoded data array**: Projects defined as a typed array at the top of the page file. Stable enough to not need dynamic content.
- **Content Warehouse card**: Single card with two buttons ("Manager" and "CMS") using the same button style but distinct labels.
- **Mobile "Coming Soon"**: Disabled/muted button with "Coming Soon" label instead of a link, until the Expo URL is provided.

## Open Questions

### Resolved During Planning

- **Card layout**: Use a 2-column grid on desktop (2x2), single column on mobile. Cards are large enough for readable descriptions and prominent buttons — mirrors the Focus Areas grid on About page but with 2 columns instead of 3 since cards have more content.
- **Button style**: Colored pill buttons matching the app's blue accent (`bg-blue-600 hover:bg-blue-500`). External links open in new tab (`target="_blank"`).

### Deferred to Implementation

- **Mobile Expo link**: Hardcode a "Coming Soon" state. When the URL is available, replace with a live link — a one-line change.
- **Description tone**: Final copy provided in the requirements doc. Minor tone adjustments acceptable during implementation.

## Implementation Units

- [x] **Unit 1: Add Experiments page**

  **Goal:** Create the `/experiments` route with four project cards displaying descriptions, team avatars, and demo links.

  **Requirements:** R1, R2, R3, R5

  **Dependencies:** None

  **Files:**
  - Create: `apps/roadmap/app/experiments/page.tsx`

  **Approach:**
  - Define an `EXPERIMENTS` array with typed objects: `title`, `description`, `team` (array of owner keys), `links` (array of `{ label, href }`), and an optional `comingSoon` flag
  - Server component — import `getOwnerProfile` from `@/lib/features`
  - Page layout: heading + intro paragraph, then a `grid gap-6 sm:grid-cols-2` of project cards
  - Each card: rounded border card (matching About page style), title as `h3`, description paragraph, team avatars row (reuse avatar rendering pattern from About page's team section), and one or more demo buttons
  - For Mobile App: render a muted "Coming Soon" button instead of a link
  - For Content Warehouse: render two buttons side by side ("Manager" and "CMS")
  - All external demo links open in new tab with `rel="noopener noreferrer"`
  - Add page metadata: `title: "Experiments — JFP DS AI Roadmap"`

  **Patterns to follow:**
  - `apps/roadmap/app/about/page.tsx` — data array structure, avatar rendering, card styling, metadata export

  **Verification:**
  - Page renders at `localhost:3100/experiments` with four cards
  - Each card shows description, correct team avatars, and working demo link(s)
  - Mobile App card shows "Coming Soon" instead of a link
  - Content Warehouse card shows both Manager and CMS buttons

- [x] **Unit 2: Add Experiments link to Sidebar**

  **Goal:** Add an "Experiments" navigation link under "About" in the sidebar.

  **Requirements:** R4

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `apps/roadmap/components/Sidebar.tsx`

  **Approach:**
  - Add a new `<Link>` to `/experiments` immediately after the About link in the top nav section (after line 49)
  - Use the same `linkClass("/experiments")` pattern and `onClick={close}` for mobile

  **Patterns to follow:**
  - Existing Dashboard and About links in `Sidebar.tsx` lines 44-49

  **Verification:**
  - "Experiments" link appears in sidebar below "About"
  - Link navigates to `/experiments`
  - Active state highlights correctly when on the experiments page
  - Mobile sidebar closes on tap

## System-Wide Impact

- **Minimal**: Two files touched — one new page, one sidebar modification. No shared state, no data model changes, no API surface changes.

## Risks & Dependencies

- **Low risk**: Follows an established pattern exactly. No external dependencies or data sources.
- The Mobile Expo link is TBD — the "Coming Soon" state handles this gracefully.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-30-roadmap-experiments-page-requirements.md](docs/brainstorms/2026-03-30-roadmap-experiments-page-requirements.md)
- Pattern reference: `apps/roadmap/app/about/page.tsx`
- Avatar utility: `apps/roadmap/lib/features.ts` → `getOwnerProfile()`
