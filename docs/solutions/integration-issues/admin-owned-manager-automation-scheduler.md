---
module: Manager automations
problem_type: integration_issue
tags: [manager, admin, automation, scheduling, leases]
---

# Restore the authority before the timer

The CMS removal left Manager automation pages calling retired GraphQL and REST
clients. Response handling made that failure readable but could not restore
scheduling. Definitions, runs, candidate selection and leases now live in Admin;
`@forge/automation-contracts` shares only neutral validation/schedule code.

Admin's durable workflow calls `runManagerAutomationTick` every minute. Each tick
claims at most four due definitions using `FOR UPDATE SKIP LOCKED`, records the
scheduled run and ten-minute lease in one transaction, and calls Manager with the
configured service bearer. Manager reloads the canonical definition and mode,
atomically consumes dispatch once, and returns a bounded JSON result. Admin
settles it and advances the next cadence. Pause blocks future claims while
preserving a run already admitted. Expired runs become visible failures and
advance cadence; they are never silently replayed. Manual reports stay dry-run
and do not advance scheduled cadence.

Job insertion checks the current live scheduled run under the same automation
row lock used by settlement/recovery. The active-job automation-key index prevents
concurrent duplicate jobs. Automated dispatch uses existing Mux assets without
pre-job subtitle generation; the admitted enrichment job requests generation.
Definitions preserve exact target-language ownership and exclude human outputs.

## Release configuration

Apply Admin migration `0165_manager_automations` through the normal release path,
then deploy the generated schema and Manager adapter together. Migration preflight
refuses duplicate active legacy automation keys; reconcile their actual jobs
before retrying. It never deletes or rewrites those jobs automatically.

Admin requires `MANAGER_API_BASE_URL` and `MANAGER_AUTOMATION_API_KEY` (the latter
matches Manager's `MANAGER_API_KEY`). Manager requires `ADMIN_GRAPHQL_URL` and its
existing Manager service OAuth credentials or legacy service key. Finally enable
Admin `MANAGER_AUTOMATIONS_ENABLED=true`. The default remains false. HTTPS is
required in production; redirects are denied. No local validation activates the
production timer or provider execution.

## Evidence and limits

`manager-automation.db.test.ts` uses a task-owned disposable PostgreSQL database:
competing claims, reload through a second service instance, pause, expiry, stale
settlement, canonical source/target ownership, active duplicate selection, real
HTTP scheduler dispatch/settlement, HTML gateway failure, and fenced real job
insertion. That HTTP fixture exercises Admin admission, not a deployed Manager
server or paid provider. Manager route tests independently prove canonical-mode
and one-time-dispatch behavior. Full application HTTP/browser proof and independent
review remain separate integration checks, not implications of these unit tests.

## Bootstrap identity and recovery

Installed `workflow@4.2.2` / `@workflow/core@4.2.2` generates the run ID inside
`start()`. Its World `getEncryptionKeyForRun(runId, context)` hook runs before
argument serialization, `events.create()` and `queue()`. The scheduler wraps that
hook to commit the actual ID using a conditional ledger update, then preserves
the underlying World's key resolver. A failed or retired binding prevents both
runtime effects. Do not replace this with a guessed ID or an after-start write.
The real SDK ordering is covered by the recovery database test, so a dependency
upgrade that changes this contract must be reviewed.

Reconciliation runs every minute after bootstrap, including after unresolved
starts and errors. Missing runtimes receive a five-minute grace measured from
the ledger's last binding/update. A queued ledger with a known nonterminal runtime
is re-enqueued with the same ID using the World's event-log replay primitive and
then marked running. A start error never immediately marks its ledger failed:
runtime creation or queueing may already have succeeded. Explicit runtime
terminal states allow replacement; transient lookup failures do not.

Ledger allocation, binding and World queueing are separate commits. There is no
distributed exactly-once start guarantee: a launch delayed beyond grace can
create a runtime after replacement. Each timer therefore checks the current
ledger ID and its bound runtime ID before each tick; an observed retired timer
exits without sleeping again, even while automation execution is disabled. A
timer retired during a tick exits on its next check. Repeated queue
deliveries of one runtime replay its event log. Atomic automation claims remain
the independent cycle-execution fence. Recovery requires a running Admin process
and available database/World; prolonged unavailability delays progress.

## Requested manual claims and wall-clock schedules

Manual claims lock their requested `manager_automation` parent before expiry
recovery. Bounded global `SKIP LOCKED` recovery is suitable for scheduler scans,
but cannot authorize replacing a skipped parent's lease later. A claim writes a
new token only after both lease fields and the active-run slot are cleared.
Both manual routes use that atomic admission instead of rejecting broad history
containing expired active rows. Live leases still return 409. An interrupted
idempotency key is recovered and its terminal failure replayed without dispatch;
manual reports do not advance cadence.

Schedule resolution validates candidate instants by converting them back to the
requested wall-clock date/time. Nonexistent hourly/daily/weekly occurrences are
skipped rather than shifted; fall folds choose the earliest match strictly after
the caller's `from`. Fixed IANA expectations cover Berlin, Sydney, New York,
Lord Howe's half-hour transitions and Apia's missing day.

`manager-automation-recovery.db.test.ts` requires its explicit disposable database
on port 55932. It exercises real PostgreSQL transactions/triggers and actual SDK
`start()` with a deterministic runtime storage/queue adapter, not a live workflow
worker or paid provider. The foundation fixtures use backend migration 0017 and
automation migration 0165; recovery also uses workflow-ledger migration 0009.
Execution operations and job revision migrations belong to PR1087 and are not
required by the foundation-only Prisma schema.

## Register the timer in the built runtime

The installed Workflow Next builder discovers app-entry imports. A timer imported
only by `instrumentation.ts` is omitted even when Next compilation and typechecking
pass; the historical `workflows.dirs` option does not supply discovery entries.
Admin's GraphQL route therefore imports `@/workflows/managerAutomation` explicitly.
This registers the definition without starting the timer or changing its default-off
execution flag or request authorization.

The production build first reproduced a missing scheduler in the generated
manifest and executable routes. Keep the scheduler and tick checks in
`scripts/verify-studio-calendar-workflow-build.mjs`: unit tests that invoke the
TypeScript function directly cannot prove its deployed registration.
After adding the app-entry import, the full Admin production build and all three
postbuild workflow-registration verifiers pass.

## PR870 report admission

A returned run identity is not permission to execute it. In particular,
`createRun` can return an existing idempotency record before checking a new
caller's lease. Manager's shared manual/service dry-run helper therefore consumes
Admin's `beginDispatch(runId, ownedLeaseToken)` exactly once before running the
read-only report and threads that lease through settlement/failure. Terminal
keys replay and inflight keys return 409. Cleanup uses only the caller's claim;
it cannot release an existing run's different lease. Demo runs preserve their
idempotency/automation identity on disk and serialize updates on the singleton
gateway, without replacing Admin's production authority.

When porting a Mastra prototype, exercise `.createRun().start()` on the committed
workflow: a helper that directly invokes a tool and invents a run ID can conceal
an incompatible workflow output schema. PR870's compatibility `agenticRunId`
now contains the real Mastra run ID; `partial` remains an explicit report outcome.
