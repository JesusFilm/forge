---
title: "feat: Add welcoming landing page to roadmap app"
type: feat
status: active
date: 2026-03-31
origin: docs/brainstorms/2026-03-31-roadmap-landing-page-requirements.md
---

# feat: Add welcoming landing page to roadmap app

## Overview

Restructure the roadmap app so `/` is a welcoming landing page for stakeholders and visitors, not the data-heavy dashboard. The dashboard moves to `/dashboard`. Home and About pages get a shared top navigation bar instead of the sidebar. All other routes keep the sidebar layout unchanged.

## Problem Frame

The roadmap app currently drops all visitors into a project management dashboard (stats, timeline grid, sidebar). This is disorienting for stakeholders, leadership, or anyone who lands here accidentally. The home page should welcome people, show momentum, and gently redirect casual visitors to jesusfilm.org. (see origin: docs/brainstorms/2026-03-31-roadmap-landing-page-requirements.md)

## Requirements Trace

- R1. `/` is a welcoming landing page with no sidebar
- R2. Warm signpost near the top redirecting casual visitors to jesusfilm.org
- R3. Communicate what the DS AI team is working on — focus areas, in-progress highlights, momentum
- R4. Show 3-5 recently completed features as compact highlight cards
- R5. Prominent CTA(s) to "Explore the Roadmap" linking to `/dashboard`
- R6. Current dashboard moves to `/dashboard` with all functionality preserved
- R7. `/about` page remains separate and unchanged
- R8. Home and About share a top nav bar (Home, About, Dashboard) — no sidebar
- R9. Mobile: top nav collapses to hamburger/popout menu
- R10. All other routes keep the sidebar layout as-is

## Scope Boundaries

- No changes to `/about` content, `/experiments`, lane, person, or ticket pages
- No new data sources — everything from `docs/roadmap/` via `lib/features.ts`
- No authentication or role-based routing
- No design system — continue using Tailwind directly

## Context & Research

### Relevant Code and Patterns

- `apps/roadmap/app/layout.tsx` — root layout, currently renders Sidebar for all routes
- `apps/roadmap/app/page.tsx` — current dashboard (stats + RoadmapTimeline)
- `apps/roadmap/app/about/page.tsx` — existing about page with hero, focus areas, team, principles
- `apps/roadmap/components/Sidebar.tsx` — client component with mobile hamburger toggle pattern
- `apps/roadmap/lib/features.ts` — `getAllFeatures()`, `getStatusCounts()`, `Feature` type with `start_date`, `duration`, `status`
- `apps/roadmap/app/globals.css` — CSS variables for dark theme (`--color-card`, `--color-border`, etc.)
- `public/jesusfilm-sign.svg` — logo used in sidebar and about page

### Institutional Learnings

- Roadmap app does NOT use `output: "standalone"` — route group restructuring has no deployment implications (see `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`)
- `lib/features.ts` path resolution (`../../docs/roadmap`) is relative to `cwd()`, not `app/` — route groups don't affect it
- No `railway.toml` changes needed for route restructuring

## Key Technical Decisions

- **Next.js route groups for layout separation**: `(public)` group for home + about (top nav, no sidebar), `(dashboard)` group for all other routes (sidebar, no top nav). This is the idiomatic Next.js App Router pattern for different layouts on different routes.
- **Computed end date for "recently completed" sorting**: Use `start_date + duration` to compute the end date, sort descending, take top 5. File modification time is unreliable across git operations. The data already has what we need.
- **Landing page hero content**: A brief tagline about the DS AI team's mission (lighter than `/about`), plus dynamic stats pulled from roadmap data (features shipped, in progress) to show real momentum.
- **TopNav as a client component**: Needs mobile hamburger toggle state, same pattern as existing Sidebar. Server component for the layout wrapper, client component for the nav bar itself.
- **Root layout stays minimal**: Only HTML shell, metadata, `globals.css`. No Sidebar or TopNav in root — each route group layout adds its own navigation.

## Open Questions

### Resolved During Planning

- **Route group approach**: Next.js route groups `(public)` and `(dashboard)`. Confirmed safe for deployment by institutional learnings — no `railway.toml` changes, no standalone mode issues.
- **Sorting completed features**: Computed end date (`start_date` + `duration` days), sorted descending, limited to 5 most recent. This uses existing Feature data with no new fields.
- **Hero content**: Brief mission tagline + dynamic roadmap stats. Keeps it lighter than `/about` while showing the team is active and shipping.

### Deferred to Implementation

- Exact visual layout and spacing of the landing page sections — adjust during implementation based on what looks right
- Whether the "recently completed" cards need lane labels or just title + date — decide when building the card component

## Implementation Units

- [ ] **Unit 1: Restructure app directory into route groups**

  **Goal:** Split routes into `(public)` and `(dashboard)` groups so each can have its own layout (top nav vs sidebar).

  **Requirements:** R8, R10

  **Dependencies:** None

  **Files:**
  - Create: `apps/roadmap/app/(public)/layout.tsx`
  - Create: `apps/roadmap/app/(dashboard)/layout.tsx`
  - Modify: `apps/roadmap/app/layout.tsx` — strip Sidebar, keep only HTML shell + metadata + globals
  - Move: `apps/roadmap/app/about/page.tsx` → `apps/roadmap/app/(public)/about/page.tsx`
  - Move: `apps/roadmap/app/experiments/page.tsx` → `apps/roadmap/app/(dashboard)/experiments/page.tsx`
  - Move: `apps/roadmap/app/lane/` → `apps/roadmap/app/(dashboard)/lane/`
  - Move: `apps/roadmap/app/person/` → `apps/roadmap/app/(dashboard)/person/`
  - Move: `apps/roadmap/app/ticket/` → `apps/roadmap/app/(dashboard)/ticket/`
  - Keep: `apps/roadmap/app/robots.ts` at root (not route-specific)

  **Approach:**
  - Root `layout.tsx` becomes a thin shell: `<html>`, `<body>`, metadata, globals import. No navigation components.
  - `(dashboard)/layout.tsx` takes over the current root layout's job: renders `<Sidebar>`, wraps children in `<main className="min-h-screen pt-12 md:ml-56 md:pt-0"><div className="p-4 md:p-8">`.
  - `(public)/layout.tsx` is a placeholder for now (just passes children through) — TopNav added in Unit 2.
  - All existing pages move into their respective groups. No content changes to any page.

  **Patterns to follow:**
  - Current root `layout.tsx` for the dashboard layout structure
  - Next.js App Router route group conventions

  **Verification:**
  - `pnpm --filter roadmap build` succeeds
  - All existing routes render identically to before (sidebar pages have sidebar, about page works)
  - No 404s on any existing route

- [ ] **Unit 2: Create TopNav component and wire into (public) layout**

  **Goal:** Build the shared top navigation bar for Home and About pages, with mobile hamburger popout.

  **Requirements:** R8, R9

  **Dependencies:** Unit 1

  **Files:**
  - Create: `apps/roadmap/components/TopNav.tsx`
  - Modify: `apps/roadmap/app/(public)/layout.tsx` — add TopNav

  **Approach:**
  - Client component (`'use client'`) — needs `useState` for mobile menu toggle and `usePathname` for active link highlighting
  - Three links: Home (`/`), About (`/about`), Dashboard (`/dashboard`)
  - Desktop: horizontal link bar with logo on the left, links on the right
  - Mobile: hamburger icon that toggles a dropdown/overlay menu (mirror the Sidebar mobile toggle pattern — `useState`, overlay div, translate animation)
  - Use the `jesusfilm-sign.svg` logo, same as Sidebar
  - Active link styling: match Sidebar's `bg-gray-800 text-white` pattern
  - Dark theme: use existing CSS variables (`--color-card`, `--color-border`)
  - `(public)/layout.tsx` renders `<TopNav />` then `<main>` with centered content and appropriate padding

  **Patterns to follow:**
  - `apps/roadmap/components/Sidebar.tsx` — mobile toggle state, overlay, slide animation, active link detection, logo placement

  **Verification:**
  - Top nav visible on `/about` with three working links
  - Mobile: hamburger opens/closes menu
  - Active link highlights correctly
  - No sidebar visible on `/about`

- [ ] **Unit 3: Move dashboard to /dashboard route**

  **Goal:** Relocate the current dashboard page from `/` to `/dashboard` so the root route is free for the landing page.

  **Requirements:** R6

  **Dependencies:** Unit 1

  **Files:**
  - Move: `apps/roadmap/app/page.tsx` → `apps/roadmap/app/(dashboard)/dashboard/page.tsx`

  **Approach:**
  - Move the file as-is into the dashboard route group. No content changes needed — all imports (`@/lib/features`, `@/components/RoadmapTimeline`) use path aliases that are unaffected by the move.
  - Update Sidebar links: change the "Dashboard" link `href` from `/` to `/dashboard`
  - Update any other internal links that point to `/` expecting the dashboard (check TopNav from Unit 2 — its Dashboard link should already point to `/dashboard`)

  **Files (also modify):**
  - Modify: `apps/roadmap/components/Sidebar.tsx` — update Dashboard link href to `/dashboard`

  **Patterns to follow:**
  - Existing dashboard page structure

  **Verification:**
  - `/dashboard` renders the full dashboard (stats, legend, timeline) identically to the current `/`
  - Sidebar "Dashboard" link navigates to `/dashboard`
  - `/` returns a 404 or empty page (landing page not yet created)

- [ ] **Unit 4: Build the landing page**

  **Goal:** Create the welcoming home page at `/` with mission intro, momentum stats, recently completed features, and CTAs.

  **Requirements:** R1, R2, R3, R4, R5

  **Dependencies:** Unit 1, Unit 2, Unit 3

  **Files:**
  - Create: `apps/roadmap/app/(public)/page.tsx`

  **Approach:**
  - Server component — all data comes from `lib/features.ts` at render time
  - **Section 1 — Warm signpost**: A subtle but visible bar or banner near the top: "Looking for Jesus Film? Visit jesusfilm.org →". Styled gently — not an alert, more like a helpful note. Link opens in new tab.
  - **Section 2 — Hero**: Logo + brief tagline about the Digital Strategies AI team's mission. One or two sentences max — lighter than the `/about` hero. Something grounded in the existing `/about` description but shorter.
  - **Section 3 — Momentum stats**: Dynamic numbers pulled from `getStatusCounts(getAllFeatures())` — features completed, in progress, total. Compact stat cards similar to the dashboard but styled for a landing page context.
  - **Section 4 — Recently completed**: 3-5 compact cards showing recently shipped features. Each card: title, lane label, computed completion date. Links to `/ticket/[id]`. Sort by computed end date (`start_date` + `duration` days), descending, filter to `status: "complete"`, take first 5.
  - **Section 5 — CTA**: Prominent "Explore the Roadmap →" button linking to `/dashboard`. Optionally a secondary link to `/about` for "Learn more about our mission".
  - Use existing CSS variables and Tailwind patterns from the rest of the app. Center-aligned, max-width container like the about page (`mx-auto max-w-4xl`).

  **Patterns to follow:**
  - `apps/roadmap/app/about/page.tsx` — section spacing (`space-y-20`), card styling, max-width container
  - `apps/roadmap/app/page.tsx` (dashboard) — StatCard component pattern, status count usage
  - `apps/roadmap/components/StatusBadge.tsx` — lane/status color conventions

  **Test scenarios:**
  - Page renders with real data from `docs/roadmap/`
  - Completed features appear in correct order (most recently finished first)
  - All links work: jesusfilm.org (external, new tab), /dashboard, /about, /ticket/[id]
  - Page looks good with 0 completed features (edge case — graceful empty state)
  - Page looks good with many completed features (only shows 5)

  **Verification:**
  - `/` renders the landing page with all 5 sections
  - No sidebar visible
  - Top nav visible with Home highlighted as active
  - jesusfilm.org signpost link works
  - "Explore the Roadmap" navigates to `/dashboard`
  - Recently completed cards link to correct ticket pages
  - `pnpm --filter roadmap build` succeeds

## System-Wide Impact

- **Interaction graph:** Sidebar links updated (Dashboard href change). TopNav is a new component with no callbacks or side effects beyond navigation.
- **Error propagation:** No new error paths. Landing page uses same `getAllFeatures()` that already handles missing/malformed files gracefully.
- **State lifecycle risks:** None. All data is read-only from filesystem at request time. No caching layer.
- **API surface parity:** No API. Internal navigation only.
- **Integration coverage:** Build verification (`pnpm --filter roadmap build`) confirms route group structure is valid. Manual navigation testing confirms all routes still work.

## Risks & Dependencies

- **Route group restructuring breaking existing routes**: Low risk. Route groups are parenthesized and don't affect URL paths. Mitigated by build verification after Unit 1.
- **Sidebar link href change**: The Dashboard link in Sidebar changes from `/` to `/dashboard`. If any other code links to `/` expecting the dashboard, it will land on the new landing page instead. Mitigated by searching for internal `href="/"` references.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-31-roadmap-landing-page-requirements.md](docs/brainstorms/2026-03-31-roadmap-landing-page-requirements.md)
- Related code: `apps/roadmap/app/layout.tsx`, `apps/roadmap/components/Sidebar.tsx`, `apps/roadmap/lib/features.ts`
- Institutional learning: `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md` — confirms no standalone mode, safe to restructure routes
