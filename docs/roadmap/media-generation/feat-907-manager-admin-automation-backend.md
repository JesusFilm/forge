---
id: "feat-907"
title: "Restore Manager automations on Admin"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-28"
duration: 5
depends_on: []
blocks:
  - "feat-908"
tags:
  - "manager"
  - "graphql"
  - "ai-pipeline"
---

## Problem

The removed Strapi backend owned enrichment automation definitions, run history, atomic claims and recurring scheduling. `apps/manager/src/features/agents/automation-store.ts` and `automation-runner.ts` still use its tombstoned GraphQL and REST clients. Admin currently exposes Manager job and read-model contracts but no replacement enrichment automation backend. Error handling in feat-906 does not restore execution.

## Entry Points — Read These First

1. `apps/manager/src/features/agents/automation-contract.ts` — draft, schedule and run report contracts.
2. `apps/manager/src/features/agents/automation-store.ts` — all persistence and atomic claim/release operations that need replacement.
3. `apps/manager/src/features/agents/automation-runner.ts` — legacy candidate selection read model and dry-run boundary.
4. `apps/manager/src/app/dashboard/agents/page.tsx` — legacy language-options and list reads.
5. `apps/admin/src/graphql/types/managerJob.ts` and `apps/admin/src/services/manager-job.service.ts` — current durable Manager contract pattern.
6. `apps/manager/src/backend/admin-client.ts` — Manager Admin adapter.
7. `docs/solutions/integration-issues/manager-automation-dry-run-report-boundary-20260413.md` — execution invariants.

## Grep These

- `enrichmentAutomation|claimAutomationDryRun|hasInFlightAutomationRun`
- `fetchAutomationSelection|automation-candidates|cmsGet`
- `managerBackend|ManagerEnrichmentJob`

## What To Build

- Admin-owned durable definitions and runs with service-authorized GraphQL contracts and regenerated SDL/introspection.
- Manager adapter replacements for creation, list/detail, status, candidate selection, run history and atomic lease helpers.
- A durable recurring scheduler with atomic claims, bounded dispatch and explicit recovery, preserving caps, pause/resume and next-run advancement.
- Admin-backed language options and validation.

## Constraints

- Never use Manager local files or in-memory state as production automation persistence.
- Saving a definition alone does not restore recurring execution.
- Preserve dry-run suppression of enrichment writes, exact target-language validation, duplicate suppression and per-cycle caps.
- Preserve existing mock behavior. Do not restore Strapi clients or cross-import app contexts.
- Production delivery follows PR-to-main deployment.

## Verification

- Real-database integration tests prove durable create/list, competing claims, lease recovery and pause/resume behavior.
- Scheduler tests prove no-op cycles advance, failures are visible, caps hold and dry runs enqueue no real jobs.
- Browser creates the screenshot's source-subtitle dry-run automation (weekly Monday, six videos), reloads it, runs a report and pauses/resumes it.
- Admin schema drift, admin-graphql generation, touched-package tests, typecheck, lint, format and page-load checks pass.

## PR870 recovery unit — 2026-10-28

Manager's service-only idempotent dry-run lane and its actual committed Mastra
workflow/tool are implemented in the isolated recovery unit. Both manual lanes
share lease-fenced orchestration; the dedicated service bearer grants no
operator/session authority. See
`docs/reports/2026-10-28-pr870-mastra-dry-run-recovery.md` for the exact contract,
red regression evidence, deterministic workflow proof and integration limits.
This isolated unit handed final Admin/browser/PR review and integration to root.

## Foundation review repair unit — 2026-10-28

The five foundation findings are repaired in an isolated follow-up: recurring
bootstrap reconciliation, pre-queue binding of the SDK's actual runtime ID,
same-ID recovery of partial starts and retired-timer exit; requested-parent
locking before manual lease recovery; atomic admission for both manual lanes;
and strictly future wall-clock scheduling across IANA gaps/folds. See
`docs/reports/2026-10-28-feat890-foundation-review-repairs.md` for reproduction,
verification and exact integration boundaries. This unit adds no schema,
generated-client, lockfile, OAuth or Docker changes. Root completed integration
and independent review after this handoff.

## Final local integration — 2026-10-29

Implementation, independent source reviews, production builds and deterministic
HTTP/GraphQL/PostgreSQL acceptance are complete. Configuration and execution
flags retain their defaults. The declared PR stack and exact verification limits
are recorded in `docs/reports/2026-10-29-automation-pr-stack-validation.md`.
Remote CI and PR publication are tracked by the recovery task.
