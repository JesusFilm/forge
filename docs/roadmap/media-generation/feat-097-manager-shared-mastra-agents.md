---
id: "feat-097"
title: "Manager Shared Mastra Agents"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-16"
duration: 10
depends_on:
  - "feat-084"
blocks:
  - "feat-098"
  - "feat-099"
tags:
  - "manager"
  - "ai-pipeline"
  - "agents"
---

## Problem

The Manager app already supports recurring enrichment automations, but it does not yet provide a reusable shared-agent runtime for broader AI workflows such as translation, video enhancement, SEO, and marketing support. Without a shared agent catalog, every app would need to invent its own prompts, runtime wiring, and capability surface, which makes cross-app reuse brittle and inconsistent.

## Entry Points — Read These First

1. `apps/manager/src/features/agents/agents-page.tsx` — current Manager `Agents` dashboard surface that now only exposes enrichment automations
2. `apps/manager/src/features/agents/automation-contract.ts` — current agent/automation naming and contract boundary inside Manager
3. `apps/manager/src/app/dashboard/agents/page.tsx` — server entry point for the Manager Agents dashboard
4. `apps/manager/src/config/env.ts` — validated env var boundary for new agent runtime settings
5. `apps/manager/src/services/openrouter.ts` — current AI provider pattern inside Manager
6. `packages/README.md` and `packages/video-player/package.json` — shared package precedent for cross-app reuse
7. `docs/roadmap/media-generation/feat-084-manager-agents-automations.md` — V1 constrained automation baseline
8. `https://mastra.ai/reference/agents/agent` — Mastra `Agent` class contract
9. `https://www.npmjs.com/package/@mastra/core` — current published package/version reference

## Grep These

- `AgentsPage|automation-form|automation-list` in `apps/manager/src/features/agents/`
- `authenticateRequest|authenticateServiceBearerRequest` in `apps/manager/src/lib/`
- `OPENROUTER_API_KEY|createEnv` in `apps/manager/src/config/`
- `package.json|exports` in `packages/`
- `translation|seo_improvements|metadata` in `apps/manager/src/`

## What To Build

1. Add a shared package in `packages/` that defines reusable Mastra-backed agent descriptors for at least:
   - Translation Agent
   - Video Enhancing Agent
   - SEO Agent
   - Marketing Agent
2. Keep the shared package app-agnostic so other apps can import the same agent catalog and definitions later without importing Manager-only UI code.
3. Add a Manager server runtime that instantiates and executes those agents through Mastra using the repo's existing AI-provider posture.
4. Add authenticated Manager API routes to:
   - list the shared agent catalog
   - execute a chosen shared agent with structured input
5. Extend the Manager `Agents` page so it has:
   - a shared agent library/workbench section
   - starter guidance for each built-in agent
   - a request form and result panel for manual execution
   - the existing recurring automations section preserved below it
6. Make the UI and runtime easy to extend with future agents without rewriting the Manager page or API route structure.

## Constraints

- Do not remove or regress the existing automation scheduler UI.
- Do not make other apps depend on `apps/manager/`; shared contracts must live in `packages/`.
- Do not hardcode secrets or bypass `apps/manager/src/config/env.ts`.
- Do not introduce free-form user-authored agent definitions in this slice; ship a curated shared catalog first.
- Prefer one generic execution route shape for the curated agents instead of one bespoke route per starter agent.
- Keep the initial output contract text-first unless a structured result is truly required for the first slice.

## Verification

- Manager `Agents` dashboard renders a shared agent section alongside the existing automation UI.
- The shared package exports starter agent definitions that can be imported without Manager-only dependencies.
- Authenticated Manager callers can list the shared agent catalog and execute Translation, Video Enhancing, SEO, and Marketing agents through the API.
- Focused tests cover agent catalog normalization/validation plus the new Manager API routes.
- Focused checks pass:
  - `pnpm --filter @forge/agents test`
  - `pnpm --filter @forge/agents typecheck`
  - `pnpm --filter @forge/manager test`
  - `pnpm --filter @forge/manager typecheck`
  - `git diff --check`
