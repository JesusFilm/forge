---
title: "fix: Mastra Subtitle Review Findings"
type: fix
status: active
date: 2026-05-05
origin: https://github.com/JesusFilm/forge/pull/886
branch: feat/116-agentic-subtitle-enrichment-workflow
---

# fix: Mastra Subtitle Review Findings

## Overview

Resolve the review findings from PR #886 before the Mastra subtitle enrichment
workflow bridge is marked ready. The current branch passes unit/build checks,
but it is not mergeable against current `origin/main`, and review found several
runtime reliability gaps that should be fixed or explicitly deferred before
promotion.

## Source Findings

- `todos/017-pending-p1-resolve-mastra-subtitle-merge-conflicts.md`
- `todos/018-pending-p2-ignore-manager-test-artifacts-in-format-check.md`
- `todos/019-pending-p2-start-real-mastra-subtitle-runs.md`
- `todos/020-pending-p2-do-not-cache-transient-subtitle-launch-failures.md`
- `todos/021-pending-p2-persist-mastra-event-idempotency-and-terminal-state.md`

## Current Review Evidence

- `git merge-tree --write-tree origin/main HEAD` failed with conflicts in:
  - `docs/roadmap/README.md`
  - `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
  - `pnpm-lock.yaml`
- `pnpm --filter @forge/mastra test` passed.
- `pnpm --filter @forge/manager test` passed.
- `pnpm --filter @forge/mastra lint && pnpm --filter @forge/mastra typecheck && pnpm --filter @forge/mastra build` passed.
- `pnpm --filter @forge/manager lint && pnpm --filter @forge/manager typecheck` passed.
- `pnpm run format:check` failed after Manager tests generated ignored
  `.tmp` JSON artifacts, then passed after deleting those generated files.
- Browser/API smoke proved Mastra `/health` returns 200 and anonymous/service
  token access to built-in `/api/agents` remains 401.

## Proposed Solution

Keep this as a review-fix pass on the same PR branch. Resolve the merge blocker
first, then fix repeatable validation, then harden the Mastra/Manager runtime
semantics.

## Implementation Plan

### Phase 1: Restore Mergeability

- Merge `origin/main` into `feat/116-agentic-subtitle-enrichment-workflow`.
- Resolve `docs/roadmap/README.md` and
  `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
  by preserving both current-main roadmap changes and PR #886 roadmap updates.
- Refresh `pnpm-lock.yaml` with the repo package manager after conflict
  resolution.

### Phase 2: Make Validation Repeatable

- Add `apps/manager/.tmp` to `.prettierignore`.
- Run `pnpm --filter @forge/manager test` followed immediately by
  `pnpm run format:check` without deleting generated files.
- Keep generated artifacts untracked.

### Phase 3: Start Real Mastra Subtitle Runs

- Replace the direct service-route call to
  `launchSubtitleEnrichmentWorkflow(...)` with a real registered Mastra
  workflow run start.
- Return either the actual Mastra run id or a documented stable mapping to it.
- Move prototype callback emission inside the workflow execution path.
- Add tests proving route-to-registered-workflow wiring.

### Phase 4: Fix Launch Idempotency Semantics

- Cache idempotency records only after a run is accepted or after deterministic
  payload conflicts.
- Do not cache transient startup failures such as `manager_unavailable` or
  `mastra_runtime_error`.
- Add tests for fail-then-retry success with the same idempotency key.

### Phase 5: Harden Manager Callback Ingestion

- Stop relying only on process-local `Set`/`Map` state for callback
  correctness.
- At minimum, read persisted job state before applying callbacks and ignore
  stale non-terminal events after completed/failed jobs.
- Preserve sanitized `workflow_failed` error details on the Manager job.
- Add tests for duplicate callbacks after process-local state is gone and for
  stale events after terminal states.

### Phase 6: Smoke And PR Update

- Run Mastra and Manager locally as needed.
- Prove Mastra `/health` and auth behavior with browser screenshots.
- If Phase 3 is completed, prove the run appears through Mastra Studio/operator
  API.
- Update PR #886 with the final validation notes and screenshots.

## Red / Green TDD

Add or update failing tests before fixes:

- `apps/mastra/src/mastra/workflows/subtitle-enrichment.test.ts`
  - transient launch failure is not cached
  - retry with same idempotency key can later succeed
- `apps/mastra/src/mastra/index.ts`
  - service route starts the registered subtitle workflow runtime
- `apps/manager/src/app/api/mastra/subtitle-enrichment-runs/[runId]/events/route.test.ts`
  - duplicate/stale events remain harmless after process-local state is reset
  - stale non-terminal events after terminal job state are ignored
  - workflow-level failure error is persisted
- Validation regression:
  - Manager tests followed by root format check pass without manual cleanup

## Acceptance Criteria

### Functional

- [ ] PR #886 merges cleanly into current `origin/main`.
- [ ] Format validation is repeatable after Manager tests.
- [ ] Mastra subtitle service route starts a real registered Mastra workflow
      run.
- [ ] Transient Mastra startup failures can be retried with the same
      idempotency key.
- [ ] Manager callback handling remains safe across retries, stale events, and
      process restarts.
- [ ] Workflow-level failures preserve sanitized operator-facing error details.

### Quality Gates

- [ ] Red tests fail before implementation.
- [ ] New/updated green tests pass after implementation.
- [ ] `pnpm --filter @forge/mastra lint`
- [ ] `pnpm --filter @forge/mastra typecheck`
- [ ] `pnpm --filter @forge/mastra test`
- [ ] `pnpm --filter @forge/mastra build`
- [ ] `pnpm --filter @forge/manager lint`
- [ ] `pnpm --filter @forge/manager typecheck`
- [ ] `pnpm --filter @forge/manager test`
- [ ] `pnpm run format:check`
- [ ] `git diff --check`
- [ ] `git merge-tree --write-tree origin/main HEAD`

### User Smoke

- [ ] Browser screenshot proves Mastra `/health` is live.
- [ ] Browser screenshot or HTTP proof shows anonymous built-in API access is
      rejected.
- [ ] Service token remains blocked from built-in `/api/*`.
- [ ] If real Mastra run wiring is completed, operator-auth Studio/API proof
      shows the subtitle run.

## Risks And Mitigations

| Risk                                                                | Mitigation                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Lockfile resolution accidentally drops current-main package changes | Resolve with `pnpm install` and inspect `pnpm-lock.yaml` diff                             |
| Mastra runtime APIs differ from direct helper tests                 | Write the failing route-to-workflow test first and use current Mastra docs/source locally |
| Durable callback idempotency grows scope                            | Implement persisted terminal-state guard first, then event ledger only if needed          |
| Feature remains prototype-only                                      | Keep PR draft until real run wiring and smoke proof are done                              |

## References

- PR #886: https://github.com/JesusFilm/forge/pull/886
- Mastra app boundary: `apps/mastra/AGENTS.md`
- Manager app boundary: `apps/manager/AGENTS.md`
- Review todos: `todos/017` through `todos/021`
