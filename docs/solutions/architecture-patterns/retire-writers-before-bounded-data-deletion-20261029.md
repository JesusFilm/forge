---
title: "Separate writer retirement, row deletion and schema removal"
date: "2026-10-29"
category: "architecture-patterns"
module: "Admin Recommendations"
problem_type: "architecture_pattern"
component: "database"
severity: "high"
applies_when:
  - "Retiring a persisted learner while preserving request and playback evidence"
  - "Deleting production data across rolling application deployments"
  - "Operating a bounded cleanup through a provider management API"
tags: [recommendations, retirement, postgres, deployment, cleanup, cli, quotas]
---

# Separate writer retirement, row deletion and schema removal

## Context

Retiring viewer profiles and co-watch required more than removing retrieval
dependencies. Old replicas, workflow replay, privacy erasure, foreign-key
cascades and retained historical references could still touch those rows.
Video content profiles were metadata that had to remain, despite their name.

The deployed operator also exposed two gaps that service-level tests missed:
a broad admission query exceeded its five-second budget, and the CLI rejected
its own required `--proof-sha256` flag. Indexed admission and an actual CLI run
against a populated disposable database verified the respective repairs.
The [release report](../../reports/2026-10-29-behavioral-recommendation-retirement.md)
owns dated production outcomes; this document describes the reusable design.

## Guidance

1. **Retire readers and writers first.** Cover request paths, native identity,
   boot registration, replay, feedback, manual routes and CLIs. Preserve the
   explicitly retained product contracts. Deploy normally, then verify every
   actual HTTP, worker and client replica, its revision and runner role. A
   merged PR or healthy endpoint alone does not establish this cutover.
2. **Keep row deletion separate from schema removal.** Install compatible
   constraints and a bounded operator before deleting data. Detach retained
   references before deleting their parents. Enumerate the direct-delete set;
   do not infer scope from table-name prefixes or broad cascades. Remove empty
   tables, indexes and compatibility code in a later reviewed migration.
3. **Bind each operation to the deployed source.** Require an expiring proof of
   actual roles, migration/catalog state and inactive retired runtimes. Keep
   the operation ID and source immutable. If a repair changes the deployed
   source, reconcile the old operation and start a new one. A stale business
   ledger must be interpreted with its joined runtime; preserve failed history.
4. **Commit deletion and counters together.** Bound rows and transactions,
   coordinate with ordinary retention through the shared advisory lock, and
   write batch ID, sequence, phase and counts in the mutation transaction.
   An empty `SKIP LOCKED` result is not proof that a table is empty. Recheck
   existence and distinguish locked rows or protected references from completion.
5. **Make transport uncertainty visible.** Persist dispatch intent and original
   stdout/stderr before parsing. Require one framed acknowledgement per window;
   reconcile missing acknowledgements against the durable ledger before any
   further mutation. A finite persistent SSH session can avoid a connection per
   window while still invoking only the deployed CLI and checking inventory
   before every dispatch. It must not become an unbounded unattended loop.
6. **Read final state independently.** CLI completion must be followed by fresh
   exact counts for every retired table, detached references and retained-data
   checks. Here profiles are deleted last: the compatibility profile-erasure
   path reads and inserts suppression within one transaction, and erasure must
   update the profile before commit.
   If cleanup wins that profile deletion, the erasure transaction rolls back;
   if erasure wins first, the final census detects remaining suppression. A
   nonzero result requires bounded continuation and another census, not an
   arbitrary fixed wait. Report this as observed state under the deployed source.

Inventory other suppression writers separately. Migration 0164 retains the
`cowatch_outcome_removed` trigger introduced in migration 0108. Its
`suppress_cowatch_retained_outcome` function inserts suppression from
`recommendation_cowatch_source_contribution`. Current application outcome deletion
through ordinary retention/playback cascades shares advisory lock `368000001`
with the retirement operator. The operator drains those source rows before
suppression, so the retained trigger then has no source inputs. The profile-update
rollback argument applies to profile erasure; it does not cover every writer.

## Why This Matters

The source, data and transport proofs answer different questions. A valid
deployment does not prove deletion, a successful CLI does not prove final zero,
and a lost response does not prove rollback. Keeping these receipts distinct
allows safe continuation without rewriting history or duplicating work.

Provider quota is another independent bound. Capture status and quota headers
before interpreting them, use a truthful application User-Agent, and pace from
the observed limit. Missing or malformed quota information stops dispatch.
Railway returned an ISO timestamp for reset; once a response crossed that
boundary before local validation, the strict future-reset check stopped even
though HTTP was 200 and quota remained. A separately authorized fresh read and
ledger reconciliation supported resumption without weakening the check or
retrying a deletion. An HTTP 429 requires honoring its retry boundary.

## When to Apply

Use this pattern when old and new deployments overlap, when retained evidence
references retired models, or when cleanup needs multiple bounded invocations.
Keep ordinary expiry acceptance separate: manual retirement earns no scheduled
cycle credit, and deleted rows do not establish recovered filesystem bytes.
Measure relation allocation and PGDATA/WAL separately; reusable pages and
physical reclamation are different observations.

## Examples

- `apps/admin/src/services/recommendations/behavioral-retirement-cleanup.ts`
  defines phase ordering, retained-reference protection and atomic batch receipts.
- `apps/admin/src/scripts/retire-behavioral-recommendations.ts` validates the
  deployed source and invokes the operator. Test the actual entrypoint with all
  required flags against a populated schema, in addition to parser/service tests.
- `apps/admin/prisma/migrations/0164_retire_behavioral_recommendation_rows/migration.sql`
  removes source/profile reseeding triggers and adjusts compatibility constraints without
  performing the production row drain in the migration.

## Related

- [Writer cutover](https://github.com/JesusFilm/forge/pull/2957),
  [bounded operator](https://github.com/JesusFilm/forge/pull/2958),
  [indexed admission](https://github.com/JesusFilm/forge/pull/2959) and
  [actual CLI repair](https://github.com/JesusFilm/forge/pull/2960).
- [Retiring embedding pipelines](legacy-embedding-pipeline-retirement-tombstone-pattern.md)
  covers external compatibility surfaces and intentionally retained historical data.
- [Retirement documentation sweep](../workflow-issues/mechanism-retirement-docs-prose-sweep.md)
  covers active prose that can accidentally restart retired mechanisms.
- [Retention phase admission](../database-issues/recommendation-retention-phase-budget-admission-20261006.md)
  covers truthful budget yields and genuine failures in ordinary expiry.
