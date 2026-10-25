---
title: "Safe resumable PostgreSQL RAG corpus copy rehearsals"
date: "2026-08-28"
category: "best-practices"
module: "apps/rag"
problem_type: "best_practice"
component: "database"
severity: "high"
resolution_type: "tooling_addition"
applies_when:
  - "Copying a production-like RAG corpus between explicitly named PostgreSQL environments for local rehearsal"
  - "A large copy must pause and resume without offset pagination, duplicate writes, or embedding-provider calls"
  - "Temporarily removing secondary indexes for bulk throughput while preserving a recoverable target state"
  - "Proving copied corpus integrity and retrieval equivalence without exposing database URLs or corpus text"
related_components:
  - "tooling"
  - "testing_framework"
  - "infrastructure"
tags:
  - "rag"
  - "postgresql"
  - "corpus-copy"
  - "keyset-pagination"
  - "resume"
  - "index-reconciliation"
  - "retrieval-equivalence"
  - "data-redaction"
---

# Safe resumable PostgreSQL RAG corpus copy rehearsals

## Context

A local RAG corpus migration needs stronger proof than “the row counts look right.” It moves relational data, raw documents, and existing vectors while preserving foreign-key order and retrieval behavior. It may be interrupted, and its evidence must not leak database credentials or corpus text.

The Forge rehearsal for `JesusFilm/jesusfilm-rag#162` treats this as an operator workflow, not a one-shot SQL dump. PR `JesusFilm/forge#2086` is open as of 2026-08-28, so this documents the verified branch implementation and does not claim that the production migration has shipped.

Earlier migration planning deliberately separated corpus population from service connectivity and retrieval contracts: the copy is a parity and operability exercise, not an opportunity to change corpus semantics (session history).

## Guidance

1. **Make the default invocation read-only.** The CLI defaults to dry-run and requires both `--copy` and `--confirm-local-copy` before writing (`apps/rag/scripts/copy-corpus.ts:213`). It accepts connection strings through named environment variables and rejects unknown URL-style arguments (`apps/rag/scripts/copy-corpus.ts:233`).

2. **Prove the endpoints are distinct before copying.** Validate required tables on both databases (`apps/rag/scripts/copy-corpus.ts:300`), compare database name plus a redacted server identity (`apps/rag/scripts/copy-corpus.ts:271`), and reject identical URLs or identities (`apps/rag/scripts/copy-corpus.ts:503`). Refuse a fresh copy into a non-empty target; only `--resume` may continue an interrupted target (`apps/rag/scripts/copy-corpus.ts:532`).

3. **Resume from a validated source prefix.** Read tables in dependency order with native UUID or text keyset pagination rather than offsets (`apps/rag/scripts/copy-corpus.ts:314`). Before resuming, prove that target rows are an exact prefix of source rows (`apps/rag/scripts/copy-corpus.ts:351`). Insert through the indexing-owned batch boundary with conflict-safe writes (`apps/rag/src/indexing/copy-corpus-batch.ts:7`).

4. **Optimize only reproducible structures, and restore them in `finally`.** Drop known secondary indexes for bulk copying and recreate them whether copying completes, pauses, or throws (`apps/rag/scripts/copy-corpus.ts:380`, `apps/rag/scripts/copy-corpus.ts:547`). An equal-count `--resume` must also reconcile indexes, covering a process killed after index removal but before further row insertion (`apps/rag/scripts/copy-corpus.ts:572`).

5. **Reconcile content and behavior.** Compare table counts, per-source/language aggregates, embedding provenance and dimensions, expected indexes, integrity checks, and row fingerprints (`apps/rag/scripts/copy-corpus.ts:393`). Then run deterministic vector probes and require identical ranked chunk IDs with score deltas no greater than `1e-5` (`apps/rag/scripts/copy-corpus.ts:444`). Empty or skipped probes must not count as retrieval equivalence (`apps/rag/scripts/copy-corpus.ts:469`).

6. **Produce evidence that is safe to retain.** Reject serialized output containing PostgreSQL URLs or fields named `raw_content` or `text`, and keep the report schema limited to non-content metadata (`apps/rag/scripts/copy-corpus.ts:254`). Create the standard report with owner-only permissions, and distinguish mismatch from intentional pause with separate exit statuses (`apps/rag/scripts/copy-corpus.ts:615`). Record that the copy made zero embedding calls (`apps/rag/scripts/copy-corpus.ts:590`).

## Why This Matters

Offset pagination and blind retry do not prove that an existing target is the same prefix as the source. Native keyset cursors make progress stable, prefix validation detects a polluted target, and conflict-safe inserts make replay harmless. Restoring indexes in a `finally` path prevents a successful data copy from leaving a degraded target.

Equivalence has structural and behavioral dimensions. Structural checks detect missing, orphaned, or changed data; deterministic retrieval probes detect changes visible to the RAG consumer. Reusing stored vectors keeps the proof independent of an external embedding provider and avoids model drift during migration.

This follows the repository's broader practice of retaining redacted operational evidence while excluding credentials, connection strings, and corpus text (session history).

## When to Apply

Use this pattern when the source corpus already contains authoritative embeddings, the target schema accepts those values, and the copy is large enough that interruption is realistic. It is especially useful for local rehearsals before a production migration, where operators need a repeatable acceptance receipt.

Do not treat a local receipt as production proof. Rehearse against the exact production-era schemas and controls. Keep the source read-only, and scope rollback to discarding the target database (`apps/rag/docs/ops/corpus-copy.md:61`).

## Examples

Keep credentials out of command arguments by setting the named environment variables, then run the workflow in stages:

```bash
# Read-only schema, identity, and count preflight.
pnpm --filter @forge/rag db:copy-corpus

# Deliberately pause after three small batches; exit status 2 is expected.
pnpm --filter @forge/rag db:copy-corpus \
  --copy --confirm-local-copy --batch-size 10 --max-batches 3

# Resume the validated prefix and reconcile the finished target.
pnpm --filter @forge/rag db:copy-corpus \
  --copy --confirm-local-copy --resume

# Repeat reconciliation later without writing.
pnpm --filter @forge/rag db:copy-corpus --verify-only
```

The operator runbook maintains these commands and pause/resume expectations (`apps/rag/docs/ops/corpus-copy.md:14`). Unit tests cover safe defaults, explicit acknowledgement, URL rejection, safe report serialization, score tolerance, and the rule that zero probes cannot establish equivalence (`apps/rag/scripts/copy-corpus.test.ts:10`).

## Related

- [Admin production video snapshot and local restore](../developer-experience/admin-prod-video-snapshot-local-restore-20260521.md) — archive-based precedent; unlike this pattern, it is not an idempotent keyset-paginated database-to-database copy.
- [Transcript embedding backfill cancel and resume operations](../workflow-issues/transcript-embedding-backfill-cancel-and-resume-operations.md) — adjacent operator-control and completion-evidence discipline for work that generates embeddings.
- [Provider-bound content embedding backfill gate](../architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md) — adjacent provenance and redaction guidance.
- [JesusFilm/jesusfilm-rag#130](https://github.com/JesusFilm/jesusfilm-rag/issues/130) — migration programme context.
- [JesusFilm/jesusfilm-rag#162](https://github.com/JesusFilm/jesusfilm-rag/issues/162) — local rehearsal work item.
- [JesusFilm/jesusfilm-rag#163](https://github.com/JesusFilm/jesusfilm-rag/issues/163) — production copy follow-up with production-specific controls and evidence.
- [JesusFilm/forge#2086](https://github.com/JesusFilm/forge/pull/2086) — open implementation PR as of 2026-08-28.
