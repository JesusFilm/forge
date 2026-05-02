---
title: Fix Agentic Runtime Review Blockers
type: fix
status: active
date: 2026-05-01
updated: 2026-05-02
pr: 870
branch: feat/115-mastra-agentic-runtime-app
related_todos:
  - "007"
  - "008"
  - "009"
  - "010"
  - "011"
  - "012"
  - "013"
  - "014"
  - "015"
---

# Fix Agentic Runtime Review Blockers

## Overview

PR #870 adds `apps/agentic` as the Mastra-powered Agentic runtime app and wires Manager as the first consumer. Review validation passed locally and in CI, but the review is not clean-to-merge because GitHub reports a lockfile conflict and multi-agent review found production auth, idempotency, timeout, deployment, and contract-mapping gaps.

This plan covers the smallest corrective pass needed before merge.

## Problem Statement

The current branch is functionally close, but several boundary guarantees are only documented or partially tested:

- Mergeability is blocked by a `pnpm-lock.yaml` conflict against `origin/main`.
- Production env validation can be weakened by `CI=true`.
- Agentic service/operator tokens and Manager callback/general API tokens can be accidentally reused.
- Agentic collapses semantic Manager errors into generic `manager_unavailable` failures.
- Manager accepts but does not enforce Agentic idempotency keys.
- Cross-service timeout budgets are asymmetric.
- The app-local Railway config requires an explicit config-as-code path on the future `agentic` service.

## Research Findings

- Review target: PR #870, branch `feat/115-mastra-agentic-runtime-app`.
- CI status: green for Agentic, Manager, full workspace format/lint/test/build checks, and Manager Railway deploy.
- Merge status: `gh pr view 870 --json mergeable,mergeStateStatus` reported `CONFLICTING` / `DIRTY`.
- Conflict probe: `git merge-tree --write-tree origin/main HEAD` identified `pnpm-lock.yaml` as the only content conflict.
- Repo app docs define Agentic as a first-class runtime boundary: `apps/agentic/CLAUDE.md`, `apps/agentic/AGENTS.md`.
- Manager owns operator-visible dry-run report truth and live side-effect approval boundaries; Agentic V1 must remain dry-run-only.
- The current Manager automation run storage surface is `apps/manager/src/features/agents/automation-store.ts`. It does not currently expose durable idempotency lookup/create semantics.
- The CMS content type `apps/cms/src/api/enrichment-automation-run/content-types/enrichment-automation-run/schema.json` has no `idempotencyKey` field today, so full durable idempotency probably requires a CMS schema field plus regenerated contracts, not only route-body validation.
- Existing deployment learning: `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` warns that `apps/<svc>/railway.toml` is ignored unless Railway Config-as-code Path points to it.
- Existing Railway learning: `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md` documents `configFile: null` as evidence that repo config is not being used.
- Railway's current public docs say config-as-code values are taken from `railway.toml`/`railway.json`, combined with dashboard settings per deployment, and code values override dashboard values for that deployment.
- Railway's monorepo docs say the Railway config file does not follow Root Directory automatically; the config file path must be specified for nested service configs.
- Mastra's current docs say the built server runs with `node .mastra/output/index.mjs`, exposes `GET /health`, and supports server auth that secures both Studio and API routes. Mastra's storage docs identify production storage providers separately from local LibSQL/file storage.

## Proposed Solution

Resolve the branch and harden the Agentic boundary before merge:

1. Update the branch from `origin/main`, regenerate `pnpm-lock.yaml` with pnpm, and rerun focused validation.
2. Make production env validation production-first: `NODE_ENV=production` must always require strong secrets and durable storage, regardless of `CI`.
3. Reject token reuse across Agentic service/operator keys and Manager callback/general API keys.
4. Preserve Manager failure codes through Agentic for expected contract failures.
5. Require and enforce Agentic dry-run idempotency in Manager.
6. Add explicit timeout control for Agentic-to-Manager callbacks and revisit the Manager-to-Agentic default.
7. Document and verify the Railway `agentic` service config-as-code path before deployment.
8. Add missing failure fallback tests and remove unused runtime metadata exports if still unused.

## Ordered Implementation Plan

Resolve the findings one by one. Do not start a later code change until the previous finding has a failing test and then a passing fix, except for independent test-writing in a separate branch-local session.

### Finding 1: Lockfile Merge Conflict

**Files:**

- `pnpm-lock.yaml`
- `apps/agentic/package.json`

**Red:**

- Reproduce merge conflict with:

```sh
git fetch origin main
git merge-tree --write-tree origin/main HEAD
gh pr view 870 --json mergeable,mergeStateStatus
```

**Green:**

- Update the branch from `origin/main`.
- Resolve only `pnpm-lock.yaml` via pnpm, preferably:

```sh
pnpm install --lockfile-only --ignore-scripts
```

- Re-run PR mergeability check until GitHub no longer reports `CONFLICTING`.

### Finding 2: Production Env Can Be Weakened By CI

**Files:**

- `apps/agentic/src/config/env.ts`
- `apps/agentic/src/config/env.test.ts`
- `apps/agentic/src/mastra/index.ts`
- `apps/agentic/src/mastra/index.test.ts`

**Red:**

- Add tests proving `parseAgenticEnv({ NODE_ENV: "production", CI: "true", ...weakSecrets })` rejects weak `AGENTIC_SERVICE_API_KEY`, `AGENTIC_OPERATOR_API_KEY`, and `MANAGER_AGENTIC_API_KEY`.
- Add tests proving production rejects `AGENTIC_STORAGE_URL=":memory:"`.
- Add tests deciding production behavior for `file:` storage. Preferred: reject relative/local file storage in production unless an explicit exception is documented for non-Railway local production smoke.
- Add a runtime config test proving `buildMastra()` does not switch storage to `:memory:` merely because `CI=true` when `NODE_ENV="production"`.

**Green:**

- Make production mode always win over CI shortcuts.
- Keep placeholder secrets allowed only for `NODE_ENV !== "production"`.
- Use `env.storageUrl` for production storage regardless of `env.isCi`.

### Finding 3: Service And Operator Tokens Can Collapse

**Files:**

- `apps/agentic/src/config/env.ts`
- `apps/agentic/src/config/env.test.ts`
- `apps/agentic/src/mastra/index.test.ts`
- `apps/manager/src/config/env.ts`
- `apps/manager/src/config/env.test.ts`
- `apps/manager/vitest.setup.ts`

**Red:**

- Add Agentic env tests rejecting equal `AGENTIC_SERVICE_API_KEY` and `AGENTIC_OPERATOR_API_KEY`.
- Add Agentic env tests rejecting equal `AGENTIC_OPERATOR_API_KEY` and `MANAGER_AGENTIC_API_KEY`.
- Add Manager env tests rejecting equal `MANAGER_AGENTIC_API_KEY` and `MANAGER_API_KEY` when both are configured.
- Add Manager env tests rejecting equal `MANAGER_AGENTIC_API_KEY` and `AGENTIC_SERVICE_API_KEY` when both are configured.
- Keep or extend the existing service-token Studio/root rejection test.

**Green:**

- Add cross-field refinements after env parsing with error messages naming the conflicting variables.
- Use distinct CI/test placeholder values in `.env.ci`, `vitest.setup.ts`, and test helpers so tests do not normalize unsafe reuse.

### Finding 4: Idempotency Key Accepted But Unused

**Files:**

- `apps/manager/src/app/api/automations/[id]/agentic-dry-run/route.ts`
- `apps/manager/src/app/api/automations/[id]/agentic-dry-run/route.test.ts`
- `apps/manager/src/features/agents/automation-store.ts`
- `apps/manager/src/features/agents/automation-store.test.ts`
- `apps/manager/src/features/agents/automation-store.mock.test.ts`
- likely `apps/cms/src/api/enrichment-automation-run/content-types/enrichment-automation-run/schema.json`
- likely generated GraphQL/client artifacts if the CMS schema changes

**Red:**

- Add route test rejecting missing `idempotencyKey`.
- Add store/route tests proving two Agentic requests with the same key return the same existing Manager run instead of creating a duplicate.
- Add tests for repeat key while the first run is in-flight and after the first run is terminal.

**Green:**

- Make `idempotencyKey` required in the Manager Agentic callback schema.
- Implement durable idempotency. Preferred shape:
  - add `idempotencyKey` to the Manager automation run model/content type,
  - add store lookup by `automationDocumentId + idempotencyKey`,
  - add create semantics that associate Agentic-created dry runs with the key,
  - return the existing run/report on retry.
- If the durable CMS schema change proves too large for the PR, stop and split a smaller explicit plan. Do not ship body-only idempotency that cannot survive a retry after completion.

### Finding 5: Manager Errors Lose Their Contract Meaning

**Files:**

- `apps/agentic/src/mastra/tools/manager-automation-dry-run-tool.ts`
- `apps/agentic/src/mastra/workflows/manager-automation-dry-run-workflow.ts`
- `apps/agentic/src/contracts/manager-automation-dry-run.ts`
- `apps/agentic/src/api/manager-automation-dry-run.test.ts`
- optional new tool/workflow tests under `apps/agentic/src/mastra/**`

**Red:**

- Add tests where fake Manager returns:
  - `{ ok: false, code: "not_found", message: "Automation not found" }` with HTTP 404.
  - `{ ok: false, code: "invalid_automation", message: "..." }` with HTTP 400.
  - invalid JSON / network error for true upstream failure.
- Assert Agentic preserves semantic Manager failure codes for expected Manager failures and only uses `manager_unavailable` for network/invalid-response cases.

**Green:**

- Introduce a typed Manager dry-run error or union result that carries `code`, `message`, and HTTP status.
- Map known Manager codes into `StartManagerAutomationDryRunResponse`.
- Keep generic `manager_unavailable` for network, timeout, parse, and invalid contract responses.

### Finding 6: Agentic Callback Has No Timeout

**Files:**

- `apps/agentic/src/config/env.ts`
- `apps/agentic/src/config/env.test.ts`
- `apps/agentic/.env.example`
- `apps/agentic/.env.ci`
- `apps/agentic/src/mastra/index.ts`
- `apps/agentic/src/mastra/tools/manager-automation-dry-run-tool.ts`
- `apps/agentic/src/mastra/tools/manager-automation-dry-run-tool.test.ts` or equivalent
- `apps/manager/src/lib/agentic-automation-dry-run.ts`

**Red:**

- Add env tests for default and override of a new `MANAGER_REQUEST_TIMEOUT_MS` or clearly named `AGENTIC_MANAGER_REQUEST_TIMEOUT_MS`.
- Add Agentic tool test proving `fetch` receives an abort signal / timeout signal.
- Add test proving timeout maps to retryable upstream/runtime failure, not validation failure.

**Green:**

- Add an explicit Agentic-to-Manager timeout env value.
- Thread it through `AgenticEnv`, `buildMastraConfig()`, workflow/tool dependencies, and the fetch call.
- Revisit Manager's `DEFAULT_AGENTIC_FETCH_TIMEOUT_MS = 15_000`; either raise it to match expected dry-run work or document why Manager can time out earlier because idempotency now makes retry safe.

### Finding 7: Railway Config Needs Live Service Verification

**Files:**

- `apps/agentic/railway.toml`
- `apps/agentic/CLAUDE.md`
- `docs/plans/2026-05-01-feat-agentic-runtime-app-plan.md`
- this plan

**Red:**

- Before the service exists, the failing condition is operational: no `forge - @forge/agentic` status context and no deployment record proving `configFile`.
- If Railway access is available, verify that no `agentic` service or config path proof exists yet.

**Green:**

- Create/verify Railway service name: `agentic`.
- Set Config-as-code Path to `apps/agentic/railway.toml` or, if Railway expects a leading slash for this repo, the exact nested path shown in deployment records.
- Verify deployment record `configFile` is not `null` and references `apps/agentic/railway.toml`.
- Verify deployed:
  - `GET /health` returns `200`.
  - anonymous Studio/root access is rejected.
  - service bearer cannot access Studio/root.
  - operator bearer can access Studio/root.
  - service bearer can call `POST /forge/manager-automation-dry-run`.

## Red/Green TDD

Start with failing tests before patches:

- Add Agentic env tests proving `NODE_ENV=production CI=true` still rejects weak secrets and memory/local ephemeral storage.
- Add Agentic env tests proving equal service/operator keys are rejected.
- Add Manager env/config tests proving unsafe Agentic callback token reuse is rejected.
- Add Agentic tool/workflow tests proving Manager `not_found` and `invalid_automation` survive as semantic failure codes.
- Add Manager route tests proving missing/reused `idempotencyKey` cannot create duplicate dry-run records.
- Add timeout tests for Agentic-to-Manager fetch behavior.
- Add Manager Agentic route failure fallback tests mirroring the manual dry-run route.

Then implement until those tests pass.

## User Smoke Test Matrix

Repeat the built-output smoke after each major group, not only at the end.

| Stage                                 | Required Smoke                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| After env/token fixes                 | Built Agentic rejects weak/equal-token production env at boot; with distinct tokens, `/health=200`, anonymous root `401`, service root `401`, operator root `200`. |
| After error/idempotency/timeout fixes | Fake Manager returns success, `not_found`, `invalid_automation`, timeout, and invalid JSON cases; Agentic returns the expected semantic codes.                     |
| After lockfile/main update            | Full local validation plus PR check watch.                                                                                                                         |
| After Railway service setup           | Deployed service proof with `configFile`, `/health`, Studio auth split, and dry-run route.                                                                         |
| Final proof                           | `agent-browser` screenshot of authorized Studio and browser console check with no unexpected errors.                                                               |

## Review Checklist Before Work Starts

- [x] Current branch is still `feat/115-mastra-agentic-runtime-app`, or a repo-compliant follow-up branch is created from it if the team prefers not to mutate PR #870 directly.
- [x] Roadmap ticket `docs/roadmap/platform/feat-115-agentic-runtime-app.md` remains complete for original app work; this plan is the active follow-up plan.
- [x] `todos/007` through `todos/013` stay pending until each corresponding finding is resolved and validated.
- [x] Any CMS schema change for idempotency includes generated GraphQL/type artifacts in the same PR.
- [x] No work starts from a green-only patch; each finding gets a red test or explicit operational failing proof first.

## Acceptance Criteria

- [ ] PR #870 is mergeable against `origin/main`.
- [x] Production Agentic env validation cannot be weakened by `CI=true`.
- [x] Agentic service and operator credentials cannot be identical.
- [x] Manager rejects unsafe reuse of Agentic callback credentials with broader Manager API credentials.
- [x] Agentic preserves Manager semantic failures instead of mapping all failures to `manager_unavailable`.
- [x] Manager Agentic dry-run idempotency prevents duplicate records across retries.
- [x] Cross-service timeouts are explicit, tested, and documented.
- [x] Railway deployment instructions require service name `agentic` and Config-as-code Path `apps/agentic/railway.toml`.
- [x] Missing failure fallback tests are added or the fallback is simplified safely.
- [x] Unused runtime metadata exports are removed or justified by a real consumer.

## Validation Plan

Run locally after fixes:

```sh
pnpm install --lockfile-only --ignore-scripts
pnpm --filter @forge/agentic test
pnpm --filter @forge/agentic typecheck
pnpm --filter @forge/agentic lint
pnpm --filter @forge/agentic build
pnpm --filter @forge/manager test -- src/app/api/automations src/features/agents src/lib/agentic-automation-dry-run.test.ts src/config/env.test.ts
pnpm --filter @forge/manager typecheck
pnpm run format:check
git diff --check
gh pr view 870 --json mergeable,mergeStateStatus
gh pr checks 870 --watch --interval 10
```

## User Smoke Test

Repeat the production-build smoke:

1. Start fake Manager on `127.0.0.1:3999` with `POST /api/automations/automation-review/agentic-dry-run`.
2. Start built Agentic server with:

```sh
NODE_ENV=production \
PORT=4114 \
AGENTIC_HOST=127.0.0.1 \
AGENTIC_SERVICE_API_KEY=review-agentic-service-key \
AGENTIC_OPERATOR_API_KEY=review-agentic-operator-key \
AGENTIC_STORAGE_URL=file:/tmp/forge-agentic-review-smoke.db \
AGENTIC_MODEL=openai/gpt-5-mini \
MANAGER_BASE_URL=http://127.0.0.1:3999 \
MANAGER_AGENTIC_API_KEY=review-manager-agentic-key \
node apps/agentic/.mastra/output/index.mjs
```

3. Prove:
   - `GET /health` returns `200`.
   - anonymous `GET /` returns `401`.
   - service bearer `GET /` returns `401`.
   - operator bearer `GET /` returns `200`.
   - service bearer `POST /forge/manager-automation-dry-run` returns `200` with `agenticRunId` and `managerAutomationRunDocumentId`.
4. Capture an operator Studio screenshot with `agent-browser`, and check browser console output.

## Validation Results

2026-05-02:

- Red tests failed first for production env hardening, token separation, Manager semantic error preservation, missing Agentic callback timeout, and Manager dry-run idempotency.
- `pnpm install --lockfile-only --ignore-scripts` completed after merging `origin/main` and resolving `pnpm-lock.yaml`.
- `pnpm turbo run generate --filter=@forge/graphql` passed after adding `EnrichmentAutomationRun.idempotencyKey`.
- `pnpm --filter @forge/agentic test` passed.
- `pnpm --filter @forge/agentic typecheck` passed.
- `pnpm --filter @forge/agentic lint` passed.
- `pnpm --filter @forge/agentic build` passed.
- `pnpm --filter @forge/manager test -- src/app/api/automations src/features/agents src/lib/agentic-automation-dry-run.test.ts src/config/env.test.ts` passed.
- `pnpm --filter @forge/manager typecheck` passed.
- `pnpm --filter @forge/manager lint` passed.
- `pnpm --filter @forge/graphql typecheck` passed.
- `pnpm --filter @forge/cms typecheck` passed.
- `pnpm run format:check` passed.
- `git diff --check` passed.
- Built Agentic smoke passed against fake Manager: `/health=200`, anonymous root `401`, service root `401`, operator root `200`, service dry-run success, repeated idempotency key returned the same Manager run id, Manager `not_found` and `invalid_automation` were preserved, and invalid Manager response mapped to `manager_unavailable`.
- Agent-browser operator Studio screenshot captured: `/tmp/forge-agentic-smoke/operator-studio.png`.
- Railway CLI verification was attempted with `railway status`, but this worktree is not linked to a Railway project. Live `configFile` proof remains a post-service setup check.

## Dependencies & Risks

- Idempotency may require extending Manager automation run persistence. Keep the first patch narrow and test the chosen storage path.
- Railway service verification requires live Railway access after the `agentic` service exists.
- Updating from `origin/main` may surface unrelated lockfile or workspace changes; keep the resolution scoped.
- Production storage rules must not make local production-build smoke impossible. If local smoke needs `file:/tmp/...`, encode that as an explicit non-Railway smoke exception rather than allowing `file:./.mastra/local.db` in deployed production.
- Token separation will require updating test fixtures and CI env placeholders to use distinct values.
- Raising Manager-to-Agentic timeout without idempotency first can make duplicate work harder to see; handle idempotency before tuning the outer timeout.

## References

- PR: https://github.com/JesusFilm/forge/pull/870
- Todos: `todos/007-pending-p1-resolve-agentic-lockfile-conflict.md` through `todos/015-pending-p3-remove-agentic-runtime-config-duplication.md`
- Current Agentic plan: `docs/plans/2026-05-01-feat-agentic-runtime-app-plan.md`
- Railway new-app pattern: `docs/solutions/platform/new-app-ci-and-deployment-patterns.md`
- Railway config drift pattern: `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`
- Railway config-as-code docs: https://docs.railway.com/config-as-code/reference
- Railway monorepo docs: https://docs.railway.com/deployments/monorepo
- Mastra server deployment docs: https://mastra.ai/docs/deployment/mastra-server
- Mastra Studio auth docs: https://mastra.ai/docs/studio/auth
- Mastra storage docs: https://mastra.ai/docs/server-db/storage
