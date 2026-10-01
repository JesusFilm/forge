---
title: Prepare guarded legacy recommendation storage reclamation
type: fix
status: active
date: 2026-09-29
---

# Prepare guarded legacy recommendation storage reclamation

## Origin and scope

The user authorized continuing the remaining storage work. The requirements are
`docs/roadmap/platform/feat-554-recommendation-storage-rollout-verification.md`
and `docs/roadmap/platform/feat-555-recommendation-legacy-trace-reclamation.md`.
Preserve every observation for its existing 29-day lifetime. Prepare the eventual
physical reclamation now while production retention and capacity checks continue.

The September 28 rollout and ten-run lossless conversion are complete. Neither
proves loaded request cleanup or filesystem recovery from the legacy relation.
The latest known legacy expiry is October 26, 23:24:43.126 UTC; it must be
recomputed from actual writes and followed by verified purge, not treated as
permission to execute.

## Decisions

- Keep one reviewed SQL asset outside `prisma/migrations`, without a package
  command, scheduled task, runtime import or deploy hook. A later reviewed PR
  promotes the tested SQL into a numbered migration only after all entry gates
  pass. No production reclamation or migration-number reservation now.
- Prefer truncating the proven-empty stage relation over dropping its schema.
  Retain the table, constraints, unique index, Prisma model, dual reader and
  compatible legacy/compact application behavior.
- Acquire the exclusive relation lock before the exact emptiness assertion,
  and keep assertion and truncate in one transaction. Use bounded lock and
  statement timeouts, raise on retained evidence, and omit `CASCADE`. A new
  inbound foreign key must fail safely through normal restrictive semantics.
- Validate the exact SQL on an isolated PostgreSQL fixture, including real
  reader/lifecycle behavior. Local relation-allocation recovery is not a claim
  about production filesystem savings or a production-shaped 18 GB scan time.
- Capacity and authenticated production UI checks remain operational work under
  feat-554. No new financial commitment or authentication bypass is implied.

## Implementation units

### U1 — Reviewed SQL and real database proof

Files:

- `apps/admin/src/services/recommendations/sql/reclaim-empty-legacy-stage-relation.sql`
- `apps/admin/src/services/recommendations/legacy-stage-reclamation.db.test.ts`

Follow the explicit transaction in migration 0102, the isolated database patterns
in `migration.candidates.db.test.ts`, `migration.lifecycle.db.test.ts`, and
`legacy-candidate-trace-conversion.db.test.ts`, and the real full-detail reader.
Avoid broad changes to shared harnesses. Use a dedicated disposable database;
never point these tests at production or shared developer data.

Verification scenarios: nonempty refusal preserves exact evidence and parents;
conflicting reader lock times out with clean rollback and later retry; a
concurrent legacy write cannot be lost between the assertion and truncate;
expired-root deletion leaves an exactly empty allocated relation that the SQL
then shrinks; compact detail, items, outcomes/evaluation and expiry are unchanged;
subsequent compact retention still works; legacy issuance and the dual reader
still work afterward; transaction failure cannot leave partial destructive state.
Prove allocation reduction including indexes and TOAST with measured before/after
bytes, not a fixture-specific hardcoded savings claim.

Execution note: establish each real-DB fixture and expected failure condition
before relying on the success path. Do not weaken timeouts to make tests pass.

### U2 — Operational release instructions

File: `docs/operations/legacy-recommendation-stage-reclamation.md`.

Explain the inactive asset, future PR-to-main promotion, entry gates, exact
emptiness and horizon probes, reader-capable rollback floor, lock failure
recovery, and pre/post filesystem measurement. Explicitly distinguish preparation
from deployment and retained-row preservation from reclaiming empty relation
files. Do not provide an early manual production execution shortcut.

### U3 — Review and close this preparation milestone

Update feat-555 with local evidence and remaining production gates; keep its
status in progress. Run scoped formatting, lint, typecheck and real-DB tests,
then independent correctness/data-safety review and PR validation. Keep the
production verification and final reclamation tickets open. Record durable
learnings only when the tests demonstrate them.

## Operational gates outside this preparation

1. Fresh capacity forecast with enough margin through overlap, purge and release.
2. First two nonempty daily retention cycles, using the durable wrapper's actual
   elapsed time and the retention ledger's roots/descendants/backlog evidence.
3. Authenticated production trace-detail smoke.
4. Recomputed last legacy write/expiry; no active legacy writer, retained legacy
   request/run or stage evidence after actual purge.
5. Separate tested reclamation migration PR, normal main deployment, compatible
   rollback image and measured production file bytes recovered.

No shorter retention, bulk conversion, `VACUUM FULL`, `CASCADE`, table/reader
retirement, new tracking tables or direct local-to-production deployment.
