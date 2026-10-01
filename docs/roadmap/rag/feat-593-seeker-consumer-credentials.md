---
id: "feat-593"
title: "Migrate Seeker to registered RAG consumer credentials"
owner: "jian wei"
priority: "P0"
status: "in-progress"
start_date: "2026-10-02"
duration: 4
depends_on: []
blocks: []
tags:
  - "rag"
  - "seeker"
  - "infrastructure"
---

## Problem

Seeker already calls Forge RAG through `retrieveAnswer`, but its September 3
cutover retained the shared API key. Jaco announced retirement of the old key
approach on October 6. Register one `seeker` consumer and use its key for both
production and local development/evaluations without changing the retrieval contract.

## Entry Points — Read These First

1. `apps/rag/portal/users.json` and `apps/rag/portal/README.md` — GitHub portal admission.
2. `apps/rag/docs/ops/consumer-access-migration.md` — registration, source grants and one-time credentials.
3. `apps/mastra/src/services/jesusfilm-rag-client.ts` — existing bearer-authenticated `/v1/search` client.
4. `docs/roadmap/rag/evidence/feat-434/seeker-cutover.md` — historical production cutover evidence.

## Grep These

- `validatePortalUsers`, `parsePortalAllowlist`, `allowedSourceKeys`
- `retrieveAnswer`, `v1/search` in TypeScript source; exclude env files.

## What To Build

- Add GitHub owner `jianwei1` (numeric ID `17999235`) to the portal allowlist
  through the normal reviewed PR.
- After admission merges, create `seeker` in the portal,
  with `jianwei1` as owner and `jaco-brink` as backup owner.
- Confirm the consumer's granted sources cover Seeker's required corpus.
- Save the issued key in the approved secret manager and install it as Mastra's
  `JESUSFILM_RAG_API_KEY` in both production and local development/evaluations.
- Preserve the existing endpoint and host pin when they still target Forge RAG.
  Record redacted verification after the normal configuration rollout.

## Constraints

- Do not read or search env files, display keys, or commit credentials.
- Do not change the RAG contract, Seeker prompt, or `retrieveAnswer` implementation.

## Verification

- Format the allowlist and roadmap files; run the existing portal-policy and
  allowlist-validator tests and the `rag-portal-allowlist` CI check.
- After merge, verify `jianwei1` can sign into the portal and owns `seeker`.
- Verify grounded retrieval and citations locally and in production, then confirm
  usage is attributed to `seeker`. Record counts/statuses only, never keys or
  retrieved content.
