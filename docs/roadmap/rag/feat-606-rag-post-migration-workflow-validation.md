---
id: "feat-606"
title: "Verify acquisition and ingestion after the environment-name migration"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-10-05"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "operations", "verification"]
---

## Problem

The [feat-532 environment-name migration](feat-532-rag-legacy-service-credential-retirement.md)
validated contracts and bounded retrieval/HTTP access. It did not execute acquisition,
ingestion, evaluation, role provisioning, reembedding, or corpus writes. Those checks
do not prove the acquisition/indexing workflow is unchanged under the canonical inputs.

## Entry Points — Read These First

1. `apps/rag/scripts/acquire.ts` and `apps/rag/scripts/index.ts` — workflow entrypoints.
2. `apps/rag/scripts/lib/production-target.ts` and `maintenance-args.ts` — explicit target, scope, bounds and acknowledgements.
3. `apps/rag/docs/ops/corpus-maintenance.md`, `environment-and-secrets.md`, and `readonly-database.md` — current contract and safety controls.
4. [Feat-471](feat-471-rag-production-operations-rollout.md) — separate Icelandic completion proof; coordinate scope rather than duplicate that import.
5. [PR #2562](https://github.com/JesusFilm/forge/pull/2562) and [PR #2563](https://github.com/JesusFilm/forge/pull/2563) — canonical implementation and operating contract.

## What To Do

1. Prepare a bounded plan naming source/path, inventory, limits, expected behavior,
   target verification and stop conditions. Obtain appropriate execution authorization;
   ticket creation does not authorize production workflows or writes.
2. Independently verify the intended Forge target and dedicated reader identity.
   Validate the canonical names, exact host and reader/writer selection without printing
   values. Run approved scoped previews and compare behavior with the reviewed contract.
3. Only if separately authorized, execute scoped acquisition and bounded indexing with
   explicit apply/write acknowledgements. Retain metadata-only receipts and reconcile
   staging, skips, chunks, model and pending counts. Coordinate concurrent sessions.
4. Record actual observed outcomes and any unverified stages. Do not equate discovery
   counts or passing previews with completed acquisition or ingestion.

## Constraints

- No evaluation workflow, reembedding, role provisioning, deployment shortcuts, or
  writes outside the approved future plan.
- Never record secret values, URLs containing credentials, corpus text or raw errors.
- Preserve exact-host checks, reader identity, explicit apply and production-write opt-in.
- Stop on target/scope mismatch, changed inventory or uncertain write outcome.
- This follow-up is independent of remaining legacy service shutdown/credential revocation
  in feat-532; there is no blocking dependency on that broader retirement.

## Verification

- Approved plan and metadata-only receipts distinguish preview from actual apply.
- Canonical target/argument checks pass; authorized runs preserve reviewed scope and bounds.
- If apply is authorized, staging/chunk/model/pending counts reconcile and the final scoped
  index preview is empty or remaining rows have an explicit reviewed disposition.
- Missing live checks remain unverified. Update this ticket's resolution/PR and lane index
  only from observed evidence; run formatting, links, status counts and dependency checks.
