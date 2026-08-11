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
- `Delivery Planned|Delivery Actual|Research` in `apps/roadmap/`
- `Open Task View` in `apps/roadmap/`

## What To Build

1. Extend the existing weekly calendar from August 10 through December 31, 2026.
2. Preserve every April-August planned, actual, agent, mobile, TV, and milestone
   item in the same timeline.
3. Populate five four-week blocks after August 10 with the agreed owner-led
   workstreams: access and app release; search quality and discovery; reusable
   components and NextSteps; media and language generation; and always-on agent
   operations.
4. Preserve `/contributions` as the operational, file-backed task view.

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
- Historical roadmap content is append-only and must remain in its original
  timeline.
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
  April through December, every original item remains visible, all five
  four-week priorities appear after August 10, and `/contributions` remains
  linked. Record reload-to-visible timing, rendered element count, horizontal
  overflow behavior, and console errors for the expanded timeline.
