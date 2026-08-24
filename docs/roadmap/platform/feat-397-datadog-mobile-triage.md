---
id: "feat-397"
title: "Datadog mobile triage pipeline"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-08-18"
duration: 3
depends_on: []
blocks: []
tags:
  - "mobile"
  - "infrastructure"
  - "ai-pipeline"
---

## Problem

Nobody observes mobile's Datadog telemetry. The app ships RUM, logs, and
playback QoE under the `forge-mobile` service, and errors sit unnoticed until a
person happens to look. The believed precedent — the web app monitored
overnight by agents — has no artifact in this repo; the web team's "Forge -
Watch" Linear project was filled by a manual QA pass.

The real in-repo prior art is the feat-326 support-research pipeline, which
already solved scheduling, thresholds, dedup, budgets, and Linear dispatch for
a different signal source.

Stage 1 only: detection through ticket filing. Stage 2 — agents that pick up
filed tickets and validate feasibility against the repo — is deferred to its
own plan.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-1419-feat-datadog-mobile-triage-plan.md` — the plan
   this shipped from, including the Product Contract and every KTD.
2. `docs/runbooks/datadog-mobile-triage.md` — provisioning, dry run, rollout,
   operator levers, and the weekly liveness check.
3. `apps/mastra/src/mastra/workflows/datadog-mobile-triage.ts` — the schedule
   and the exported `executeDatadogTriage` orchestrator. Read the header
   comment: the ordering of drain, detect, enqueue, dispatch, commit is
   load-bearing.
4. `apps/mastra/src/services/datadog-triage/detect.ts` — all detection logic,
   pure and fixture-driven.
5. `apps/mastra/src/services/datadog-triage/datadog-client.ts` — read the
   "Contract verification status" header before editing any schema in it.
6. `apps/mastra/migrations/003-datadog-triage.sql` — the schema.
7. `apps/mastra/CLAUDE.md` — the `DATADOG_TRIAGE_*` env table and the
   architecture bullet.

## Grep These

- `DATADOG_TRIAGE_` — the whole env surface.
- `datadog_triage.` — every SQL touchpoint.
- `datadog-triage-key:` — the Linear idempotency marker.
- `cursorSource(` — the per-source cursor key format.
- `isDevShapedIssue` — the R17 release-session filter.

## What Was Built

- **U1** `DATADOG_TRIAGE_*` + `LINEAR_DATADOG_TRIAGE_*` env blocks, all
  optional or defaulted, plus `getDatadogTriageReadiness`.
- **U2** Migration `003` and `PostgresDatadogTriageRepository`: runs lease,
  per-source cursors, service baselines, seen issues with epochs, monitor
  states, spike baselines, and the actions outbox with the per-UTC-day budget
  in the SQL claim. Plus an opt-in real-Postgres smoke.
- **U3** Read-only `DatadogTriageClient` over Error Tracking search/detail,
  monitors, and logs/RUM aggregates.
- **U4** Pure detection: windows, filters, epochs, baselines, per-run cap.
- **U5** `datadogTriageAgent`, the analyzer seam, the pure action policy, and
  ticket drafting.
- **U6** Scoped Linear client and the outbox dispatcher.
- **U7** The hourly workflow, registered in `apps/mastra/src/mastra/index.ts`.
- **U8** This ticket, the runbook, and the CLAUDE.md entries.

## Constraints

- **Never write to Datadog.** The mute lever is a human action in Datadog's UI;
  the pipeline only reads states.
- **Never set Linear priority or assignee.** The create payload has no such
  field, and it should stay that way.
- **Do not tear down the `datadog_triage` schema to roll back.** Rollback is
  `DATADOG_TRIAGE_ENABLED=false`. Dropping the schema loses the baselines, and
  re-enabling would then file a ticket for every standing error.
- **A release-session filter change requires a paired baseline re-seed.** See
  the runbook.
- `apps/mastra` is not owned by the product authority; changes here need the
  mastra owner's review.

## Verification

```bash
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/mastra lint
```

Opt-in real-Postgres repository smoke (out of CI, throwaway database only):

```bash
createdb forge_datadog_triage_smoke
DATADOG_TRIAGE_REPOSITORY_SMOKE_TEST=1 \
DATABASE_URL=postgresql://localhost:5432/forge_datadog_triage_smoke \
pnpm --filter @forge/mastra test -- repository.smoke
```

Every acceptance example AE1–AE9 has a directly named test. AE1, AE2, AE4, AE5,
and AE6 are named in
`apps/mastra/src/mastra/workflows/datadog-mobile-triage.test.ts`; AE3, AE5–AE9
in `apps/mastra/src/services/datadog-triage/detect.test.ts`; AE3 and AE4 again
at the dispatcher and repository layers.

## Remaining Operator Work

None of this can be done by a merged PR. The feature is inert until it is done.

1. Create the dedicated mobile-triage Linear project in the FGE team.
2. Mint a least-privilege Datadog identity and a scoped application key;
   confirm the org's "Restrict Access by Scope" setting.
3. Provision the secrets into the mastra Railway environment.
4. Apply migration `003` and read back the schema independently.
5. Run the live scoped-key smoke, and **record which scope Error Tracking
   search actually required** plus **whether the response envelope matches the
   documented JSON:API shape** — both are noted as unverified in the client
   header.
6. Run the budget-zero dry-run window and decide purge-or-raise.
7. Confirm with the web owner that no existing automation covers admin's
   Datadog errors before adding the admin service.

## Deferred

- A real heartbeat (a Datadog monitor on the workflow's own logs). Until it
  exists, the runbook's weekly liveness check is the only liveness signal.
- Grouped spike detection; this version runs one ungrouped check per service.
- A retention purge for `datadog_triage`.
- Cross-run root-cause merging.
- Stage 2 feasibility-comment agents.
