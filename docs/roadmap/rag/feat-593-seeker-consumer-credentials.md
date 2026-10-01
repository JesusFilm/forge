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
approach on October 6. Move deployed Seeker and local development/evaluations to
separate registered consumers without changing the retrieval contract.

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
  through the normal reviewed PR. GitHub reports Forge `write` permission
  (`maintain` role); CI must independently verify eligibility.
- After admission merges, create `seeker-prod` and `seeker-dev` in the portal,
  with `jianwei1` as owner and `jaco-brink` as backup owner.
- Confirm each consumer's granted sources cover Seeker's required corpus.
- The owner saves one-time keys directly into the approved secret manager.
  Assist installation into Mastra's `JESUSFILM_RAG_API_KEY`: production uses
  `seeker-prod`; local development/evaluations use `seeker-dev`.
- Preserve the existing endpoint and host pin when they still target Forge RAG.
  Record redacted verification after the normal configuration rollout.

## Constraints

- Do not read or search env files, display keys, or commit credentials.
- Do not notify Jaco about Seeker's existing-consumer status; he already knows.
- This access PR does not create consumers, rotate keys, change production
  configuration, or claim that the operational migration is complete.
- Each consumer has one active key; rotation invalidates its previous key immediately.
- Do not change the RAG contract, Seeker prompt, or `retrieveAnswer` implementation.

## Verification

- Format the allowlist and roadmap files; run the existing portal-policy and
  allowlist-validator tests and the `rag-portal-allowlist` CI check.
- After merge, prove `jianwei1` can sign into the portal and owns both consumers.
- For each receiver, verify a real Seeker retrieval returns grounded content and
  citations, then confirm usage is attributed to the correct consumer.
- A successful HTTP status alone is insufficient: empty source grants can return
  an empty 200. Record counts/statuses only, never keys or retrieved content.
- Keep this ticket in progress until registration, installation and both
  verification paths are observed. Add the PR link and resolution at completion.
