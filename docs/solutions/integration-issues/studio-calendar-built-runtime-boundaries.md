---
module: Studio
problem_type: integration_issue
tags: [studio, calendar, mastra, workflow, runtime, provenance]
---

# Calendar runtime boundaries need built-server verification

The calendar's real-native database tests and production builds passed before two
integration defects appeared in actual built browser/timer workflows. Both are
now covered at their failing boundaries. Reviewed final feat-460 integration also
passes the local timer/Watch/revocation/retry chain; performance and external
provider acceptance remain qualified in the validation handoff.

## Return a tagged result across the native request budget

`apps/mastra/src/services/studio-authoring/calendar-runtime.ts` executes both
instruction commands and generation admission inside a bounded request phase.
Instruction inspection and freeze return an HTTP response; a consumed generation
claim returns execution state. The built Hono server replaces global `Response`,
but static `Response.json()` can return a response from its original constructor.
Testing `prepared instanceof Response` therefore misclassified successful
inspection as generation and tried to settle an undefined run ID.

Use an explicit `kind: "response" | "execution"` discriminator. Do not infer this
internal control flow from a framework response's prototype. The real-native DB
regression in `calendar-runtime.db.test.ts` replaces the global constructor while
retaining native static JSON construction; it failed with 400 and passes with
200 after the fix. Clean built Manager/Mastra inspection, save, activation,
empty-pack planning and guidance-pack planning also pass. Completed settlement
remains outside the model-error catch: an ambiguous completed write must never
be followed by a failed write or another claim.

## Include instrumentation-owned workflows in app discovery

Installed `@workflow/next` 4.0.3 discovers app/page entry imports. Its current
options do not consume the old `workflows.dirs` option in Admin's configuration.
A scheduler referenced only from `instrumentation.ts` can start a durable run
whose definition is missing from the generated executable route. A successful
Next build does not prove the timer is registered.

`apps/admin/src/app/api/shorts/calendar-worker/route.ts` explicitly imports
`@/workflows/studioCalendar` for discovery. This import defines the workflow;
it does not start a scheduler or change request authorization. The worker route
still requires its signed, scoped service assertion. Normal instrumentation owns
startup and the durable occurrence/dispatch claims remain the no-repeat authority.

`apps/admin/scripts/verify-studio-calendar-workflow-build.mjs` checks both the
scheduler and tick identities in the generated manifest and executable routes.
It runs after the existing Admin build verifier. The actual Postgres workflow
then completed one automatic occurrence through Manager and native Mastra with
only following-fortnight dates and zero model tools. See
`docs/validation/studio-461/README.md` for current evidence and remaining gates.

The inspected bundle also omitted the existing search-trace-retention scheduler.
That observation was reported to root; its behavior is outside this ticket and
was not changed. Do not infer its runtime acceptance from the calendar fix.

## Match the production PostgreSQL adapter in database tests

Calendar source-presence projection joins a parameterized `VALUES` table to an
integer revision column. The engine client inferred numeric bindings in the
original fixture, while the production `PrismaPg` adapter left the values typed
as text. The built calendar therefore failed with PostgreSQL `42883` despite the
engine-client test passing. Explicit `text` and `integer` casts make the query's
column types unambiguous. Calendar database tests now use `PrismaPg`, and the
source-presence case covers multiple linked slots. Preserve the adapter-specific
red/green evidence; a direct service read now returns all 28 slots.

## Keep weekly suggestions within their admitted authority

All calendar-version writers must acquire the calendar row lock before reading
the version. An advisory creation lock alone does not serialize configuration
against weekly settings updates; reusing a version can admit stale pack context.

Automatic planning admits only the following fortnight. Weekly suggestions may
cover only complete weeks wholly inside that admission, with no existing human
weekly settings or protected slot. Completion locks every covered slot, checks
its admitted version, and preserves subsequent human weekly or pack-only edits.
A suggested theme's source pack is provenance, not an instruction to assign that
pack to every day. Keep effective weekly assignment null so neighboring dates
continue to use their explicit assignments or configured defaults.

A production request can refresh its selection only after a confirmed admission
rejection. A lost or ambiguous completion retains the exact envelope and native
claim; clearing it would permit duplicate generation. The Manager route emits
an explicit rejection marker only for known non-admission errors before execution.

## Separate human authorization, dispatch lease and accepted receipt

`calendar-publication.ts` owns immutable prior human intent: exact slot/version,
project revision, approval, render, release, due time and latest allowed time.
It excludes readinessId. `calendar-dispatch.ts` resolves fresh evidence through
`prepareScheduledStudioPublication` only before any submitted envelope exists.
It persists the exact envelope before calling `publishPreparedStudioProject`,
which supplies the same catalog verifier as manual publication.

Project locking precedes slot locking. The hook checks the current nonrevoked
operator membership and authorization after the slot lock and uses fresh server
time. Common publication rolls back consumption on verification/deadline failure.
A selected source reference must exist for calendar production readiness; a
manual empty-document capability does not make a guidance-only calendar slot ready.
Canonical publication still owns actual source eligibility, not that presence check.

Migration0092 records dispatcher leases separately from human authorization.
A lease may expire while an old preparation response is in flight. Persisting an
envelope and acknowledging dispatch both fence the exact lease ID. A replacement
worker can recover; the old worker cannot overwrite its accepted result. Retained
submitted envelopes bypass preparation, even after expiry or unpublish, so canonical
receipt lookup can resolve ambiguous success before any hook/state rejection.

Use a separate durable publication timer: a slow title planner must not hold up
due work. Both timers use the existing authenticated workflow discovery seam and
ledger recovery. Reuse canonical `reconcileStudioWatch` for durable visibility
and revocation delivery; do not copy a catalog registry or renderer into calendar.

## Expose current status without discarding uncertain commands

A definite stale-binding rejection refreshes calendar/project status and clears
selection/confirmation before a new command. A network-ambiguous authorization or
cancellation retains its exact request. Explicit refresh controls expose timer
outcomes without starting polling or extra paid work. Current permanent UNPUBLISHED
state takes precedence over historical accepted schedule receipts.

The native dialog needs its own opaque panel and accessible name. Existing edit
modal CSS applied the panel only to a child form; a newly added non-form modal was
transparent despite functioning correctly. Verify the actual built screen, not
only accessible controls or a successful submit.
