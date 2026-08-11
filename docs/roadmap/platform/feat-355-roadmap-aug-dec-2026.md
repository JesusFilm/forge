---
id: "feat-355"
title: "Extend 2026 roadmap with year-end priorities"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-01"
duration: 1
depends_on: []
blocks: []
tags:
  - "roadmap"
  - "strategy"
  - "dashboard"
---

## Problem

The strategic roadmap at `/roadmap` ends on August 10 even though the team needs
calendar space to plan through the rest of 2026. The April-August plan is useful
delivery history and must remain unchanged rather than being replaced by a new
roadmap.

## Entry Points - Read These First

1. `apps/roadmap/lib/plannedRoadmap.ts` - static editorial timeline model for
   the strategic roadmap.
2. `apps/roadmap/components/PlannedRoadmapTimeline.tsx` - timeline rows,
   legends, bars, and detail-card rendering.
3. `apps/roadmap/app/(dashboard)/roadmap/page.tsx` - route-level framing and
   link to the operational task view.
4. `docs/solutions/platform/roadmap-planned-timeline-and-tasks-view-split.md` -
   why the strategic plan and live task tracker remain separate.
5. `docs/roadmap/platform/feat-109-roadmap-timeline-planned-current-modes.md` -
   original planned-timeline implementation and validation contract.

## Grep These

- `PLANNED_WEEK_COUNT|PLANNED_PHASES|PLANNED_TRACK_BARS` in `apps/roadmap/`
- `Delivery Planned|Research|future-work` in `apps/roadmap/`
- `Open Task View` in `apps/roadmap/`

## What To Build

1. Extend the existing weekly calendar from August 10 through December 31, 2026.
2. Preserve every April-August planned phase and keep actual-delivery history in
   the detail cards while removing the standalone actual-delivery timeline row.
3. Populate the five four-week windows after August 10 with one independently
   rendered block for every agreed owner-led responsibility. Do not combine
   multiple responsibilities into a shared timeline bar.
4. Preserve `/contributions` as the operational, file-backed task view.
5. Keep the timeline's track labels pinned to the left while its calendar is
   scrolled horizontally.
6. On first load, position the calendar around the current week without
   overriding later manual scrolling.
7. Continue the year-end priority blocks in the Delivery Planned row, stack
   simultaneous work so no bars overlap, and mark the completed April-August
   phases with a clear completion treatment.
8. Show each priority owner in the timeline badge and keep the title focused on
   the work itself.

## Year-End Blocks

- Caleb: China streaming exploration; metadata, translation, and language
  support.
- Urim + Up: minimum releasable Mobile and TV MVP criteria.
- Nisal: recommendations, Typesense ranking, query-language and subtitle
  indexing, dead-result discovery, and a sub-second performance budget.
- Jaco + Jian Wei: reusable-component breakdown; separate presentation to
  Miheret.
- Tatai + Lyuba: video-generation agents; background experience generation;
  service-maintenance and improvement loops.
- Siyang + ZY: NextSteps product delivery.
- Vlad: Core translation; Bible quotation translation; accounts and
  notifications; media-use forms and mission-story follow-up; next-step calls
  to action; shareable search URLs; verse video pages; per-video FAQs; and
  separate always-on SEO, support, and translation agents.

The Aug 10 AI team meeting notes refine these blocks with optional QR-based TV
authentication, no forced account barrier, custom-player release trade-offs,
Typesense ranking and language/subtitle indexing, sub-second search, crawler and
service monitoring, and the existing SEO/support agent direction.

## Constraints

- Keep the strategic roadmap as explicit editorial content; do not infer it
  from task status.
- Retain historical roadmap detail data while consolidating the timeline into a
  simpler delivery view.
- Do not change the filesystem-backed task data model.
- Keep each priority concise while preserving its concrete deliverables in the
  detail cards. Detail bullets may clarify one responsibility but must not hide
  another responsibility inside the same timeline block.
- Use owner names for year-end badges rather than repeating names in titles.

## Verification

- `pnpm --filter roadmap lint`
- `pnpm --filter roadmap test`
- `pnpm --filter roadmap build`
- `pnpm --filter roadmap generate:readme`
- `git diff --check`
- Browser smoke on `http://127.0.0.1:3100/roadmap` confirms one timeline spans
  April through December with only Delivery Planned and Research rows. Confirm
  the historical delivery bars show completion, all 21 independent four-week
  priorities continue in Delivery Planned without overlap, actual-history detail cards remain available,
  and `/contributions` remains linked. Confirm the track labels remain pinned
  during horizontal scrolling and the initial view includes the current week.
  Confirm each year-end block shows its owner badge and an action-only title.
  Record reload-to-visible timing, rendered element count, horizontal overflow
  behavior, and console errors for the expanded timeline.
