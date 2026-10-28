---
id: "feat-889"
title: "Commit accepted events to a bounded durable outbox"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-28"
duration: 3
depends_on: []
blocks: ["feat-888", "feat-890", "feat-891", "feat-892", "feat-893"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own `apps/admin/src/services/recommendations/event-history/envelope.ts`, `outbox.ts`, colocated tests, additive Prisma model/migration, and no other runtime files. Define a versioned stable event envelope with family, logical identity/revision, occurred/accepted/expiry times, payload digest and bounded sanitized JSON. Preserve original expiry and reject malformed/oversized/conflicting identities. Add a transactional pending store with atomic byte/event caps, lease token/expiry, bounded skip-locked claims, acknowledgement fencing, deferred retry and original-expiry disposition. It must compose with the caller's existing transaction; avoid a dual-write gap. No permanent duplicate ledger, no network I/O inside admission transactions. Tests prove rollback, concurrent duplicate/cap admission, worker crash/release, stale lease acknowledgement, deferred retry and expiry through the store's public operations on isolated PostgreSQL. This ticket introduces the foundation only; it cannot claim all writers are migrated.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implemented in `apps/admin/src/services/recommendations/event-history/` and
`apps/admin/prisma/migrations/0164_recommendation_event_outbox/`. The version-1
envelope has stable family/logical ID/revision, original occurrence, acceptance
and expiry timestamps, a canonical payload digest, approved top-level fields,
sensitive-key rejection and a 128 KiB serialized bound. Family producers still
own semantic privacy validation and redaction before building envelopes.

The outbox is a temporary forwarding store. It joins the caller's Prisma
transaction, locks a singleton capacity row for atomic event/byte admission,
uses bounded `FOR UPDATE SKIP LOCKED` claims, fences acknowledgement and defer
with lease tokens, and disposes rows at their original expiry. Acknowledged
payloads are deleted; no permanent event-history copy is created here. The
relay, producers, transport and physical retirement belong to dependent
tickets.

Verification: envelope tests were written red before the codec; real-store
behavior tests were written before the store implementation. Fourteen focused tests
passed against a disposable PostgreSQL 18 container with only migration 0164
applied, covering transaction rollback, duplicate/conflict, concurrent cap,
lease retry/fencing, concurrent `SKIP LOCKED`, fresh-client recovery, defer,
expiry and byte cap. Each database case resets only the owned fixture tables,
so filtered `-t` runs exercise the same assertions independently. `prisma
generate`, scoped lint and focused tests passed
using the repository's pinned Node 24.22.1. Full Admin typecheck passed before
the implementation commit.
All ten database cases also passed when run separately with `-t`. A remote
`outbox_test` URL failed the fixture guard before database connection or cleanup.

CI integration still required: provision a disposable loopback PostgreSQL
database named `outbox_test`, apply migration 0164, set
`RECOMMENDATION_OUTBOX_DB_TEST=1` and
`RECOMMENDATION_OUTBOX_TEST_DATABASE_URL=postgresql://.../outbox_test`, then run
the colocated `outbox.db.test.ts` suite. Its default skip is not CI proof;
the local owned-container run above is the current behavior receipt.
