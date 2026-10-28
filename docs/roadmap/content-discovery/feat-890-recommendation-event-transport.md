---
id: "feat-890"
title: "Persist canonical event history through durable transport"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-889"]
blocks: ["feat-888", "feat-891", "feat-892", "feat-893"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own new `event-history/clickhouse.ts`, schema SQL and HTTP boundary tests. Implement bounded authenticated ClickHouse HTTP insert/read with strict response validation, deadlines, sanitized typed errors and injectable transport. Inserts confirm synchronous persistence before a caller treats delivery as successful. Canonical reads deduplicate logical identity/revision and enforce original expiry before physical cleanup. Preserve correction ordering and immutable digest conflict detection. Qualify incomplete responses, duplicate delivery and partial batches. Define safe privacy/expiry filtering and remote erasure before enabling personal payload delivery. Do not provision accounts or services, change workflows, or use arbitrary caller SQL/URLs. Actual provider credentials/configuration are parent-owned. No retry queue or outbox guarantee is claimed by this sink.

## Context

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

Implemented `apps/admin/src/services/recommendations/event-history/clickhouse.ts`
and its `clickhouse.sql` schema. The configured HTTPS endpoint is fixed at
construction; test-only HTTP is limited to loopback. The client uses bound SQL
parameters for up to 100 explicit logical IDs, batches inserts to 100 events
and 1 MiB, limits responses to 32 MiB, and applies a hard 10-second default
deadline to both request and response body. It sets `async_insert=0` and
`wait_end_of_query=1`, accepts only a complete empty HTTP 200 insert response,
and never retries internally. Transport errors expose a typed code without
server text, credentials or payloads.

The append-only MergeTree preserves conflicting same-revision digests through
background merges. Reads group all physical duplicates by identity/revision,
reject any conflicting revision, select the latest revision, then apply its
original expiry. Terminal erasure markers suppress reads and later inserts;
the erasure operation also requests synchronous lightweight deletion. Physical
deletion after an already in-flight insert, backup removal and cross-store
generation fencing remain feat-895 work and are not claimed here. There is no
TTL that could revive an older revision after a newer one expires.

Nine HTTP boundary tests and five real ClickHouse tests passed locally against
`clickhouse/clickhouse-server:25.8.15.35` at image digest
`sha256:d01390d78c277f72b961599ca7cbeedd25b13a1833e44cb608a2fbff8bcf7fb6`.
The real tests exercise regrouped duplicate deliveries, a partial-batch
replay, corrections, conflicting digests after `OPTIMIZE ... FINAL`, expiry
ordering and repeated erasure. HTTP tests exercise ambiguous 200/failed
responses, invalid success status, oversized input, malformed output and a
stalled body deadline. Scoped lint, Prettier and full Admin typecheck passed.

CI wiring still required: start an isolated loopback ClickHouse container from
the pinned image above with database `event_clickhouse_test`, user `event_test`,
password `event_test_password` and host port `18123`; apply `clickhouse.sql`;
set `RECOMMENDATION_CLICKHOUSE_DB_TEST=1` and
`RECOMMENDATION_CLICKHOUSE_TEST_URL=http://127.0.0.1:18123/`; run the colocated
`clickhouse.db.test.ts` suite. Its default skip does not count as CI proof.

Protocol basis: [ClickHouse asynchronous inserts](https://clickhouse.com/docs/optimize/asynchronous-inserts),
[HTTP interface](https://clickhouse.com/docs/interfaces/http), and
[lightweight deletion](https://clickhouse.com/docs/guides/developer/lightweight-delete).
