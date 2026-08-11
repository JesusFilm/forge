---
id: "feat-352"
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
3. Populate five four-week blocks after August 10 with the agreed owner-led
   workstreams: access and app release; search quality and discovery; reusable
   components and NextSteps; media and language generation; and always-on agent
   operations.
4. Preserve `/contributions` as the operational, file-backed task view.
5. Keep the timeline's track labels pinned to the left while its calendar is
   scrolled horizontally.
6. On first load, position the calendar around the current week without
   overriding later manual scrolling.
7. Continue the five year-end priority blocks in the Delivery Planned row and
   mark the completed April-August phases with a clear completion treatment.

## Year-End Workstreams

1. **Access + app release (Caleb, Urim, Up):** explore streaming delivery to
   China, define the minimum releasable Mobile and TV MVP, and validate optional
   QR-code TV sign-in plus player trade-offs.
2. **Search quality + discovery (Nisal, Vlad):** improve recommendations,
   Typesense ranking, language and subtitle indexing, dead-result discovery,
   sub-second performance, and shareable search URLs.
3. **Reusable components + NextSteps (Jaco, Jian Wei, Siyang, ZY, Vlad):**
   define shared product components, present the plan to Miheret, deliver
   ministry next steps, and add account, notification, usage, and story flows.
4. **Media + language generation (Tatai, Lyuba, Caleb, Vlad):** keep video and
   experience generation running, improve language support, complete Core and
   Bible translation, and create verse pages and per-video FAQs.
5. **Always-on agent operations (Tatai, Vlad):** create service-improvement
   loops and operate SEO, maintenance, support, translation, crawler, and
   performance agents in Mastra.

## Constraints

- Keep the strategic roadmap as explicit editorial content; do not infer it
  from task status.
- Retain historical roadmap detail data while consolidating the timeline into a
  simpler delivery view.
- Do not change the filesystem-backed task data model.
- Keep each priority concise while preserving its concrete deliverables in the
  detail cards.

## Verification

- `pnpm --filter roadmap lint`
- `pnpm --filter roadmap test`
- `pnpm --filter roadmap build`
- `pnpm --filter roadmap generate:readme`
- `git diff --check`
- Browser smoke on `http://127.0.0.1:3100/roadmap` confirms one timeline spans
  April through December with only Delivery Planned and Research rows. Confirm
  the historical delivery bars show completion, the five four-week priorities
  continue in Delivery Planned, actual-history detail cards remain available,
  and `/contributions` remains linked. Confirm the track labels remain pinned
  during horizontal scrolling and the initial view includes the current week.
  Record reload-to-visible timing, rendered element count, horizontal overflow
  behavior, and console errors for the expanded timeline.
