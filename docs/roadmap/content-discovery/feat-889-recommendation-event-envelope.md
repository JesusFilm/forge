---
id: "feat-889"
title: "Define bounded redacted recommendation event envelopes"
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

Own `apps/admin/src/services/recommendations/event-history/envelope.ts` and its
colocated tests. Define versioned family/identity/revision, original
occurred/accepted/expiry timestamps, immutable payload digest and bounded
structurally safe JSON. Family producers still own semantic validation and
redaction; the generic codec cannot establish these alone.

## Owner scope correction — 28 October

The owner selected direct asynchronous one-attempt ClickHouse sending with
measured failures. This supersedes the earlier transactional outbox requirement.
The undeployed outbox module, migration, models, test flags and CI fixture are
removed. Their historical local test results do not establish a live guarantee.
There is no retry queue or 24-hour outage buffer in this version.

## Context and evidence

- Parent: [feat-888](feat-888-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Four envelope behavior tests cover stable serialization/digests, bounded
  payloads, unsafe fields and tampered/malformed envelopes.
- Foundation lint, Admin typecheck and normal hooks passed. The ClickHouse and
  dispatch tickets extend validation as consumers are implemented. Final
  independent review and production evidence remain parent obligations.
