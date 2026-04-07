---
id: "feat-052"
title: "AI Video Contest Platform"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-05-01"
duration: 31
depends_on: []
blocks: []
tags:
  - "web"
  - "manager"
  - "ai-pipeline"
---

## Problem

An AI video contest needs a dedicated platform for publishing the brief, collecting entries, reviewing submissions, and showcasing winners. Without a structured platform, the team is forced into ad hoc forms, manual review, and scattered publishing.

## Entry Points — Read These First

1. `apps/web/src/app/page.tsx` — current public entrypoint pattern
2. `apps/manager/src/app/dashboard/page.tsx` — internal operator dashboard shell
3. `apps/manager/src/app/api/jobs/route.ts` — job-oriented API pattern that can inform submission/review flows
4. `apps/cms/src/api/experience/content-types/experience/schema.json` — existing content modeling pattern for public-facing pages
5. `apps/cms/config/plugins.ts` — plugin-level config surface if uploads or auth extensions are needed

## Grep These

- `dashboard` in `apps/manager/src/app/`
- `upload|artifact` in `apps/manager/src/services/`
- `experience` in `apps/cms/src/api/`
- `page.tsx` in `apps/web/src/app/`

## What To Build

1. Define the public contest flow: brief, rules, submission, review, shortlist, and showcase.
2. Decide which surfaces belong in `apps/web`, which belong in `apps/manager`, and what data is stored in CMS.
3. Model contest entities and submission status transitions so review work is auditable.
4. Support media upload or linked-asset submission without forcing reviewers to work outside the platform.
5. Publish a winner/showcase surface that can live beyond the submission window.

## Constraints

- Do NOT hide submission state inside spreadsheets or ad hoc email threads.
- Keep public submission UX separate from internal judging and moderation tools.
- Prefer CMS-backed copy and rules so contest content can be updated without redeploying everything.

## Verification

- A user can discover the contest brief and submit an entry
- Reviewers can see submitted entries and move them through review states
- Winning entries can be published on a public-facing showcase page
