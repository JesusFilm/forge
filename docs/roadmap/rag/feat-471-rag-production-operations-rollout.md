---
id: "feat-471"
title: "Verify direct production maintenance and the Icelandic path"
owner: "jaco"
priority: "P1"
status: "not-started"
start_date: "2026-09-09"
duration: 1
depends_on: ["feat-470"]
blocks: []
tags: ["rag", "infrastructure", "operations"]
---

## Problem

The repository contract is implemented, but production configuration and live
acquisition/indexing must be verified separately. Passing command tests does
not establish production reader grants or Icelandic corpus completeness.

## Entry Points — Read These First

- `apps/rag/docs/ops/corpus-maintenance.md` — direct commands and completion checks.
- `apps/rag/docs/ops/environment-and-secrets.md`, `readonly-database.md` in the same folder.
- Existing programme evidence: `docs/roadmap/rag/feat-435-rag-proof-soak-archive.md`.

## What To Do

1. Merge feat-470 through the normal PR-to-main flow and use a clean checkout.
2. Provision `FORGE_RAG_POSTGRESQL_READONLY_DB_URL` and
   `FORGE_RAG_EXPECTED_POSTGRES_HOST` in Doppler `forge-rag/prd`. Independently
   verify the Forge destination and reader grants; do not copy the legacy writer.
3. Run the documented acquisition and indexing previews with
   `--source gotquestions --path-prefix /islenska/`. Preserve these arguments
   for both commands.
4. After production operation authorization, perform resumable scoped
   acquisition and bounded indexing, then retain metadata-only receipts and
   reconcile all 51 intended articles, skips, chunks, model and pending rows.
   Feed evidence into feat-435; retrieval/evaluation remain separate proofs.

## Constraints and Verification

No direct Railway deployment, secret values in artifacts, automatic apply after
preview, or acquisition completion claim based solely on discovery counts.
Coordinate concurrent maintenance sessions against the same corpus. Live proof
must show the Forge target and Icelandic scope, expected inventory, reconciled
skips, and an empty final scoped index preview; stop on target/scope mismatch,
changed inventory, unexpected counts, or an uncertain write outcome.
