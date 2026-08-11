---
id: "feat-352"
title: "Align live SEO proposal digest with Admin persistence"
owner: "codex"
priority: "P0"
status: "in-progress"
start_date: "2026-08-11"
duration: 1
depends_on:
  - "feat-344"
blocks:
  - "feat-353"
tags:
  - "platform"
  - "mastra"
  - "admin"
  - "seo"
  - "security"
---

## Problem

The production dry run cannot exercise live proposal persistence. During the
first guarded live audit, Mastra hashed the raw immutable proposal payload while
Admin correctly recomputed the digest after applying persistence redaction.
Content normalized by that boundary caused `proposal_digest_mismatch`, so the
transaction failed closed with zero observations or proposals persisted.

## Entry Points — Read These First

1. `apps/mastra/src/services/admin-seo-client.ts` — proposal wire projection and digest.
2. `apps/mastra/src/services/seo-data-minimization.ts` — bounded persistence-safe projection.
3. `apps/admin/src/services/seo-experiment.service.ts` — authoritative digest verification.
4. `docs/solutions/architecture-patterns/mastra-seo-experiment-ledger-boundary.md` — immutable proposal boundary.

## Grep These

- `toAdminSeoProposal`
- `proposal_digest_mismatch`
- `minimizeSeoValue`
- `payloadDigest`

## What To Build

1. Minimize the immutable proposal payload before computing its wire digest.
2. Send the exact minimized object that Mastra hashed so Admin's defensive
   persistence redaction is idempotent.
3. Preserve ordinary content keys such as `description` while treating only
   actual IP-address key tokens as sensitive on both sides of the contract.
4. Add a regression test containing identifiers, an IP address, and a
   credential-like value that proves the wire payload is minimized and its
   digest matches the transmitted object.
5. Validate the fix against the production Admin ingest contract before
   completing the live cutover.

## Constraints

- Do not weaken Admin's digest recomputation or redaction.
- Do not log or persist raw proposal content during validation.
- Preserve signed assertions, run fences, and human approval requirements.
- No proposal approval, canonical publication, or ticket creation is part of
  this repair.

## Verification

- Focused Mastra proposal and workflow tests pass.
- Mastra typecheck and lint pass.
- A signed production live audit completes without `proposal_digest_mismatch`.
- Manager displays persisted proposals while drafts, decisions, tickets, and
  experiments remain zero.
