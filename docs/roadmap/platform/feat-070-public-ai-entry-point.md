---
id: "feat-070"
title: "Public AI Entry Point"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-12-01"
duration: 31
depends_on:
  - "feat-066"
  - "feat-068"
  - "feat-069"
blocks: []
tags:
  - "platform"
  - "public-ai"
  - "shared"
---

## Problem

This is shared work between Vlad and Tatai. After generation, validation, and account systems are in place, the platform can expose a public AI entry point. That surface needs to be safe, observable, and connected to the rest of the content system rather than acting like a disconnected demo.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-066-llm-steering-system-rag-and-guardrails.md` — AI safety and retrieval foundation
2. `docs/roadmap/platform/feat-068-partner-publishing-and-user-accounts.md` — account and permission model
3. `docs/roadmap/topic-experiences/feat-069-validated-topic-pages.md` — validated content destination
4. `apps/web/src/app/page.tsx` — likely public entry surface
5. `apps/manager/src/app/api/auth/login/route.ts` — auth pattern baseline

## Grep These

- `auth` in `apps/manager/src/app/api/`
- `page.tsx` in `apps/web/src/app/`
- `guardrail` in `docs/roadmap/platform/`
- `topic page` in `docs/roadmap/topic-experiences/`

## What To Build

1. Define the public AI interaction surface, its scope, and the content destinations it can create or recommend.
2. Reuse the steering, account, and validation layers so the public AI surface inherits the same safety model.
3. Add the operational visibility needed to understand usage, failures, and abuse patterns.
4. Keep the entry point connected to publishable content flows instead of isolating it as a novelty feature.

## Constraints

- Do NOT expose public AI generation without the guardrails and account model in place.
- Prefer a narrow, well-defined entrypoint over a vague "chat can do anything" surface.
- Keep logs and moderation signals available to operators.

## Verification

- A public user can reach the AI entry surface within the intended scope
- Guardrails, account checks, and validated content flows all participate in the request path
- Operators can inspect usage and intervene when something goes wrong
