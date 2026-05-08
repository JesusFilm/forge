---
id: "feat-115"
title: "Agentic Runtime App"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-01"
duration: 7
depends_on: []
blocks:
  - "feat-116"
  - "feat-120"
tags:
  - "manager"
  - "tooling"
  - "ai-pipeline"
---

## Problem

Forge has Manager-side agents and automations, but there is no first-class Agentic runtime app in the monorepo. If Manager embeds Mastra directly, future apps that need to create or consume agents and workflows will either duplicate runtime code or cross-import Manager internals, which violates app boundaries.

Add `apps/agentic` as the shared agentic runtime and Mastra Studio app. Manager should be the first consumer, but the runtime boundary should be reusable by future Forge apps.

## Entry Points -- Read These First

1. `docs/brainstorms/2026-05-01-agentic-runtime-app-requirements.md` -- chosen product shape and boundaries
2. `docs/solutions/platform/adding-new-apps.md` -- repo checklist for adding `apps/<name>`
3. `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` -- CI, env validation, lazy SDK, and Railway deployment lessons
4. `apps/manager/src/features/agents/automation-contract.ts` -- existing Manager agent/automation contracts
5. `apps/manager/src/features/agents/automation-runner.ts` -- Manager boundary that selects eligible work, dry-runs, or creates enrichment jobs
6. `apps/manager/src/app/api/automations/runs/[id]/enqueue/route.ts` -- current service-to-service automation enqueue pattern
7. `apps/manager/src/lib/auth.ts` -- Manager user/session and service bearer auth patterns
8. `pnpm-workspace.yaml` -- confirms `apps/*` workspace inclusion
9. `.github/workflows/ci.yml` -- affected-package filtering and expected package scripts

## Grep These

- `Mastra|mastra|@mastra` in the repo -- confirm no current runtime exists before implementation
- `CREATABLE_AUTOMATION_TEMPLATES|AutomationRunMode|dry_run` in `apps/manager/src/features/agents/`
- `authenticateServiceBearerRequest|MANAGER_API_KEY` in `apps/manager/src/`
- `@forge/manager|@forge/admin|@forge/web` in `apps/*/package.json` -- app package naming and script conventions
- `Config-as-code Path|railway.toml|HOSTNAME=0.0.0.0` in `docs/solutions/` and app Railway configs

## What To Build

1. Create `apps/agentic` as a new monorepo app with package name `@forge/agentic`.
2. Add Mastra runtime and Mastra Studio as internal/operator-facing surfaces.
3. Add app-local `AGENTS.md` and `CLAUDE.md` describing runtime ownership, tool registration, auth, env vars, and cross-app contract rules.
4. Add env validation, `.env.example`, CI-compatible scripts, health check, and deployment configuration or documented Railway dashboard settings.
5. Define a narrow Manager integration contract for the first Agentic-powered flow.
6. Keep Manager's existing enrichment jobs, automation definitions, dry-run reports, and side-effect boundaries authoritative for Manager work.
7. Document how future apps should consume Agentic agents/workflows without cross-importing app internals.
8. Update app-set docs and CI/label scope allowlists if the new app should be visible to future agents and PR automation.

## Constraints

- Do not hide Mastra inside `apps/manager`; this feature is about a new app boundary.
- Do not create broad free-form agent mutations in V1. Use constrained tools and approval-aware actions.
- Do not duplicate canonical content or enrichment job truth in Agentic; Strapi/CMS and Manager keep their current ownership.
- Do not cross-import code from one app into another. Use APIs or a deliberately scoped shared package only when planning proves it is needed.
- Do not treat an app-local `railway.toml` as deployed truth unless Railway Config-as-code Path is set and verified.
- Do not revive an old `packages/agents` shape by assumption; this checkout does not currently contain that package.

## Verification

- `apps/agentic/package.json` is named `@forge/agentic` and exposes standard `lint`, `typecheck`, `test`, `build`, `dev`, and `start` scripts as applicable.
- `pnpm --filter @forge/agentic lint`, `pnpm --filter @forge/agentic typecheck`, `pnpm --filter @forge/agentic test --if-present`, and `pnpm --filter @forge/agentic build` pass or have documented first-slice exceptions.
- Mastra Studio is reachable only through the intended internal/operator path and is not anonymously public.
- Manager can invoke the first Agentic-backed flow through an explicit contract without importing app internals.
- Dry-run/approval behavior remains visible before any Manager-owned side effect executes.
- `git diff --check` passes.
