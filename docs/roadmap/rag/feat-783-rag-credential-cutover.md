---
id: "feat-783"
title: "Coordinate RAG credential rotation through PR-to-main"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-10-23"
duration: 2
depends_on: []
blocks: []
tags: ["rag", "security", "operations"]
---

## Problem

The Railway incident response left RAG's PostgreSQL owner and five service
logins outstanding. HTTP consumer credentials are distinct from these internal
database connections. Rotation must include matching operator-vault copies and
preserve a tested rollback until the replacement service is verified.

## Entry Points — Read These First

1. `apps/rag/docs/ops/credential-cutover.md` — rollout and retirement gates.
2. `apps/rag/docs/ops/environment-and-secrets.md` — vault and target contract.
3. `apps/rag/railway.toml` — watched paths, migration, grant and health gates.
4. `apps/rag/scripts/consumer-role-policy.ts` — effective privilege checks.
5. `apps/rag/scripts/lib/portal-session-renewal-grant.ts` — portal grant checks.

## Grep These

`RAG_CONSUMER_`, `RAG_PORTAL_DATABASE_URL`, `RAG_USAGE_`,
`FORGE_RAG_POSTGRESQL_DB_URL`, `OPENROUTER_API_KEY`.

## What To Build

Document and execute the bounded cutover through reviewed PR merges and Railway
autodeploy. Map all credential copies, verify replacement logins before updating
receivers, and verify the deployed service before retiring prior logins. Keep
provider/API credentials separate and avoid repeating completed rotations.

## Constraints

No local-code deployment or manual production redeploy. No corpus writes,
reembedding, unrelated Admin/Mastra repairs, or plaintext credential evidence.
Preparation and a merged runbook do not establish completed live rotation.
Database owner changes require a separately coordinated cutover; do not assume
parallel restricted-role login replacements solve owner-password continuity.

## Verification

Run formatting and link checks on the runbook. Execute its live gates with
redacted evidence in the shared incident tracker: replacement fresh connection,
role/grant checks, merged deployment identity, portal sign-in, registered HTTP
retrieval, usage and operator checks, soak and prior-credential rejection.
Keep this ticket in progress until live rotation and retirement are recorded.

## Delivery

Preparation: [Forge PR #2862](https://github.com/JesusFilm/forge/pull/2862).
Live receiver cutover, deployment verification and retirement remain open.
