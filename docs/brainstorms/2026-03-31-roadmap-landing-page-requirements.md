---
date: 2026-03-31
topic: roadmap-landing-page
---

# Roadmap Landing Page

## Problem Frame

The roadmap app currently drops all visitors straight into a data-heavy dashboard (stats, timeline grid, sidebar navigation). This works for the team but is disorienting for stakeholders, leadership, or anyone who lands here by accident. The home page should welcome people, orient them to what the Digital Strategies department is building, and gently redirect casual visitors who were looking for jesusfilm.org.

## Requirements

- R1. The `/` route becomes a landing page with no sidebar. It should feel like a welcoming entry point, not a project management tool.
- R2. A warm signpost near the top of the page gently directs non-stakeholder visitors to jesusfilm.org. Always visible, not dismissive. Something like: "Looking for Jesus Film? Visit jesusfilm.org"
- R3. The page should communicate what the Digital Strategies AI team is working on at a high level, exciting enough for stakeholders to want to explore further. Draw from the roadmap data (focus areas, in-progress highlights, momentum).
- R4. Show 3-5 recently completed features as compact highlight cards (title, completion date, link to full ticket). Demonstrates real momentum and shipped work.
- R5. Prominent CTA(s) within the page body to "Explore the Roadmap" that navigate into the dashboard and detailed views where the sidebar appears.
- R6. The current dashboard (stats + timeline grid) moves to `/dashboard`. All existing functionality preserved.
- R7. The `/about` page remains separate and unchanged. The landing page is lighter and more inviting; `/about` has the full story (mission, team, principles, timeline).
- R8. Home (`/`) and About (`/about`) share a top navigation bar with three links: Home, About, Dashboard. No sidebar on these routes. Clean and minimal.
- R9. On mobile, the top nav collapses to a hamburger/popout menu (similar pattern to the existing sidebar mobile toggle).
- R10. All other routes (`/dashboard`, `/lane/*`, `/person/*`, `/ticket/*`, `/experiments`) keep the sidebar layout as-is. The top nav does not appear on sidebar routes.

## Success Criteria

- A stakeholder visiting `/` understands what the team is doing and can navigate deeper with one click.
- A casual visitor who expected jesusfilm.org sees a clear, friendly link to get there.
- The existing dashboard is fully preserved at `/dashboard` with no functional regressions.
- The landing page reads completed features dynamically from `docs/roadmap/` (no hardcoded lists).

## Scope Boundaries

- No changes to `/about`, `/experiments`, lane, person, or ticket pages.
- No new data sources. Everything comes from the existing `docs/roadmap/` markdown files via `lib/features.ts`.
- No authentication or role-based routing. The signpost is passive, not a gate.
- No design system or component library. Continue using Tailwind directly as the rest of the app does.

## Key Decisions

- **Keep /about separate**: The landing page is a lighter entry point. /about retains the full narrative (mission, focus areas, team, principles, quarterly timeline).
- **Warm signpost, not a gate**: The jesusfilm.org redirect is a visible but friendly element near the top, not a modal or interstitial.
- **Highlight cards for completed work**: 3-5 most recently completed features shown as compact cards, not a full list or rich showcase.
- **Shared top nav for public pages**: Home and About get a clean top nav (Home, About, Dashboard) with mobile popout. No sidebar on these routes.
- **No dropdown in top nav**: Lanes and people are internal navigation — accessible via the sidebar once you enter the dashboard. Keeps the landing pages welcoming, not tool-like.
- **CTAs within page body**: In addition to the top nav, the landing page has prominent in-page buttons to explore the roadmap.
- **Dashboard moves to /dashboard**: Clean separation between the public-facing landing page and the team's working view.

## Dependencies / Assumptions

- The sidebar component already supports conditional rendering (it's a client component that can be hidden via layout).
- `lib/features.ts` already provides `getAllFeatures()` with status and dates, which is sufficient to pull recently completed features.

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R8-R10][Technical] Best approach for two layout zones: a Next.js route group like `(public)` for home+about with top nav, and `(app)` for dashboard+sidebar routes?
- [Affects R4][Technical] How to sort "recently completed" — by `start_date + duration` (computed end date) or by file modification time?
- [Affects R1][Needs research] What content to feature on the landing page hero beyond the signpost and CTAs — a tagline, a brief paragraph about the department's mission, or something pulled from the roadmap data?

## Next Steps

-> `/ce:plan` for structured implementation planning
