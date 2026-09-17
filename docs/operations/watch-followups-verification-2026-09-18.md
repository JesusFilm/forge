# Watch follow-up verification — 18 September 2026

Work started from freshly fetched `72dc5f792` in a dedicated worktree. All
timestamps below are UTC (the work date is September 18 in Auckland).

## Initial deployment and ownership check

Railway reported these successful deployments on September 17 at approximately
22:35. Later documentation-only main revisions were skipped by service filters:

| Service | Running revision                           | Deployment                             |
| ------- | ------------------------------------------ | -------------------------------------- |
| Admin   | `1a01e09fdb7a45c19bbbec29de4b22f42c0e2a20` | `30a6d470-d2a7-4510-b601-2163ea1be89f` |
| Worker  | `1a01e09fdb7a45c19bbbec29de4b22f42c0e2a20` | `ca1dfbc6-69f7-46b4-a08d-69c5214e728c` |
| Web     | `2bf3eba35f996884e2076fc3d60c3331146dfdb4` | `61c20bdd-6793-4cf7-a3ce-d708addc975d` |

SSH confirmed Admin's revision, `WORKFLOW_RUNNER_ENABLED=false`, and the
installed queue's implicit listener startup. Profiling remains enabled. No
merged correction was found for the four tickets' entry points since their
September 16 evidence. feat-515 already contains a matched baseline study;
the other three tickets were marked not started. Worktree and open-PR inventory
found no branch/PR explicitly owning these fixes. Another recommendations
analytics task is active; its worktree and services are left untouched.

At 22:50, a read-only PostgreSQL snapshot identified one Graphile listener
(`LISTEN "jobs:insert"; LISTEN "worker:migrate";`) from Admin's own network
address. The worker also owns one. Each service separately has two
`workflow_event_chunk` listeners; these are streaming listeners and must not be
confused with queue consumers or removed by this correction. SSH verified the
worker's true runner setting and local port 8080 with no external callback URL.

Datadog request counters for 21:00–22:50 on the revision above confirm actual
execution: Admin handled 2,688 workflow and 1,208 step callbacks; the dedicated
worker handled 2,250 workflow and 1,865 step callbacks. These use
`trace.POST.well_known_workflow_v1_flow.hits` and
`trace.POST.well_known_workflow_v1_step.hits`, summed as counts by service/version.
This establishes unintended Admin consumption independently of CPU sampling.
It does not attribute historical Watch timeout incidents to those callbacks.

## Initial browser field evidence

RUM window: September 16 04:30 through September 17 22:35, service `forge-web`,
environment `prod`, Watch paths. HTML React #418 observations include 59 desktop,
19 mobile and 73 bot events. The separate text variant has 656 desktop, 303
mobile and 547 bot events. These are retained RUM events, not unique people or
full-traffic error rates. A broad `*418*` search also matched unrelated resource
error text; only the explicit React message groups enter these figures.

Non-bot view events with LCP contain a slow tail:

| Device  | View events with LCP |      p50 |      p75 |      p95 |
| ------- | -------------------: | -------: | -------: | -------: |
| Desktop |                4,547 |   746 ms | 1,473 ms | 8,736 ms |
| Mobile  |                1,272 | 2,334 ms | 3,925 ms | 9,092 ms |
| Tablet  |                   33 | 2,334 ms | 4,891 ms | 7,011 ms |

These aggregate heterogeneous pages, connections and builds. They neither prove
the cause of the historical cold-paint observation nor justify altering preview
timing. No delivery-fallback or selection-acknowledgment conclusion follows from
RUM navigation, hydration or LCP observations.

## feat-513 local causal verification

The real PostgreSQL regression fails on the original package because the
false-enabled producer executes callbacks. A listener-only dependency patch
passes separate-process durable enqueue, worker consumption, deduplication,
transient retry, rescheduling, binary payload, header, cancellation and default
compatibility checks. The controlled benchmark and its limits are documented in
`docs/solutions/runtime-errors/postgres-workflow-enqueue-starts-disabled-admin-runner.md`.

Review found an additional default-policy gap in the first patch: it disabled
only explicit false, whereas Admin's validated environment defaults to false
when the variable is unset. The unset regression failed on that first patch.
The final correction therefore requires explicit true for listener startup.
This supersedes U1's initial proposal to retain the SDK's unset-enabled default;
the application's existing default-off contract is authoritative.

Final local checks passed: 7,271 Admin unit tests, 29 focused tests including
three real PostgreSQL process cases, Admin types, scoped lint, frozen install,
production build and workflow registration checks, and touched-file formatting.
Sequential Compound Engineering review covered correctness, testing, standards,
maintainability, reliability, performance and adversarial failure cases. The
default-policy finding above was fixed; no remaining code findings were found.
An earlier unit run overlapped Prisma generation and lost the generated client
mid-run; the clean final suite passed. An initial build omitted DATABASE_URL;
the repeated build used the owned local database and passed. Neither failure is
being presented as a passing run.

Production acceptance is pending. Do not mark this ticket complete from local
tests or from inspecting the patch alone. Require exact deployed Admin/worker
revisions and observed worker ownership after the normal PR/main release.

PR #2337's PostgreSQL job exposed an existing fixture clock dependency on
September 17: fixed request/projection expiry dates had passed while creation
and outcome timestamps still defaulted to database time. The unchanged tests
reproduced 25 failures locally. Explicit fixture timestamps now share the
existing August timeline, including the post-profile-creation request required
by the eligibility test. All 65 tests in the CI PostgreSQL command pass locally;
production migrations and integrity constraints are unchanged. Keep both ends
of a historical fixture's time window explicit instead of extending its expiry
whenever wall-clock time catches up.

## Remaining investigation

feat-516 still requires representative first/warm profiler characterization;
profiling remaining enabled is not evidence of the historical pause recurring.
feat-517 requires an exact SSR/client HTML mismatch reproduction. feat-515
requires a causal explanation of the cold-paint observation with field context.
These remain separate investigations and are not closed by the queue correction.

The English authored homepage row stays removed, the homepage recommendations
flag stays default off, and no Mobile/TV UI, account linking, curation
republishing, deadlines or mutation-retry policy is changed. All temporary
diagnostics must be restored; production releases use normal PR/main automation.
