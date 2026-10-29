# feat-907 foundation review repair handoff

The five independent automation foundation findings are repaired in
`t3-09df2a57`. The starting parent is `af426afd5`. Local prerequisite `cb4c75b43`
recovers PR870 with additive conflict resolutions and enabled hooks; root already
integrated that unit as `60816b549` and OAuth separately. Cherry-pick only the
scoped foundation fix following the local prerequisite, not the prerequisite.
No schema, migration, generated client, lockfile, OAuth or Docker source changes
belong to this unit. No provider calls, pushes, merges or deployments were made.

## Finding responses

1. **P1: no-ID startup starvation.** Enabled bootstrap now always installs one
   recurring local reconciliation check, including when it finds a fresh queued
   ledger or startup throws. After five-minute grace, a committed orphan is
   retired and a replacement starts without another process restart.
2. **P2: successful runtime lost by ledger failure.** Installed `workflow@4.2.2`
   / `@workflow/core@4.2.2` calls World `getEncryptionKeyForRun(runId, context)`
   with its actual generated ID before argument serialization and before either
   `events.create()` or `queue()`. The wrapper commits that identity conditionally
   before delegating key resolution. Failed binding creates zero runtime/queue
   effects. A post-start status-write failure leaves the known identity queued;
   reconciliation resumes that same ID using the World's event-log replay
   primitive. A partial start whose runtime exists but queueing failed uses the
   same path. Start errors do not immediately authorize replacement. A delayed
   start that binds after retirement is rejected; one that already bound before
   retirement exits when its workflow checks the current ledger/runtime pair.
3. **P2: requested-parent recovery race.** `claim()` locks the requested parent
   before `recoverExpired()`, retires the run with the locked parent's old token,
   then claims only fully cleared lease fields and an empty active-run slot.
   PostgreSQL blocking proof holds that parent in another transaction before
   releasing it. Replacement run creation succeeds, exactly one active run
   remains, and the old run cannot dispatch.
4. **P2: scheduler-disabled manual expiry.** Both Manager routes share
   `executeAutomationDryRun()`, which lets the atomic claim recover expired work
   instead of treating broad in-flight history as admission authority. Explicit
   live leases still return 409. A retry of an interrupted request's original
   idempotency key now reaches recovery, then replays its terminal failure without
   execution. Terminal replay, live-key/run-binding rejection, one-time dispatch
   and manual cadence preservation retain regression coverage. `hasInFlight()`
   also excludes expired parents.
5. **P2: DST gaps returning past instants.** Shared scheduling now round-trips
   candidate instants through the requested IANA zone. Nonexistent wall-clock
   occurrences are skipped; fall folds choose the earliest match strictly after
   `from`. Fixed expected UTC timestamps cover Berlin, Sydney, New York, Lord
   Howe half-hour transitions and Apia's missing day for hourly/daily/weekly and
   every-minute behavior. The original Berlin hourly reproduction now returns
   `2026-03-29T01:30:00.000Z` from `2026-03-29T00:45:00Z`.

## Verification

Baseline substitution against local prerequisite `cb4c75b43` produced six failing
Admin recovery regressions and six failing Manager route/schedule regressions.
The latter count precedes the additional early-gap/fold expectations. Corrected
source was restored before final validation.

- Admin focused suite: **57 passing tests**, five files: automation service,
  lifecycle DB, recovery DB, instrumentation and Manager job service.
- Manager focused suite: **143 passing tests**, 17 files: agents, automation API
  routes and both manual dry-run HTTP/service clients.
- Full Admin typecheck: **1,697 roots / 766 test files, four shards**, exit 0.
- Full Manager typecheck: exit 0. One duplicate `createAutomationRun` import from
  prerequisite integration was removed from its existing store test.
- Touched-file ESLint, Prettier and `git diff --check` pass; the scoped commit runs
  the enabled lint-staged, repository-wide format and commitlint hooks.
- A normal-schedule microbenchmark under shared-host load compared three paired
  batches of 4,000 calls: before 849/959/2,641 ms; after 465/911/1,378 ms. Formatter
  reuse avoids degradation in this limited measurement. Rendering, hydration,
  routing and browser initialization are unchanged; this is calculation evidence,
  not a browser page-load measurement.

The databases are task-owned on **127.0.0.1:55932**:
`forge_automation_890_repair_09df2a57` and
`forge_automation_890_repair_09df2a57_recovery`. Both fixtures include migrations
0165 and 0166 so Prisma job reads include the CAS revision. Port 55890 was never
used. Disposable cluster and raw local logs live in ignored
`local/feat890-repair/` and may be removed after handoff.

Reproduce the focused checks from the repository root:

```bash
MANAGER_AUTOMATION_TEST_DATABASE_URL=postgresql://forge@127.0.0.1:55932/forge_automation_890_repair_09df2a57 \
MANAGER_AUTOMATION_RECOVERY_TEST_DATABASE_URL=postgresql://forge@127.0.0.1:55932/forge_automation_890_repair_09df2a57_recovery \
pnpm --filter @forge/admin test -- src/services/manager-automation src/instrumentation.test.ts src/services/manager-job.service.test.ts --maxWorkers=2

pnpm --filter @forge/manager test -- src/features/agents src/app/api/automations src/lib/agentic-automation-dry-run.test.ts src/lib/automation-dry-run-http.test.ts --maxWorkers=2
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/manager typecheck
```

## Guarantees and limits

This is durable identity binding plus reconciliation, not an atomic transaction
across ledger allocation and World creation/queueing. A launch delayed beyond
grace may transiently create another runtime after replacement. Each invocation
checks its canonical ledger and runtime identity before a tick and exits when
retired; one retired during an admitted tick exits on its next check. Queue
redelivery resumes the same event-log identity. Atomic automation claims fence
cycle execution independently; a read check alone is not distributed at-most-once
timer creation. Progress requires a running Admin process and available database
and World. The ordering test protects this use of the installed SDK hook during
future dependency upgrades.

Recovery tests use real PostgreSQL ledger/lease transactions and fault-injection
triggers with the actual installed SDK `start()`, plus a deterministic World
runtime storage/queue adapter. They do not run a production workflow worker or
call providers. Root's separate HTTP/browser/deployment proofs remain root-owned.
No nested or independent review agent was launched in this repair unit.

## Exact changed paths in the scoped fix

- `apps/admin/src/services/manager-automation-scheduler.ts`
- `apps/admin/src/services/manager-automation.service.ts`
- `apps/admin/src/services/manager-automation.db.test.ts`
- `apps/admin/src/services/manager-automation-recovery.db.test.ts`
- `apps/admin/src/workflows/managerAutomation.ts`
- `apps/manager/src/features/agents/automation-dry-run.ts`
- `apps/manager/src/features/agents/automation-store.test.ts`
- `apps/manager/src/features/agents/schedule-summary.test.ts`
- `apps/manager/src/app/api/automations/[id]/dry-run/route.test.ts`
- `apps/manager/src/app/api/automations/[id]/agentic-dry-run/route.test.ts`
- `packages/automation-contracts/src/schedule-summary.ts`
- `docs/plans/2026-10-28-feat890-foundation-review-repairs.md`
- `docs/reports/2026-10-28-feat890-foundation-review-repairs.md`
- `docs/roadmap/media-generation/feat-907-manager-admin-automation-backend.md`
- `docs/solutions/integration-issues/admin-owned-manager-automation-scheduler.md`

The feat-907 parent stays in progress for root's integration and independent
review. The repair unit itself is complete.
