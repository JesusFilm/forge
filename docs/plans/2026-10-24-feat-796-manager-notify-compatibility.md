# Manager stale notification cleanup

Scope: feat-796, PR #709. Preserve PR ancestry through a local merge of pinned
main, resolve each actual conflict semantically, and retain all current contracts.

1. Prove the old form has no import, re-export or dynamic caller; preserve active
   `inputUrl` creation and `activeJobs` behavior.
2. Remove the form and unused typed `notifyCms` only. Preserve opaque old options.
3. Retain `cms_notify` for strict persisted reads, absent execution inventories.
4. Correct only static notification copy and type comments, preserving the map,
   icon, fallback, imports, hooks, requests, initialization and render structure.
5. Add dated Admin supersession notes to todos 019/022/023 without erasing April
   history. Do not revive CMS sync or extend TTS/Agentic/embedding/callback work.

Actual-package parser regressions must fail with the enum value removed and pass
with compatibility retained. Include mixed lists, legacy current/completed steps,
old options, invalid names/statuses and modern Smart Crop/Shorts records. Preserve
state persistence failure, explicit terminal null clear, artifacts and Mastra
details. Validate focused tests, types, lint, format, roadmap, pins and normal
hooks; record exact clean candidate identity for a new parent-owned independent
review. No candidate acceptance or publication is implied by author validation.

The explicit plan, bounded implementation, local source audit and durable
compatibility/todo notes carry the plan/work/review/compound loop. No Compound
Engineering command is claimed to have run.

## 2026-10-31 UTC — current-main source integration

The incoming published head is `667347dfc7c49b46bf4cf4ace5d5e42d60357f66`.
Its original integrated base is `5fdcd7fbc10488bed68117e0e052d0564f876d10`.
Compose pinned main `c2e4bd3aec94198fc074ec7c37e546469d6001d1` with a normal
`--no-commit --no-ff` merge in the assigned detached checkout. The sole offered
path changed on main since that base is `apps/manager/src/backend/admin-client.test.ts`;
the step-table intersection named in R13 prose was incorrect. The merge completed
without conflicts and preserves both main catalog-batch/artwork-failure cases and
all incoming parser fixtures. No additional test source is needed for this seam.

Retain feat-796 with its existing identity and empty `depends_on`/`blocks` edges;
mark it in progress for this integration. The parent identity proof inspected 180
retained/frozen references and found only this same-scope identity. Allocate no
new ID and leave the unrelated feat-918 reservation alone.

Source inspection traces `listJobs` and `getJob` through the actual Admin parser,
whose enum comes from `WORKFLOW_STEP_NAMES` and whose options remain opaque.
The incoming cases cover current/completed legacy steps, mixed lists, detail,
modern Smart Crop, historical Shorts and invalid names/statuses. Preserve the
existing state/workflow tests for terminal null clearing, persistence, artifacts and
Mastra correlation. Synthetic records do not prove production occurrence.

Bounded import/export/name and dynamic-loader searches find the old form's only
main references inside that form itself. `POST /api/jobs` still validates HTTPS
`inputUrl`; the current Jobs page renders `LiveJobsTable`. The literal `activeJobs`
is absent from both incoming and main Manager source, so preserve the current
list/realtime and creation paths rather than restore a historical identifier.
The active table changes only its description string; source/API imports, hooks,
requests, initialization and render structure remain unchanged relative to pinned
main. This source comparison is not a runtime or page-loading measurement.

This pass is LIGHT source only while #2685 native Safari owns the heavy phase.
No tests, typecheck, lint suites, install, build, server, browser, device, hooks,
commit or push may run, even if that worker finishes without a parent release.
Only source/Git checks and an already-available exact-file formatter are allowed.
Retired guard/quota tools must not run. Freeze the staged uncommitted tree and
record its actual `git write-tree`, intended parents, index hash and full diff.

After parent release, run the focused actual-package parser/state/workflow tests
with at most two workers, typecheck, lint, format, roadmap checks, functioning
normal hooks and current-candidate CI. For the meaningful red control, use
parent-approved disposable validation source: record the exact candidate bytes,
remove only the `cms_notify` enum literal, run the real Admin client legacy cases
and observe parser failures, restore those exact bytes and rerun green. Do not
mutate the frozen candidate for this control or count a type error as parser proof.
The handoff gives exact paths and commands; none executed in this pass.

Preserve the historical qualification: the earlier normal commit exited 0, but
lint-staged applying/restaging failed on ignored tracked `.context` artifacts.
Do not describe that as clean hooks, resurrect the removed pending todo for
convenience, bypass hooks or broaden this source slice into hook configuration.
Parent must resolve hook compatibility before future publication.

CE review here is the writer's source audit, not independent review. Compound
learning: persisted read vocabulary can outlive execution, and historical CI or
completed todo history cannot certify a new main composition. Independent review,
parser execution, runtime/loading acceptance, hooks and current CI remain pending.
Keep the PR draft and ticket in progress; this source handoff grants no readiness,
publication, activation, merge or deployment acceptance.

The current main-relative whitespace diff is clean. The full staged merge diff
against incoming reports existing blank lines at EOF in main's mobile fixtures
`apps/mobile/release-check/__tests__/fixtures/devices/adb-devices.txt` and
`apps/mobile/release-check/__tests__/fixtures/journeys/driver-ios/maestro-stderr.txt`.
Their candidate blobs equal pinned main; preserve them outside this cleanup.
This checkout also lacks `.husky/_` despite configured `core.hooksPath`; later
publication must bootstrap and verify functioning normal hooks, not treat their
absence as success. No hook configuration changes are included here.
