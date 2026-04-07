---
id: "feat-069"
title: "Validated Topic Pages"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-11-01"
duration: 61
depends_on:
  - "feat-059"
  - "feat-067"
blocks:
  - "feat-070"
tags:
  - "topic-pages"
  - "validation"
  - "shared"
---

## Problem

This is shared work between Vlad and Tatai. AI-assisted topic pages are only safe to scale if quality and doctrinal review are part of the publication contract. We need topic pages whose generation, validation, and publish state all line up.

## Entry Points — Read These First

1. `docs/roadmap/topic-experiences/feat-059-ai-assisted-topic-page-generation-and-flows.md` — page-generation workflow
2. `docs/roadmap/platform/feat-067-doctrinal-validation-engine.md` — validation layer
3. `apps/cms/src/api/experience/content-types/experience/schema.json` — stored page content
4. `apps/web/src/app/[slug]/[locale]/page.tsx` — page consumer
5. `apps/web/src/lib/content.ts` — topic/experience query layer

## Grep These

- `topic` in `docs/roadmap/topic-experiences/`
- `validation` in `docs/roadmap/platform/`
- `experience` in `apps/cms/src/api/experience/`
- `GetExperience|GetTopic` in `apps/web/src/lib/content.ts`

## What To Build

1. Attach validation state and publish readiness to AI-assisted topic pages.
2. Ensure generated topic pages cannot skip review and validation gates accidentally.
3. Keep the front-end contract simple: consumers should read only validated, publishable topic pages.
4. Support editorial overrides when a page needs manual fixes after validation.

## Constraints

- Do NOT mix draft, unvalidated, and published page states into one ambiguous status.
- Avoid front-end special cases for unsafe content; the publish contract should handle that upstream.
- Keep the validation signal visible in CMS/editor workflows.

## Verification

- A topic page cannot be published until validation requirements are met
- Validated topic pages render normally through the existing consumer contract
- Editors can identify and fix pages that failed validation
