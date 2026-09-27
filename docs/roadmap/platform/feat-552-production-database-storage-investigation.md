---
id: "feat-552"
title: "Investigate production database storage pressure"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-09-28"
duration: 1
depends_on: []
blocks:
  - "feat-553"
tags:
  - "admin"
  - "recommendations"
  - "database"
  - "capacity"
  - "operations"
---

## Problem

Production is reported at approximately 40 GB of a 50 GB volume. An earlier
read-only investigation attributes growth to recommendation candidate traces,
29-day retention, and a redundant index. Verify the mechanism, identify the
introducing changes, and distinguish fresh measurements from supplied evidence.

## Entry Points — Read These First

1. `apps/admin/src/services/recommendations/delivery.service.ts`
2. `apps/admin/src/services/recommendations/retention.service.ts`
3. `apps/admin/src/services/recommendations/retention/job.ts`
4. `apps/admin/prisma/schema.prisma` and `apps/admin/prisma/migrations/`
5. `docs/operations/semantic-recommendation-tracer.md`

## Grep These

- `RECOMMENDATION_RAW_RETENTION_DAYS`
- `candidate.*evidence|evidence.*candidate`
- `CREATE INDEX|CREATE UNIQUE INDEX`
- `batchSize|expires_at|retention`

## What To Build

- A dated investigation report with relation/index sizes when accessible,
  row amplification, retention behavior, commit/PR attribution, and next actions.
- Read-only, bounded SQL suitable for repeating the storage measurements.
- A separate remediation ticket if operational or implementation work remains.

## Constraints

- Investigation only: do not change production data, configuration, indexes,
  or deployments.
- Preserve existing user changes by working in an isolated worktree.
- Never retain credentials, request payloads, or viewer identifiers in artifacts.
- Attribute code changes factually; commit ownership alone does not establish
  individual responsibility for capacity planning or production activation.

## Verification

- Reconcile source, migrations, git history, and available production metadata.
- Record query timestamps and distinguish estimates from exact measurements.
- Review all report claims against their cited evidence.
- Run Markdown formatting and roadmap metadata checks for the touched files.

## Investigation Result

Completed read-only production inspection on September 28 NZDT. The report and
repeatable SQL are in `docs/reports/2026-09-28-production-db-storage/`. Confirmed
recommendation evidence dominates storage, attributed the introducing changes,
verified duplicate indexes, and measured 1.55 GB/day disk growth. Production
remediation remains open in feat-553; no production state was changed.
