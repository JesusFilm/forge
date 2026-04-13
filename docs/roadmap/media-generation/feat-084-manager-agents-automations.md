---
id: "feat-084"
title: "Manager Agents Automations"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-14"
duration: 14
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "cms"
  - "ai-pipeline"
---

## Problem

Operators can manually create enrichment jobs from the Manager dashboard, but there is no persistent automation surface for recurring work like finding videos without subtitles, translating missing subtitle languages, enriching missing metadata, or filling missing transcript embeddings. Without scheduled automations, backlog cleanup depends on manual report filtering and repeated job creation.

## Entry Points -- Read These First

1. `docs/brainstorms/2026-04-12-manager-agents-automations-requirements.md` -- chosen product shape and resolved decisions
2. `apps/manager/src/features/nav/dashboard-nav.tsx` -- dashboard tab pattern for `Report` and `Jobs`
3. `apps/manager/src/app/dashboard/layout.tsx` -- shared dashboard shell where the tab appears
4. `apps/manager/src/app/api/enrich/route.ts` -- current API that creates enrichment jobs from selected videos/languages
5. `apps/manager/src/features/coverage/coverage-report-client.tsx` -- current report selection and enrichment UI behavior
6. `apps/cms/config/cron-tasks.ts` -- Strapi cron precedent for scheduled tasks
7. `apps/cms/src/api/enrichment-job/content-types/enrichment-job/schema.json` -- durable job state pattern
8. `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md` -- claim-first and capped background work precedent

## Grep These

- `DashboardNav|header-nav-link` in `apps/manager/src/` -- Manager navigation and active tab styling
- `api/enrich|runVideoEnrichment|createJob` in `apps/manager/src/` -- job creation and workflow dispatch
- `coverageStatus|ReportType|selectedLanguageIds` in `apps/manager/src/features/coverage/` -- current coverage-driven selection model
- `cronTasks|CORE_SYNC_CRON|COVERAGE_SNAPSHOT_CRON` in `apps/cms/` -- cron registration and schedule env patterns
- `EnrichmentJob|JobRecord|WorkflowStepName` in `apps/manager/src/` and `apps/cms/src/api/` -- durable job state and workflow steps

## What To Build

1. Add an `Agents` tab to the Manager dashboard with active/current and paused automation sections plus a `New automation` action.
2. Add a template-driven automation creation flow for:
   - videos missing source subtitles
   - videos missing target-language subtitles/translations
   - videos missing metadata
   - videos missing transcript embeddings
   - scene embeddings when the existing enrichment scene-analysis sync path is available for the selected scope
3. Let each automation choose:
   - schedule period/time, transformed to cron-compatible execution
   - max jobs/videos per cycle, such as 6 videos per minute
   - `missing only` or `refresh AI-generated too`
   - target languages only when required by the chosen template
4. Store automation definitions durably in CMS and execute due automations from a Strapi cron-style scheduler.
5. Have each scheduler cycle find eligible videos, enqueue at most the per-cycle cap, and remain active even when the eligible set is empty.
6. Record run attempts and counts so Manager can show no-op, partial, failed, and successful cycles.

## Constraints

- Do not build free-form agent instructions in V1; use constrained templates.
- Do not rely on browser sessions for scheduled execution.
- Do not process more videos than the per-cycle cap in a single automation run.
- Do not mark an automation complete just because no eligible videos exist; it keeps checking until paused.
- Do not require target languages for metadata or embedding templates unless the template explicitly uses a language filter.
- Keep cron input narrow in V1: minute/hour/day/week style schedules from UI controls, not arbitrary user-authored cron strings.

## Verification

- Manager dashboard shows `Agents` as an active tab and lists active and paused automations.
- Creating an every-minute automation with a cap of 6 enqueues no more than 6 eligible jobs per scheduler cycle.
- A no-eligible-video cycle records a no-op run and keeps the automation active.
- Pausing an automation prevents future cycles from enqueueing work.
- Subtitle/translation templates require target languages; metadata and embedding templates do not.
- Refresh mode changes eligibility between missing-only and refresh-AI-generated behavior.
- Scheduler execution works without an open Manager browser session.
