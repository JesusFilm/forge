---
id: "feat-532"
title: "Retire legacy JesusFilm-RAG service and credentials"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-09-22"
duration: 1
depends_on: ["feat-435"]
blocks: []
tags: ["rag", "operations", "retirement", "security"]
---

## Problem

Jaco's September 22 Option A decision closes feat-435 on the basis that Forge
RAG is the active owner and all consumers have migrated, with external traffic
outside that closure's scope. Legacy JesusFilm-RAG service and credential
retirement is explicitly deferred here. Repository archival does not establish
that the deployment is stopped or that legacy credentials are retired.

## Entry Points — Read These First

1. [Feat-435 operator decision and resolution](feat-435-rag-proof-soak-archive.md) — accepted migration scope, non-applicable rollback/snapshot gates, and limitations.
2. [Closure receipt](evidence/feat-435/proof-soak-archive.md) — measured facts versus owner attestation; no service/credential retirement receipt is claimed.
3. `apps/rag/docs/ops/environment-and-secrets.md` — target names, secret handling, receiver-first rotation/revocation, and shared-provider constraints.
4. `apps/rag/docs/ops/http-service.md` and `apps/rag/docs/ops/corpus-copy.md` — runtime boundaries and historical recovery references.
5. [Feat-433](feat-433-rag-dual-operations.md) — keep private VM/NanoClaw configuration and detailed evidence in the owner's private operations system.

## Grep These

- `jesusfilm-rag`
- `JFRAG_`
- `SERVE_BEARER_TOKENS`
- `production-read`
- `Rotation and revocation`

## What To Build

1. In a separately authorized operator task, identify the exact legacy service
   and credential targets and their disposition. Reconfirm that each proposed
   retirement target is unused by Forge and its consumers. A `JFRAG_` name alone
   does not identify an obsolete credential: Forge dashboard/evaluation still
   consume namespaced production-read configuration.
2. Prepare a bounded retirement plan covering only named legacy resources,
   shared provider/database dependencies, expected effects, and recovery or
   irreversible-action handling. Obtain operation-specific authorization before
   any production or credential mutation. Do not infer it from J030 or this ticket.
3. Execute only authorized retirements through approved operator procedures;
   do not deploy local worktree code or alter the archived repository merely
   to perform service/credential cleanup.
4. Record redacted target names, owner, decision/time, actions and verification
   outcomes, or explicit reasons a resource must be retained. Keep secret values
   and private host configuration out of Forge.

## Constraints

- J030 only creates this follow-up; it performs no retirement or credential action.
- Do not reinstate feat-435 rollback rehearsal/expiry or final snapshot retention
  as prerequisites: Jaco explicitly marked them not applicable to that closure.
  Any recovery requirements for a newly proposed destructive action belong in
  this follow-up's authorized plan, without claiming a historical rehearsal.
- Preserve active Forge services, data, corpus, credentials, and shared provider
  access. Any unexpected dependency or scope expansion requires an owner decision.
- Do not treat "no external traffic in scope" as a measured assertion that no
  external caller exists. Verify the exact future retirement targets' usage.

## Verification

- An approved, named-target retirement plan and redacted disposition exist for
  every resource included in this follow-up.
- Authorized checks establish the intended legacy service/credential state and
  continued Forge consumer health; record commands and outcomes without secrets
  or corpus text. Missing checks remain unverified.
- Update this ticket's resolution/PR and the RAG lane index; run formatting,
  link, status-count, and reciprocal dependency checks.

Created by [draft PR #2379](https://github.com/JesusFilm/forge/pull/2379). This
ticket is in progress and does not block the completed feat-435 documentation.

## Environment-name migration in progress

The approved receiver-first sequence starts with additive code compatibility,
then verifies normal deployment and read-only retrieval/HTTP smoke before
migrating operator configuration. Later PRs update active documentation and
remove aliases only after all callers migrate. Private target configuration,
rollout receipts, and secret retirement remain in the owner's operations system.

Canonical production variables use `FORGE_RAG_`; the shared provider key is
`OPENROUTER_API_KEY`, the production model is `FORGE_RAG_EMBED_MODEL_ID`, and
copy tooling uses the generic `CORPUS_SOURCE_DATABASE_URL`. Railway runtime
`DATABASE_URL`, `EMBED_MODEL_ID`, and `SERVE_BEARER_TOKENS` are unchanged.
Legacy-only environments remain accepted during this first stage. Present
canonical values win, including blanks; a canonical database or host selects
the entire Forge target family to prevent mixed legacy/Forge targets.
Exact host, reader identity, write and role-provision acknowledgements remain
mandatory. Evaluation inputs are unit-tested without running evaluation.
Acquisition, ingestion, reembedding and corpus writes are excluded from this
migration's validation and deferred for a separate verification follow-up.

The pre-existing platform ticket also numbered feat-532 is outside this scope;
this work retains the existing RAG ticket rather than renumbering unrelated work.
