---
id: "feat-796"
title: "Remove stale Manager notification affordances and preserve legacy reads"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-24"
duration: 1
depends_on: []
blocks: []
tags: [manager, cleanup, compatibility]
---

## Problem

PR #709 predates Admin job persistence. Its enum deletion would reject stored
`cms_notify` steps and mixed job lists. The unused form, option declaration and
notification description remain stale on current main.

## Entry Points — Read These First

1. `apps/manager/src/types/job.ts`: persisted `WORKFLOW_STEP_NAMES` and `JobOptions`.
2. `apps/manager/src/backend/admin-client.ts` and `admin-client.test.ts`: strict job parsers.
3. `apps/manager/src/features/jobs/live-job-steps-table.tsx`: exhaustive descriptions.
4. `apps/manager/src/app/api/jobs/route.ts` and `dashboard/jobs/page.tsx`: active creation and list contracts.
5. `.context/compound-engineering/todos/019-complete-p2-remove-legacy-cms-notify-ui-and-step.md`, `022-complete-p3-fix-manager-job-type-comment-after-cms-notify-removal.md`, and `023-complete-p3-reconcile-completed-cms-notify-todo-narrative.md`: April history.

## Grep These

- `NewJobForm|parseLanguageInput|new-job-form|notifyCms|cms_notify`
- `WORKFLOW_STEP_NAMES|FORGE_WORKFLOW_STEPS|buildSmartCropInitialSteps`
- `parseJobRecord|parseJobRecordList|currentStep`

## What To Build

Merge pinned current main into #709 locally, resolving actual conflicts against
current contracts. Remove only the unreachable form and unused typed `notifyCms`.
Keep `cms_notify` for persisted reads with an explicit compatibility comment.
Use `Legacy persisted step; no CMS notification is executed.` in the static
description map. Add dated supersession notes to only the three named todos.
Cover legacy detail/currentStep/completed steps, mixed modern lists, old opaque
options, strict invalid-name/status rejection and Smart Crop/Shorts positives in
the actual Admin client tests. Demonstrate enum-removal red and candidate green.

## Constraints

Preserve all opaque options, context, artifacts, correlations, durable persistence
failure, terminal null clearing, Auth/Admin calls and modern step names. Never
execute notification or weaken validation. No schema/generated edits, retired CMS
restoration, broad sync/TTS/embedding/callback work, install, provider/DB calls or
publication. Independent acceptance belongs to the parent.

## Verification

Run focused Manager parser/state/workflow tests, typecheck, lint, touched-file
Prettier, roadmap/contract pin checks and normal commit hooks with existing
dependencies and pinned Node 24.22.1. Individually guard every heavy foreground
command with `agent-io-guard -- <actual arguments>`. Prove no form caller and
unchanged active creation, imports, hooks, requests, initialization and render
structure; static cleanup provides no whole-app performance measurement.

Author validation: 73 focused package tests and 19 offline controls passed;
removing only the legacy enum literal failed the two expected mixed-list cases
while 18 other parser tests passed. Manager typecheck and lint passed. The
preservation audit verified 15 protected main files, static-only table copy,
unique ticket allocation and byte-preserved April history. Parent-owned fresh
independent review and any publication remain separate acceptance steps.
