---
id: "feat-428"
title: "Port and deploy the RAG HTTP retrieval service"
owner: "jaco"
priority: "P0"
status: "not-started"
start_date: "2026-09-09"
duration: 3
depends_on: ["feat-427"]
blocks: ["feat-429"]
tags: ["rag", "railway", "http"]
---

## Problem

Forge needs an empty-corpus `/v1` service before any production data copy. Historical scope: [jfrag #161](https://github.com/JesusFilm/jesusfilm-rag/issues/161).

## Entry Points — Read These First

1. jfrag serving app, smoke script, Dockerfile, and Railway configuration.
2. `packages/rag-contracts` contract artifacts.

## Grep These

- `/v1/health`
- `/v1/search`
- `SERVE_BEARER_TOKENS`
- `railway.toml`

## What To Build

Port the thin read-only service, container/build config, healthcheck, bearer-scope tests, and normal Railway autodeploy configuration.

The empty production schema already exists from feat-425. The first runnable
deployment must prove that `/apps/rag/railway.toml` executes the configured
`pnpm --filter @forge/rag db:migrate:deploy` pre-deploy command successfully
against that existing database. Do not add a replacement database, rerun the
initial provisioning workflow, or treat pre-deploy verification as ownership
of schema creation.

## Constraints

- No direct `railway up`; deploy only via merged Forge PR.
- External `/v1` and a Railway-private route must reach the same service.

## Verification

- Contract, auth, health, container, and empty-result smoke checks pass.
- Deployment metadata names `/apps/rag/railway.toml`, and logs prove the
  configured Prisma pre-deploy migration completed before service startup.
- Production service is healthy before corpus copy begins.
