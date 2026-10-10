---
id: "feat-355"
title: "Add bounded SEO run audit log"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-11"
duration: 1
depends_on:
  - "feat-344"
blocks:
  - "feat-356"
tags:
  - "platform"
  - "mastra"
  - "manager"
  - "admin"
  - "seo"
  - "audit"
---

## Problem

The SEO workspace shows proposals and coarse run coverage, but operators cannot
inspect which bounded Search Console evidence reached the decision stage, why a
query was selected or not selected, or how a machine proposal relates to later
human outcomes. The existing `SeoRun.report` is the correct one-report-per-job
boundary, but it currently retains only aggregate counts.

## Entry Points — Read These First

1. `docs/plans/2026-08-11-002-feat-seo-run-audit-log-plan.md` — reviewed implementation plan and safety limits.
2. `apps/mastra/src/mastra/workflows/seo-daily-audit.ts` — report production and fenced completion.
3. `apps/admin/src/services/seo-experiment.service.ts` — canonical ledger and Manager read models.
4. `apps/manager/src/features/seo/seo-workspace.tsx` — existing operator workspace.
5. `apps/admin/src/services/search-trace-retention.service.ts` — existing retention scheduler boundary.

## What To Build

1. Expand `SeoRun.report` into a strict, versioned, bounded, sanitized operator projection for live and dry-run jobs.
2. Add Admin-owned paginated run summaries and one ID-scoped typed detail read, composed with current canonical proposal outcomes.
3. Add a route-driven Runs index and stable per-run detail page in Manager without eagerly loading report JSON.
4. Compact query/request detail after 29 days, enforce expiry on reads, and fail closed to summary-only capture when retention health is unavailable.

## Constraints

- Do not add a second audit table or persist raw provider responses/runtime traces.
- Do not change proposal selection, approval, publish, ticket, or deployment authority.
- Keep query detail Manager-operator-only; agent/workflow audit access is out of scope.
- Preserve legacy report ingestion during rolling deployment and expose legacy/malformed/expired states without raw JSON pass-through.
- Regenerate Admin GraphQL schema and `packages/admin-graphql` contracts.

## Verification

- Mastra analysis/workflow tests prove decision-funnel invariants, dry-run zero writes, report bounds, safe errors, and terminal failure behavior.
- Admin service/retention/GraphQL tests prove canonical proposal disposition, typed legacy states, permissions, cursor stability, bounded compaction, and read-time expiry.
- Manager tests and authenticated browser checks prove run index/detail states, routing, keyboard/focus behavior, responsive query evidence, and summary/detail loading limits.
