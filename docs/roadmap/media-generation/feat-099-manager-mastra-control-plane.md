---
id: "feat-099"
title: "Manager Mastra Control Plane for Shared Video Agents"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-17"
duration: 14
depends_on:
  - "feat-097"
  - "feat-098"
blocks:
  - "feat-100"
tags:
  - "manager"
  - "ai-pipeline"
  - "agents"
  - "mastra"
  - "control-plane"
---

## Problem

The current Manager shared-agent slice proves a curated Mastra-backed catalog, but it still behaves like a prompt workbench: one-shot runs, no typed tools, no approval-gated write path, no reusable session control plane, and no durable structure for other Forge apps to consume. Operators can draft video metadata and SEO ideas, but they cannot safely move from grounded reasoning to approval-gated application inside a shared runtime owned by Manager.

## Entry Points — Read These First

1. `packages/agents/src/catalog.ts` — current Mastra agent factory and validation boundary
2. `packages/agents/src/definitions.ts` — current shared-agent catalog metadata
3. `apps/manager/src/features/agents/shared-agent-runtime.ts` — current one-shot execution path
4. `apps/manager/src/features/agents/shared-agent-video-library.ts` — canonical library-video search and hydration logic that should become typed tools
5. `apps/manager/src/features/agents/shared-agent-contract.ts` — current Manager-side catalog/run contracts
6. `apps/manager/src/features/agents/shared-agent-workbench.tsx` — current workbench UI that must evolve to sessions + approvals without losing the usable baseline
7. `apps/manager/src/services/openrouter.ts` — existing provider and structured-output helper posture inside Manager
8. `apps/manager/src/cms/client.ts` — authenticated CMS GraphQL client boundary
9. `docs/roadmap/media-generation/feat-097-manager-shared-mastra-agents.md` — starter shared-agent baseline
10. `docs/roadmap/media-generation/feat-098-manager-library-video-aware-shared-agents.md` — video-aware follow-up baseline
11. `https://mastra.ai/agents` — current Mastra primitives overview
12. `https://mastra.ai/workflows` — current workflow capabilities
13. `https://mastra.ai/reference/agents/network` — multi-agent network contract
14. `https://mastra.ai/blog/tool-approval` — current tool approval guidance
15. `https://github.com/mastra-ai/mastra/releases` — release train and version reference

## Grep These

- `shared-agent|agents-page|automation` in `apps/manager/src/features/agents/`
- `video(documentId|videos(filters` in `apps/manager/src/`
- `createStructuredOpenrouterOutput|DEFAULT_MODEL` in `apps/manager/src/services/`
- `updateVideo|createEnrichmentJob|updateEnrichmentJob` in `apps/manager/src/` and `packages/graphql/src/`
- `@mastra/core|@openrouter/ai-sdk-provider` in `packages/` and `apps/manager/package.json`

## What To Build

1. Upgrade the shared agent runtime from the current Mastra `0.16.x` slice to a current 1.x-compatible posture in a controlled package update.
2. Keep `packages/agents` app-agnostic, but expand it to describe structured capabilities, typed result shapes, and specialist agent metadata for session-based use.
3. Add a Manager-owned Mastra control-plane runtime that registers:
   - specialist agents
   - a supervisor/network agent
   - typed tools for library-video reads and Manager-owned writes
   - approval-gated write actions
   - workflow-backed translation and SEO apply paths
   - runtime context, session tracing metadata, and memory/session scaffolding
4. Replace one-shot agent runs with session-based Manager APIs:
   - `POST /api/agents/sessions`
   - `GET /api/agents/sessions/:id`
   - `POST /api/agents/sessions/:id/messages`
   - `POST /api/agents/approvals/:id`
     while keeping the current `/api/agents/:id/run` route as a compatibility bridge during migration.
5. Evolve the Manager workbench so operators can:
   - start a session from a selected agent or supervisor
   - operate on a real library video
   - inspect structured results and draft patches
   - approve or decline pending write actions
   - keep the current automations surface intact below the session UI
6. Add focused observability/eval scaffolding so translation and SEO results can be inspected, scored, and regressed before broader rollout.

## Constraints

- Manager remains the only Mastra runtime host in this slice; do not add a separate Mastra service.
- Do not make other apps depend directly on `apps/manager`; share only app-agnostic contracts through `packages/agents`.
- Approval-gated apply is the default for CMS metadata writes and enrichment follow-up triggers.
- Keep Manager auth and CMS credentials Manager-owned; no shared package may read env vars directly.
- Preserve the current library-video and compatibility run flows during migration; do not strand the working baseline.
- Keep mutating tools tightly scoped to allowed metadata fields and Manager-auditable actor/session data.
- Avoid adding internal MCP exposure in this slice unless it is strictly required for the control-plane runtime.

## Verification

- `packages/agents` exports session-capable shared metadata and typed result contracts without Manager-only dependencies.
- Manager exposes session, message, and approval routes that can drive Translation and SEO flows against real library videos.
- Mutating actions require an approval step before any CMS metadata update or follow-up enqueue occurs.
- The Manager workbench shows structured results, pending approvals, and compatibility with the existing video-selection flow.
- Focused tests cover:
  - tool schema and runtime-context gating
  - session store and approval lifecycle
  - translation and SEO workflow happy paths
  - session and approval API contracts
  - `/api/agents/:id/run` compatibility behavior
- Focused checks pass:
  - `pnpm --filter @forge/agents test`
  - `pnpm --filter @forge/agents typecheck`
  - `pnpm --filter @forge/manager test`
  - `pnpm --filter @forge/manager typecheck`
  - `pnpm --filter @forge/manager lint`
  - `git diff --check`
