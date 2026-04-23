---
title: "Shared Mastra Agent Catalog with App-Owned Runtime"
date: 2026-04-16
category: best-practices
module: manager
problem_type: best_practice
component: ai
severity: medium
applies_when:
  - "Multiple apps need reusable specialist agents with different prompts and input fields"
  - "One app should execute curated agents through its own auth, env, and provider setup"
  - "Mastra agents need to run through OpenRouter inside this monorepo"
tags:
  - mastra
  - openrouter
  - manager
  - agents
  - monorepo
  - shared-packages
---

# Shared Mastra Agent Catalog with App-Owned Runtime

## Context

The Manager app needed a reusable set of specialist agents such as Translation, Video Enhancing, SEO, and Marketing. Those agents should eventually be shareable across apps, but only Manager currently owns the authenticated dashboard, OpenRouter credentials, and execution surface.

## Guidance

### Put agent definitions in a shared package

Create a workspace package like `packages/agents` that exports:

- stable agent IDs
- display metadata
- field definitions for structured input
- instructions/prompt posture
- validation helpers
- a thin Mastra `Agent` factory that accepts a resolved model

This keeps the reusable part app-agnostic and prevents other apps from importing `apps/manager` code just to use the same starter agents.

### Keep provider wiring in the consuming app

Do not let the shared package read env vars or choose providers. The consuming app should own:

- auth
- env validation
- provider initialization
- model selection
- API routes
- result logging or persistence

In this implementation, Manager owns OpenRouter configuration and passes the resolved model into the shared Mastra agent factory.

### Drive the UI from agent metadata

Use each agent definition as the source of truth for:

- list cards
- starter prompt text
- dynamic form fields
- required-field validation

That allows one generic list route and one generic run route instead of a bespoke UI and API surface per agent.

### Start with text-first outputs

For the first slice, return markdown/text output plus token usage. Avoid structured-output contracts until a real downstream consumer needs them. This keeps the starter catalog easy to extend and reduces schema churn.

### Pin a provider version compatible with the installed Mastra generation

`@mastra/core@0.16.x` currently fits the older AI SDK provider generation. Newer `@openrouter/ai-sdk-provider@2.x` peers against AI SDK 6 and pulls the dependency graph out of alignment for this repo slice.

Use `@openrouter/ai-sdk-provider@0.4.6` with this Mastra version unless the repo intentionally upgrades the AI SDK stack together.

## Why This Matters

- Shared agents stay reusable across apps instead of becoming Manager-only UI code.
- Manager can evolve execution policy without rewriting the shared catalog.
- Adding a new curated agent becomes mostly a metadata change rather than a new route and page flow.
- Version pinning avoids subtle runtime and install conflicts between Mastra and provider packages.

## When to Apply

- Adding a new curated shared agent for another app surface
- Building a second app that should reuse the same Translation, SEO, or Marketing agent definitions
- Extending the Manager workbench with more specialist agents
- Planning a future migration from prompt-only agents to tool-enabled Mastra agents

## Examples

- Shared catalog: `packages/agents/src/definitions.ts`
- Validation + prompt builder: `packages/agents/src/catalog.ts`
- Manager runtime: `apps/manager/src/features/agents/shared-agent-runtime.ts`
- Manager UI workbench: `apps/manager/src/features/agents/shared-agent-workbench.tsx`

## Related

- `docs/roadmap/media-generation/feat-097-manager-shared-mastra-agents.md`
- `docs/plans/2026-04-16-feat-manager-shared-mastra-agents-plan.md`
