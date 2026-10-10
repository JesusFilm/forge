---
date: 2026-04-12
topic: manager-agents-automations
related:
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/topic-experiences/feat-002-wire-enrichment-metadata-to-cms.md
  - docs/roadmap/content-discovery/feat-045-pipeline-integration.md
  - docs/solutions/platform/backfill-worker-pattern-manager-20260407.md
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
  - docs/solutions/best-practices/vector-embedding-storage-scope-sequencing-2026-04-11.md
---

# Manager Agents Automations

## What We're Building

Add an `Agents` tab to the Manager dashboard next to `Report` and `Jobs`. The tab manages scheduled enrichment automations: active and paused rows, a `New automation` action, pause/resume controls, and a creation flow that lets an operator choose a work template, schedule period, time, target languages when needed, refresh mode, and per-cycle throughput cap.

Automations keep running on their configured schedule until paused by the user. Each cycle searches for eligible videos and creates up to the configured number of jobs, such as `6 videos per minute`. If no eligible videos exist, the automation still remains active and checks again on its next scheduled cycle so newly synced or newly eligible videos can be improved later.

## Requirements

- R1. Manager exposes a new `Agents` dashboard tab using the existing dashboard navigation pattern.
- R2. The Agents page groups automations into active/current and paused sections, with schedule summary text similar to `Daily at 9:00 AM` or `Every minute`.
- R3. Creating an automation starts from constrained work templates, not free-form agent instructions.
- R4. V1 templates include: find/enrich videos missing source subtitles, find/translate videos missing target-language subtitles, find/enrich videos missing metadata, and find/enrich videos missing transcript embeddings. Scene embeddings can be included when the existing enrichment scene-analysis sync path is available for the selected content scope.
- R5. Subtitle/translation templates require target languages. Metadata and embedding templates do not require target languages unless the template itself adds a language filter.
- R6. Each automation has a refresh mode: `missing only` or `refresh AI-generated too`.
- R7. Each automation has a schedule period that is transformed into a cron-compatible schedule for execution.
- R8. Each automation has a max jobs/videos per cycle setting. The automation never processes more than that count in one run.
- R9. An active automation keeps checking forever until paused, even after the current backlog is empty.
- R10. Scheduled execution should follow the existing Strapi CMS scheduled-task model rather than relying only on a browser session.

## Why This Approach

We chose **Manager UI with a Strapi scheduler**.

Manager is the right operator surface because it already owns the enrichment dashboard, coverage selection, and job list. Strapi is the right scheduler anchor because the repo already uses Strapi cron for `core-sync` and `coverage-snapshot`, and CMS owns durable canonical state. This gives operators a focused automation UI while keeping scheduling behavior close to the existing CMS runtime model.

We considered two alternatives. A Manager-only scheduler would be simpler to wire around existing enrichment code, but it would be less aligned with the request to run these like Strapi CMS scheduled tasks. A manual-first version with `run now` only would validate the UI quickly, but it would not deliver the main behavior: active automations that keep checking until paused.

## Key Decisions

- Primary surface: build the `Agents` tab in `apps/manager`, not in Strapi admin.
- Execution model: store automation definitions durably in CMS and have a Strapi cron tick detect due automations, then ask Manager to enqueue the capped work for that cycle.
- Creation model: use templates for known enrichment jobs instead of free-form instructions.
- Throughput: schedule cadence and per-cycle cap are separate. Example: every minute, process at most 6 videos.
- Backlog behavior: running out of eligible videos is a normal no-op cycle, not completion. The automation remains active.
- Refresh behavior: each automation chooses between missing-only processing and refreshing existing AI-generated outputs too.
- Language behavior: target languages are required only for subtitle/translation templates.

## Resolved Questions

- The tab belongs in Manager dashboard.
- The first version should use constrained templates.
- Automations keep running until paused and are limited by schedule plus per-cycle job/video cap.
- Operators can choose missing-only or refresh-AI-generated behavior per automation.
- Target language selection is template-specific rather than globally required.
- The chosen architecture is Manager UI backed by Strapi-style scheduled execution.

## Planning Notes

- The implementation plan should define the CMS automation content type or table, including name, template, status, schedule, next/last run metadata, target languages, refresh mode, and per-cycle cap.
- The plan should define the Manager enqueue API contract used by the Strapi scheduler. It should reuse existing authentication patterns and avoid browser-only state.
- The eligibility query for each template should be explicit and idempotent. It should not duplicate jobs for videos already queued or running for the same automation scope.
- The scheduler should record each run attempt with counts and errors so the Agents UI can explain recent no-op cycles, partial cycles, and failures.
- Cron parsing/formatting should stay narrow for V1: minute/hour/day/week-style schedules from the UI, not arbitrary user-authored cron strings.

## Next Steps

Proceed to `/workflows:plan` with this brainstorm as input.
