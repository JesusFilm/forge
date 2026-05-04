---
date: 2026-05-01
topic: agentic-runtime-app
related:
  - docs/roadmap/platform/feat-115-agentic-runtime-app.md
  - docs/brainstorms/2026-04-12-manager-agents-automations-requirements.md
  - docs/brainstorms/2026-04-13-manager-agent-dry-run-mode-brainstorm.md
  - docs/solutions/platform/adding-new-apps.md
  - docs/solutions/platform/new-app-ci-and-deployment-patterns.md
  - docs/solutions/platform/videoforge-manager-integration.md
---

# Agentic Runtime App

## What We're Building

Add a first-class Agentic app to the Forge monorepo as `apps/agentic`. The app owns the Mastra runtime, Mastra Studio, agent definitions, workflow definitions, tool registration, and execution/session state for agentic work that should outgrow one UI surface.

Manager remains the first product consumer. Its existing Agents tab and enrichment workflows continue to own operator-facing video enrichment state, job creation, dry-run safety, and CMS/Mux side-effect boundaries. Agentic powers agent and workflow orchestration through Mastra behind explicit service contracts so Manager can launch, observe, and approve agent work without importing Agentic internals. Future apps can consume the same Agentic runtime through documented APIs instead of rebuilding local agent frameworks.

## Requirements

- R1. Add a new app boundary, `apps/agentic`, rather than hiding Mastra inside `apps/manager`.
- R2. Expose Mastra Studio as an internal/operator-only surface, with authentication and service access clearly separated from public app traffic.
- R3. Let Manager become the first consumer of Agentic agents and workflows while preserving Manager's current job, automation, dry-run, and enrichment side-effect contracts.
- R4. Support future app consumers through explicit API/contracts, not cross-imports between app contexts.
- R5. Keep V1 agents constrained and approval-aware. Do not introduce broad free-form automation that can mutate CMS, Mux, or other canonical systems without an explicit safe boundary.
- R6. Use repo-standard new-app conventions: package name `@forge/agentic`, app-local `AGENTS.md` and `CLAUDE.md`, env validation, health check, CI scripts, `.env.example`, and Railway deployment notes.
- R7. Treat Mastra session/run state as operational runtime state. Canonical content remains in Strapi/CMS, and Manager remains the source of operator-visible enrichment job truth unless a later plan deliberately migrates that ownership.

## Approaches Considered

### Recommended: New Agentic Runtime App With Manager As First Consumer

Create `apps/agentic` as the platform runtime for agents, workflows, Studio, sessions, and tools. Manager integrates through service APIs and keeps its existing enrichment/automation surfaces as the human-facing control layer.

Pros: matches app-boundary rules, gives future apps a reusable runtime, and keeps side effects behind existing Manager/CMS contracts. Cons: requires explicit auth, API, and deployment contracts before the first agent feels useful.

### Mastra Embedded Inside Manager

Add Mastra dependencies and Studio/runtime routes directly under `apps/manager`.

Pros: fastest path for Manager-only experiments. Cons: makes future consumers awkward, risks coupling Studio/runtime state to Manager UI concerns, and blurs the already-working Manager automation boundary.

### Shared Package First

Create a package for shared agent definitions before adding a deployable runtime app.

Pros: useful once multiple apps consume identical agent contracts. Cons: premature for this checkout because there is no current `packages/agents` package or Mastra runtime to share; V1 needs a real runtime boundary first.

## Why This Approach

The recommended shape is `apps/agentic` as a platform control plane, with Manager as the first client. Current repo evidence points that way: Manager already has template-driven agents, dry-run reports, durable workflows, and service bearer endpoints; no Agentic app or shared agent package exists in this branch. Adding Mastra inside Manager would solve the first integration cheaply, but it would make the second consumer pay the architectural debt.

This also fits the repo's new-app pattern. `pnpm-workspace.yaml` already includes `apps/*`, CI favors `@forge/*` package names, and existing docs require app-local guidance, env validation, health checks, and Railway deployment clarity. The brainstorm therefore chooses the smallest reusable runtime boundary while keeping canonical data and dangerous actions behind the systems that already own them.

## Key Decisions

- App boundary: create `apps/agentic` as the Mastra runtime and Studio app.
- First consumer: Manager consumes Agentic through explicit service APIs; Manager does not import Agentic app internals.
- Ownership: Agentic owns agent/workflow runtime state, sessions, tool registration, and Studio. Manager owns enrichment jobs, automation definitions, dry-run reports, and human approval surfaces for Manager work.
- Safety: first Agentic-powered Manager flows must use constrained tools and approval-aware actions. Side effects continue through Manager/CMS APIs that already understand dry-run and auth.
- Sharing: defer a new shared package until a second real app consumer or repeated contract duplication appears. If needed, extract only typed contracts/schemas, not app implementation.
- Deployment: follow the new-app checklist and explicitly verify whether Railway uses an app-local `railway.toml` via Config-as-code Path or dashboard settings.
- Documentation: update `apps/AGENTS.md`, `apps/README.md`, and app-local docs so future agents see Agentic as part of the app set.

## Resolved Questions

- Agentic should be a new app, not a Manager-only dependency.
- Mastra Studio should be exposed as an internal/operator surface, not as public traffic.
- Manager remains the first consumer and keeps its current operator-facing job/workflow authority.
- Future apps should consume Agentic through APIs/contracts rather than direct app imports.
- The first slice should not reintroduce the older `packages/agents` idea unless planning finds concrete duplication.

## Planning Notes

- Start planning from `docs/solutions/platform/adding-new-apps.md`, `docs/solutions/platform/new-app-ci-and-deployment-patterns.md`, and the current Manager agents files under `apps/manager/src/features/agents/`.
- Define the first Manager-to-Agentic contract around one safe workflow, such as launching an agent run that can only call approved Manager automation/dry-run endpoints.
- Decide where Mastra stores session/run state during planning. If it uses a database, document ownership, migration strategy, and Railway env requirements.
- Add a health endpoint and a Studio access story in the first implementation slice; do not leave Studio reachable by accident.
- Include CI-sensitive scripts from day one so affected-package checks pick up `@forge/agentic`.

## Open Questions

None for the brainstorm. The defaults above were chosen so `/workflows:plan` can proceed without another clarification round.

## Next Steps

Proceed to `/workflows:plan docs/brainstorms/2026-05-01-agentic-runtime-app-requirements.md` for implementation details.
