# PR870 Mastra automation dry-run recovery

Scope: feat-907, recovered from `828b986` onto parent `0f105217b`. This unit
implements the existing PR870 requirements in the current Manager/Mastra apps.
Root retains ownership of Admin backend fencing, schema, generated clients,
final integration and PR publication. No retired Agentic app, CMS, old lockfile,
subtitle execution, callback graph or provider policy was restored or changed.

## Exact transport contract

Manager's `triggerAgenticAutomationDryRun` sends
`POST /forge-manager-automation-dry-run` on the configured HTTPS `MASTRA_BASE_URL`
using `MASTRA_SERVICE_API_KEY`, validated by Mastra's existing service pool.
Its strict JSON input is:

```json
{
  "automationDocumentId": "automation-1",
  "requestedBy": { "kind": "service", "id": "trusted-caller-attribution" },
  "idempotencyKey": "unique-request-key"
}
```

`requestedBy.kind` allows `service` or `manager_user`; `id` and automation identity
are trimmed, 1–160 characters. The key is trimmed, 1–240 characters. Attribution
is forwarded service metadata and never authorizes a user/session operation.
The registered `managerAutomationDryRunWorkflow` creates a real Mastra run and
executes `managerAutomationDryRunTool`. Their output schemas match. The tool
posts only `requestedBy` and `idempotencyKey` (also an `Idempotency-Key` header)
to Manager's `/api/automations/[id]/agentic-dry-run`. Manager permits omitted
attribution but requires the key; mismatched header/body keys are rejected.

That endpoint accepts only `MANAGER_AGENTIC_API_KEY`. General Manager keys and
cookies do not grant entry, and the dedicated key is never admitted by general
or scheduled-route auth. Reuse of the dedicated key in `MANAGER_API_KEY` or `ADMIN_TRIGGER_API_KEYS` is rejected by config.
Neither endpoint, tool, workflow nor trigger helper accepts any `runMode` field.
Manager always passes `dry_run` to the read-only automation runner, even when
the stored automation definition is live.

The Manager success envelope is:

```json
{
  "ok": true,
  "automationDocumentId": "automation-1",
  "managerAutomationRunDocumentId": "manager-run-1",
  "runMode": "dry_run",
  "enqueuedCount": 0,
  "status": "partial",
  "summary": "Partial report.",
  "reportUrl": "/dashboard/agents?automationId=automation-1&runId=manager-run-1"
}
```

Mastra returns that envelope plus `agenticRunId`, retained as a compatibility
field containing the actual Mastra `run.runId`. Terminal statuses are `success`,
`partial`, `failed`, `no_op`; `partial` is preserved. Persisted failed reports
return HTTP 200 with `status: failed`, including terminal replay. Transport or
persistence failures return safe `{ok:false,code,message}` envelopes. Missing
config is 503, missing automation 404, invalid input 400, authorization 401,
inflight/key conflict 409, transport/runtime failure 502. Full reports remain
in Manager/Admin; service envelopes stay bounded and include the Manager URL.

Both callers require an HTTPS origin without credentials, path, query or hash,
deny redirects, and stream-cap success and error JSON at 16 KiB. Request schemas
bound generated bodies below 8 KiB; both servers cap incoming streams at 8 KiB
and five seconds. Mastra's Manager deadline defaults to 60000 ms (optional env
`MANAGER_AUTOMATION_DRY_RUN_TIMEOUT_MS`, 1000–120000). Manager's optional
`MASTRA_AUTOMATION_DRY_RUN_TIMEOUT_MS` defaults to 70000 (1000–180000). The signal
covers response consumption too. Missing/partial optional config returns an
explicit unavailable result without blocking startup. Raw upstream bodies,
exceptions and credentials never become public error messages.

## Admission and replay

`automation-dry-run.ts` owns both manual and service orchestration. It looks up
an Admin run by `(automationId, idempotencyKey)` before and after obtaining its
own lease. Terminal dry-run records replay; claimed/running records return 409.
A live run cannot be replayed as a dry-run report.

Admin `createRun` at the parent revision can return an existing key before lease
validation. Therefore its return value is never treated as execution authority:
`beginDispatch(runId, ownedLeaseToken)` must atomically succeed before the runner
is invoked. A denied fence cannot execute, complete or fail that admitted run.
All nonmock create/complete/failure paths pass the owned lease. Cleanup releases
only that token; Admin's release CAS also protects an active admitted run.
Neither manual lane advances scheduled cadence. Root separately owns the strict
Admin adapter wire parsing: callers retain mock `startedAt`, but Admin receives
only its explicit six allowed create fields and owns the actual start time.

Mock runs persist `automationDocumentId`, `idempotencyKey`, lease and dispatch
identity through disk reload. Automation updates serialize within the demo
singleton gateway; production persistence and concurrency remain Admin-owned.
Pausing a demo definition preserves an already admitted lease.

## Evidence

Red proof before implementation:

- `automation-store.mock.test.ts`: repeating one key produced
  `mock-automation-run-3` instead of the first `mock-automation-run-2`.
- Manual `dry-run/route.test.ts`: explicit `{runMode:"live"}` returned HTTP 200
  instead of the required 400 and was admitted. The route always forced a dry
  runner before this change; the regression is acceptance of an invalid request,
  not evidence of historical live job execution.

Deterministic validation uses real committed Mastra workflow execution with a
fixture HTTP adapter; it asserts the actual created Mastra run ID and validates
the tool result against the workflow's Zod output. Transport fixtures cover
unsafe origin rejection before credential send, redirects, HTML, invalid JSON,
HTTP/envelope mismatch, over-cap chunked streams, stalled bodies, strict live
input denial, wrong automation/report URL, and safe failures. Manager coverage
includes both lanes, terminal replay, inflight conflict, both create/claim race
windows, one-time admission, completion reconciliation and lease propagation.
Real demo-store tests exercise concurrent claims/dispatch plus disk reload.

Validation runs on Node 24.22.1 with hooks enabled:

- Full Manager suite: 254 files, 1549 tests passed; one file / three tests skipped.
- Full Mastra suite: 332 files, 4002 tests passed; 15 files / 45 tests skipped.
- Both package typechecks and ESLint on all touched TypeScript files pass.
- Repository formatting and enabled commit hooks are checked before handoff.

No provider calls, pushes, merges or deployment commands were used. Admin DB and final integrated HTTP/
browser acceptance remain root-owned; the fixture workflow is not a production
or paid-provider execution claim. No rendering/hydration changes are in this unit.

## Independent review repairs

The integrated review reproduced a registration assertion that required the
Manager automation workflow to be first in the shared workflow object. The test
now checks membership independently of ordering; the actual committed workflow
execution test still proves the tool step runs and returns its real run ID.

The service's existing report URL contract remains unchanged. The Agents page
now resolves `automationId` and `runId` independently of the five recent runs,
checks that the canonical run belongs to that automation, and renders a selected
report section. Invalid, missing or foreign pairs show an unavailable message.
A regression starts with five newer runs and resolves the older sixth run; a
separate render check verifies the selected report is visible. Ordinary page
loads perform no report-specific reads. The history slice remains bounded.

Both issues were reproduced before the repair: three report-loader regressions
failed, and the integrated registration test failed. The repair also removes a
duplicate import introduced when combining the strict run-input repair and the
recovered store tests. Manager typecheck and touched lint pass.

Default-page warm server rendering was checked with the same empty-page props:
median 0.06845ms before and 0.06779ms after across ten batches of 100 renders,
following warmup. This bounds the rendering change; it does not measure browser
hydration or production page-load performance. The change adds no client effect,
initial read or client module dependency: `AutomationRunHistory` was already in
the existing list's dependency graph. The default-query loader test verifies no
additional backend requests. Raw local checks are recorded under the root
worktree's ignored `.tmp/pr870-*` files.
