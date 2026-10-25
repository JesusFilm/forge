---
id: "feat-439"
title: "Migrate RAG Railway configuration to Infrastructure as Code"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-09-12"
duration: 2
depends_on: ["feat-428"]
blocks: []
tags: ["rag", "railway", "infrastructure", "deployment"]
---

## Problem

Forge deploys 13 services through legacy `railway.toml` files and has no
committed `.railway/railway.ts`. Railway has deprecated that service-level
Config as Code model and documents a December 1, 2026 cutoff for existing
services. RAG needs a
bounded migration that proves the project-level Infrastructure as Code workflow
without silently changing its production source, database, variables,
networking, commands, healthcheck, or autodeploy behavior.

## Entry Points — Read These First

1. `apps/rag/railway.toml` — current RAG build, pre-deploy, start, healthcheck,
   restart, and watch-path contract.
2. `apps/rag/docs/ops/http-service.md` — deployment and smoke procedure that
   must remain valid through the migration.
3. `.railway/railway.ts` — project-level Railway IaC entry point to create from
   pulled `forge/production` state; it does not exist yet.
4. Railway Infrastructure as Code documentation and current CLI help for
   `railway config init`, `pull`, `plan`, and `apply` — authoritative schema and
   migration workflow at implementation time.
5. Every tracked `**/railway.toml` — coexistence inventory; services outside
   the explicitly selected RAG pilot remain legacy-owned in this feature.

## Grep These

- `railway.toml`
- `startCommand`
- `preDeployCommand`
- `healthcheckPath`
- `watchPatterns`
- `railway config`
- `forge-rag`

## What To Build

Use a current Railway CLI authenticated to the `forge` project and production
environment. Pull the existing project into `.railway/railway.ts`, reduce the
change to a RAG-only ownership migration, and commit the lock/package artifacts
required by the generated IaC project. Preserve these effective RAG values:

- GitHub source `JesusFilm/forge`, branch `main`, and repository-root build
  context;
- Railpack builder and the existing install plus Prisma-client build command;
- `pnpm --filter @forge/rag db:migrate:deploy` before startup;
- `pnpm --filter @forge/rag start` as the service command;
- `/v1/health`, its timeout, restart policy, and RAG/shared-contract watch paths;
- existing public/private domains, service references, database, and variable
  names without committing variable values.

Run `railway config plan` before any apply and save a secret-free summary of the
expected changes. The plan must show no service recreation, database/volume
replacement, domain removal, variable-value write, or unrelated-service drift.
Apply through the Railway IaC workflow only after that review. Remove
`apps/rag/railway.toml` and clear its dashboard config-file path in the same
controlled cutover so one mechanism owns each RAG setting. Keep all other
Forge `railway.toml` files active; record whether Railway accepts that mixed
project state and create separate follow-up tickets for their migrations.

## Constraints

- RAG is the pilot, not authorization to migrate every Forge service.
- Never commit Railway tokens, variable values, generated secret material, or
  a local project-link file.
- Never use `railway up`; production source remains GitHub `main` through the
  normal PR-to-main flow.
- Do not let both `.railway/railway.ts` and `apps/rag/railway.toml` remain
  authoritative for the same RAG field after cutover.
- Preserve the last healthy deployment and a documented rollback path until
  the IaC-managed deployment passes smoke checks.

## Verification

- Repository inventory confirms `.railway/railway.ts` owns RAG while the other
  12 legacy TOML services remain intentionally unchanged.
- `railway config plan` is reviewed and contains only the expected RAG
  ownership transition; a second plan after apply is empty.
- Deployment metadata retains the same source commit, build/pre-deploy/start
  commands, healthcheck, restart policy, watch paths, domains, and references.
- Prisma pre-deploy completes before startup and Railway reports the service
  healthy.
- Public and Railway-private feat-428 smoke checks pass after the IaC-managed
  deployment.
- The rollback procedure is exercised or proven from Railway deployment
  history without publishing local worktree code.
