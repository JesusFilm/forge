---
id: "feat-322"
title: "Video Pipelines coverage dashboard (Manager)"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-28"
duration: 3
depends_on: []
blocks: []
tags:
  - "manager"
---

## Problem

Manager's Studio dashboard only tracks per-language coverage for Subtitles,
Audio, and Meta. There is no operator-facing view for tracking the
development and status of video _production_ workflows (e.g. the devotional
video pipeline in feat-286 through feat-293), which produce a full "web" cut
and a "social short" cut per day rather than per-language coverage.

## Entry Points — Read These First

1. `apps/manager/src/features/shell/manager-shell.tsx` — `ManagerShellReportType`,
   `reportOptions`, `StudioReportSwitcher` (the dropdown shown in the
   screenshot this ticket originated from).
2. `apps/manager/src/features/coverage/coverage-report-client.tsx` — reference
   implementation for collection cards (expand/collapse), the hover detail
   bar, per-video tile selection, and the job-order sidebar action button.
3. `apps/manager/src/features/coverage/enrich-action-controls.tsx` — the
   "Enrich Now" sidebar action button reused (with a configurable label) for
   this dashboard's "Run Now" action.
4. `apps/manager/src/features/enrich-selection.ts` — generic selection/outcome
   types (`EnrichFeedback`, `resolveEnrichSelectionOutcome`) to follow for the
   new run-selection outcome resolver.

## Grep These

- `ReportType` / `REPORT_CONFIG` — existing per-report-type configuration
  pattern to extend cautiously (do not add `"ai"` semantics to the new report
  type).
- `ManagerShellReportType` — the shell-level report union that also needs the
  new value.
- `CoverageNumberDiagram` / `CoverageBar` — existing 3-segment (human/ai/none)
  stat renderers; the new report type needs its own 2-segment variant rather
  than bending these.

## What To Build

A new `/dashboard/video-pipelines` page and report-switcher entry
("Video Pipelines" — "Track the development and status of video production
workflows.") showing one mock container, "Devotions - August" (tag: Basic),
with 31 cells (one per day). Each cell shows independent mobile/desktop
generated-state icons (gray = not generated, green = generated), a
thumbnail/title/date hover preview (replacing the coverage report's
description text), and a click-to-select flow into a job-order sidebar with
a "Run Now" action (instead of "Enrich Now"). No AI percentage segment for
this report type — see the implementation plan for the exact design.

## Constraints

- Do not wire real video-generation dispatch — this ticket is UI/dashboard
  scaffolding only. `Run Now` calls a stub API route.
- Do not modify the shared `CoverageBar`/`CoverageNumberDiagram` components'
  segment set — build a small local 2-segment equivalent instead, to avoid
  regressing the subtitle/audio/meta reports.
- Do not add a per-language dimension to this report type.

## Verification

- `/dashboard/video-pipelines` renders under the new switcher entry with the
  "Devotions - August" collection, 31 cells, and no AI stat tile.
- `pnpm --filter @forge/manager test` and `pnpm --filter @forge/manager typecheck`
  pass.

See implementation plan: `docs/plans/2026-07-28-002-feat-video-pipelines-report-plan.md`.
