---
title: "feat: Manager Mastra Control Plane for Shared Video Agents"
type: feat
status: in_progress
date: 2026-04-17
roadmap:
  - /docs/roadmap/media-generation/feat-099-manager-mastra-control-plane.md
related:
  - /docs/roadmap/media-generation/feat-097-manager-shared-mastra-agents.md
  - /docs/roadmap/media-generation/feat-098-manager-library-video-aware-shared-agents.md
branch: feat/manager-mastra-control-plane
---

# feat: Manager Mastra Control Plane for Shared Video Agents

## Overview

Upgrade the current shared-agent slice into a Manager-owned Mastra control plane with typed tools, workflow-backed translation and SEO flows, session-based APIs, approval-gated writes, and structured results that other Forge apps can consume through Manager.

## Decisions

1. Manager remains the only runtime host for this slice; no standalone Mastra service.
2. `packages/agents` stays app-agnostic and owns shared catalog/result contracts only.
3. Translation and SEO become the first workflow-backed approval flows; other agents migrate onto the same session surface but can remain draft-oriented initially.
4. Session + approval state lives in Manager and drives the workbench UI; compatibility with the existing `/run` route remains during migration.
5. Mutating actions stay Manager-owned and require explicit operator approval before touching CMS metadata or enqueueing follow-up work.

## Implementation Units

### Unit 1: Shared package and dependency migration

- Mastra/OpenRouter/AI-SDK dependency alignment
- shared contracts for typed session results, capability flags, and structured recommendation payloads

### Unit 2: Manager control-plane runtime

- typed tool registry
- specialist agents + supervisor agent
- workflow-backed translation and SEO orchestration
- session, approval, and trace metadata store

### Unit 3: Manager API surface

- session creation/read/message routes
- approval action route
- compatibility bridge for the existing one-shot run route

### Unit 4: Manager workbench migration

- session-based shared-agent UI
- structured result rendering
- approval/decline actions
- preserved library-video selection flow and existing automation section

### Unit 5: Verification

- focused unit and route tests
- browser smoke against the local Manager app
- lint, typecheck, tests, and `git diff --check`

## Verification

- `pnpm --filter @forge/agents test`
- `pnpm --filter @forge/agents typecheck`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `git diff --check`
