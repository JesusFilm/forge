---
id: "feat-056"
title: "AI Video Template System"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-07-01"
duration: 31
depends_on: []
blocks:
  - "feat-057"
  - "feat-060"
  - "feat-062"
tags:
  - "manager"
  - "ai-pipeline"
  - "generation"
---

## Problem

As generation use cases expand, prompt and structure logic will become hard to reuse if every workflow assembles videos from scratch. We need a reusable AI video template system so contest entries, inspiration pieces, personalized videos, and shareable outputs can all start from known composition patterns instead of one-off prompt blobs.

## Entry Points — Read These First

1. `apps/manager/src/workflows/videoEnrichment.ts` — current workflow orchestration baseline
2. `apps/manager/src/services/metadata.ts` — structured prompt output pattern
3. `apps/manager/src/lib/parseLLMJson.ts` — shared JSON parsing and validation helper
4. `apps/manager/src/types/job.ts` — workflow/job type definitions
5. `docs/roadmap/media-generation/feat-052-ai-video-contest-platform.md` — downstream platform that can consume templates

## Grep These

- `role: "system"` in `apps/manager/src/services/`
- `parseLLMJson` in `apps/manager/src/`
- `WorkflowStepName|JobOptions` in `apps/manager/src/types/job.ts`
- `videoEnrichment` in `apps/manager/src/workflows/`

## What To Build

1. Define reusable template primitives for script structure, shot types, overlays, subtitles, verse callouts, and CTA variants.
2. Create a typed template registry that generation workflows can reference by ID instead of embedding all logic inline.
3. Document the minimum input contract each template needs so downstream generation systems know when a template is valid.
4. Leave room for both editorially-authored and AI-assembled templates.

## Constraints

- Do NOT bury template shape inside prompt strings alone.
- Prefer typed, inspectable template metadata over free-form configuration.
- Keep templates small enough that new use cases can compose them instead of cloning them.

## Verification

- At least two distinct generation flows can reference the same template registry
- Template inputs and outputs validate cleanly before generation starts
- Adding a new template does not require rewriting the core workflow
