---
id: "feat-549"
title: "Audit historical Studio render retention after profile trigger repair"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-09-23"
duration: 2
depends_on: ["feat-543"]
blocks: []
tags: ["manager", "ai-pipeline", "security"]
---

## Problem

The fresh-database render regression exposed an existing profile ID mismatch in
migration 0094: its output-retention trigger compares `shorts-render-1/...` while
the canonical renderer emits `studio-render-1/...`. The trigger therefore skips
retention and trusted-producer/issued-lease checks for that canonical profile.
Feat-543 corrects future registrations with an additive migration. Existing
registrations require a separate evidence-based audit; this ticket does not
assert that production has affected rows or authorize production writes.

## Entry Points — Read These First

1. `apps/admin/prisma/migrations/0094_shorts/migration.sql` — `short_attach_render_asset`.
2. `apps/admin/prisma/migrations/0099_studio_render_retention_profile/migration.sql` — corrected trigger.
3. `apps/admin/src/services/studio-authoring/render-jobs.db.test.ts` — exact-lease retention and producer denial tests.
4. `packages/studio-contracts/src/render.ts` — immutable canonical profile identity.

## Grep These

- `short_attach_render_asset|short_render_retained_asset`
- `studio-render-1|shorts-render-1|leaseId|profileId`

## What To Build

- Produce a bounded read-only audit of historical canonical-profile registrations
  and their producer, attempt, issued-lease, execution, and retained-output edges.
- Distinguish verified missing edges from untrusted or unverifiable metadata.
- Propose an idempotent repair only for independently verified edges; do not turn
  metadata alone into trusted render evidence or approval.
- Document counts, unknowns, rollback considerations, and any required retention
  or publication follow-up. Seek explicit authorization for production repair.

## Constraints

Preserve immutable asset bytes, historical attribution, and exact-output approval.
Do not rewrite applied migrations, automatically approve artifacts, or deploy
local code. Audit and production repair remain separate actions.

## Verification

Exercise the audit and proposed repair on disposable fixtures containing valid
missing edges, spoofed actors, unknown leases, duplicates, and complete edges.
Rerunning a repair must add no duplicate effects. Record actual environment and
counts only after an authorized audit; no production audit was performed during
the external-agent implementation.
