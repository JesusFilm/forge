---
id: "feat-460"
title: "Provision a least-privilege RAG production reader"
owner: "jaco"
priority: "P0"
status: "in-progress"
start_date: "2026-09-07"
duration: 2
depends_on: ["feat-425", "feat-432"]
blocks: ["feat-435"]
tags: ["rag", "postgres", "security", "railway"]
---

## Problem

The `forge-rag/prd` production-read workflow currently resolves the same
PostgreSQL credential used by production maintenance. The credential can own,
create, and modify database objects and corpus rows, so a command selecting the
`production-read` target is not protected by database-enforced least privilege.

## Entry Points — Read These First

1. `apps/rag/src/config/env.ts`, `apps/rag/scripts/eval-production.ts`, and
   `apps/rag/scripts/dashboard-data.ts` — current production-read credential
   resolution.
2. `apps/rag/prisma/migrations/` and `apps/rag/railway.toml` — schema ownership,
   migration, and Railway deployment boundaries.
3. `apps/rag/docs/ops/environment-and-secrets.md` and
   `apps/rag/docs/ops/evaluation.md` — receiver-first secret and evaluation
   procedures.
4. [Forge PR #2178](https://github.com/JesusFilm/forge/pull/2178) — blocked
   production privilege preflight and redacted evidence proposed separately.

## Grep These

- `JFRAG_POSTGRESQL_DB_URL`
- `production-read`
- `db:migrate:deploy`
- `DATABASE_URL`
- `ALTER DEFAULT PRIVILEGES`

## What To Build

- Add an explicit operator command that provisions a PostgreSQL `NOLOGIN`
  read-only group and a dedicated login with no elevated role attributes,
  ownership, writable grants, schema creation, or temporary-object privilege.
- Preserve the Railway-managed owner credential for Prisma migrations and
  write-authorized maintenance while requiring a separate namespaced database
  URL for evaluation and dashboard reads.
- Add a verifier that proves bounded reads succeed and persistent DDL, temporary
  DDL, `INSERT`, `UPDATE`, and `DELETE` fail even inside an explicitly read-write
  transaction.
- Document the manual Railway and Doppler provisioning, rotation, verification,
  and rollback procedure without recording secret values.

## Constraints

- Never create a password in a Prisma migration or commit it to the repository.
- Production role provisioning is an explicit operator action after merge; it
  must not run during Railway build, pre-deploy migration, service startup, or
  ordinary autodeploy.
- Keep the database owner credential available only to migrations and explicitly
  authorized write operations. Evaluation and dashboard commands must fail
  closed when the dedicated read-only URL is absent.
- Do not run the provisioning command against production in this ticket.

## Verification

- Provision the roles against the local PostgreSQL 18 RAG database.
- Confirm catalog privilege checks pass and a normal table read succeeds.
- Confirm persistent and temporary table creation plus corpus `INSERT`,
  `UPDATE`, and `DELETE` are rejected and leave no probe data or objects.
- Run focused environment, provisioning, evaluation, dashboard, schema, lint,
  typecheck, dependency, and formatting checks.
