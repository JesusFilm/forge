---
id: "feat-783"
title: "Coordinate RAG credential rotation through PR-to-main"
owner: "jaco"
priority: "P1"
status: "complete"
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

## Resolution

Completed 2026-10-23 NZDT through normal PR-to-main autodeploy:

- [PR #2862](https://github.com/JesusFilm/forge/pull/2862) replaced the five
  restricted service logins. Runtime identities, effective grants, owner portal
  sign-in, retrieval, usage and a 15-minute observation passed. Prior logins are
  NOLOGIN with cleared passwords; fresh old credentials failed. Grant-bearing
  roles and inherited permissions were retained.
- [PR #2869](https://github.com/JesusFilm/forge/pull/2869) completed the separately
  approved owner-password maintenance window. Actual PostgreSQL authentication,
  the single Railway password source and reference chain, and the canonical
  Doppler owner URL were updated and verified. Database deployment was unchanged;
  no database restart or extra superuser was required.
- Owner rollout deployment `5ce2e6d7-0373-4cca-941a-42315cdbf27e` served main
  `46d384c376ee23889777b4ec22ced68094aab1c1`. Runtime URL equality, fresh owner
  identity, old-password rejection, authenticated retrieval, usage, health and
  portal checks passed. Retrieval interruption during the approved window was
  recorded; recovery was verified before the 15-minute observation started.
- The observation completed after 13:31:20 NZDT. No pre-cutover owner sessions
  remained after guarded cleanup of one idle metadata session with no open
  transaction. Final retrieval and usage checks passed. Temporary vault recovery
  and staging entries were removed, verification SSH keys were removed, and the
  production-write lock was released.

The incident tracker retains source mappings, timestamps and detailed evidence
without credential values. HTTP callers did not receive database credentials.
Provider keys, GitHub OAuth/repository credentials and registered HTTP consumer
credentials are separate work; this completion covers the PostgreSQL owner and
five restricted service-logins only.

## Durable operational findings

- Inspect unrendered references before updating shared credentials: one source
  can populate several apparent password variables.
- Test password-independent recovery before changing a sole administrator
  password. A variable edit is not a database authentication change.
- A healthy endpoint does not prove corpus retrieval after a credential change;
  verify authenticated retrieval and usage on the actual replacement runtime.
- Password changes do not revoke existing sessions. Attribute pre-cutover
  sessions and close only scoped, safe connections; retain grant-bearing roles
  when replacement logins inherit permissions.
