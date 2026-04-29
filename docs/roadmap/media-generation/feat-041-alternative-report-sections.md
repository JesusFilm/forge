---
id: "feat-041"
title: "Alternative Report Sections"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-05-26"
duration: 14
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "reporting"
  - "ai-pipeline"
---

## Problem

The manager app distinguishes subtitles, audio, and metadata conceptually, but reporting still feels too generalized. Operators need dedicated report sections with metrics and workflows tuned to each output domain so they can answer the right question without mentally translating one generic report.

## Entry Points — Read These First

1. `apps/manager/src/features/coverage/coverage-report-client.tsx` — current report structure, report types, and shared filtering model
2. `apps/manager/src/app/dashboard/coverage/page.tsx` — current coverage entry point
3. `apps/manager/src/features/coverage/LanguageGeoSelector.tsx` — shared filtering and navigation patterns
4. `apps/manager/src/app/global-shell.tsx` and `apps/manager/src/features/nav/dashboard-nav.tsx` — dashboard route/navigation patterns

## Grep These

- `ReportType|REPORT_CONFIG` in `apps/manager/src/features/coverage/coverage-report-client.tsx`
- `coverage` in `apps/manager/src/app/` and `apps/manager/src/features/`
- `voiceover|metadata|translation` in `apps/manager/src/services/`

## What To Build

1. Add dedicated report sections for `Subtitles`, `Audio / Voiceover`, and `Metadata`.
2. Give each section output-specific metrics, filters, and row or card design.
3. Preserve shared navigation and language-filter behavior across the sections.
4. Deep-link from report rows into detailed transparency or playback workflows when needed.

## Constraints

- Do NOT collapse this feature into the per-video transparency workspace; this is a report-navigation and summary feature.
- Do NOT introduce a separate analytics stack for v1.
- Keep the first version grounded in existing manager routing and filter patterns.

## Verification

- Users can switch between distinct report sections without losing shared context.
- Subtitle, audio, and metadata sections each expose domain-appropriate metrics.
- Report rows can open the correct downstream detail workflow.
