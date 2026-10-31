---
id: "feat-796"
title: "Remove stale Manager notification affordances and preserve legacy reads"
owner: "vlad"
priority: "P2"
status: "in-progress"
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

### 2026-10-31 UTC current-main integration — pending execution

Keep this ticket in progress. The LIGHT source-only pass composes published head
`667347dfc7c49b46bf4cf4ace5d5e42d60357f66` with pinned main
`c2e4bd3aec94198fc074ec7c37e546469d6001d1` without a commit. Only
`apps/manager/src/backend/admin-client.test.ts` changed on main among the ten
offered paths since original base `5fdcd7fbc10488bed68117e0e052d0564f876d10`.
Both new main tests and every incoming compatibility case survive the clean
merge. No new feature ID, dependency edge or test source is added.

Source checks establish no old form caller, strict actual Admin parser wiring,
unchanged HTTPS `inputUrl` creation and current list/realtime paths, and a
static-only step description change. The historical `activeJobs` literal is
absent from both pinned inputs. No requests, hooks, initialization or render
structure changed relative to pinned main. This does not measure page loading.

No tests, typecheck, lint suites, install, build, server, browser, device, hooks,
commit or push run in this pass. #2685 native Safari owns the heavy phase; only
the parent can release executable validation. Retired guard/quota tools must not
run. The dated plan and parent handoff specify focused actual-package tests
(maximum two workers), types, lint, format, roadmap checks, and a disposable
legacy-enum-removal red control followed by exact-byte restore and green rerun.
Independent review, parser/runtime/loading acceptance, functioning normal hooks
and current-candidate CI remain pending. Static cleanup does not intrinsically
require native devices or provider execution. Preserve the draft PR.

### Historical evidence — not current-candidate acceptance

The prior author reported 73 focused package tests and 19 offline controls;
removing only the legacy enum literal failed two mixed-list cases while 18 other
parser tests passed. Prior Manager typecheck/lint and the 15-file preservation
audit were reported on the earlier candidate, not this composition. Published CI
reported 20 successes and 8 skips; Manager's 1360 passes and 3 skips ran on
synthetic merge `95ddcbbaf960222e6e2fbe863506c00b4db46910` against original
base `5fdcd7fbc10488bed68117e0e052d0564f876d10`.

The earlier normal commit exited 0, but lint-staged applying/restaging failed on
ignored `.context`; this remains a hook qualification. Future publication requires
functioning normal hooks with every check and no bypass. Hook configuration and
the three historical completed todo narratives remain unchanged by this
integration. No production legacy-row occurrence or original human reporter is
established; direct claim sources are branch-local todo 019 and the PR body.
