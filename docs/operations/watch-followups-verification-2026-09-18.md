# Watch follow-up verification — 18 September 2026

Work started from freshly fetched `72dc5f792` in a dedicated worktree. All
timestamps below are UTC (the work date is September 18 in Auckland).

Current disposition:

| Ticket   | Disposition                                                                                   |
| -------- | --------------------------------------------------------------------------------------------- |
| feat-513 | Complete: deployed runner isolation and worker execution verified.                            |
| feat-516 | PR #2339 merged; exact production deployment/collection acceptance pending.                   |
| feat-517 | Complete for the reproduced autoplay HTML mismatch; exact Web revision and playback verified. |
| feat-515 | Open: current native-poster LCP characterized; historical late H1 not reconstructed.          |
| feat-496 | Reopened by a later confirmed selection deadline failure.                                     |

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

Production acceptance was pending at PR creation; the completed release evidence
is recorded below. Local tests alone were not used to close this ticket.

PR #2337's PostgreSQL job exposed an existing fixture clock dependency on
September 17: fixed request/projection expiry dates had passed while creation
and outcome timestamps still defaulted to database time. The unchanged tests
reproduced 25 failures locally. Explicit fixture timestamps now share the
existing August timeline, including the post-profile-creation request required
by the eligibility test. All 65 tests in the CI PostgreSQL command pass locally;
production migrations and integrity constraints are unchanged. Keep both ends
of a historical fixture's time window explicit instead of extending its expiry
whenever wall-clock time catches up.

## Initially remaining investigation

feat-516 still requires representative first/warm profiler characterization;
profiling remaining enabled is not evidence of the historical pause recurring.
feat-517 requires an exact SSR/client HTML mismatch reproduction. feat-515
requires a causal explanation of the cold-paint observation with field context.
These remain separate investigations and are not closed by the queue correction.

The English authored homepage row stays removed, the homepage recommendations
flag stays default off, and no Mobile/TV UI, account linking, curation
republishing, deadlines or mutation-retry policy is changed. All temporary
diagnostics must be restored; production releases use normal PR/main automation.

## feat-513 release acceptance

PR #2337 merged at September 17 23:33:55 UTC as
`9cdb79b13e0868f549de118b45db9f685dba0529`. Admin deployment
`bcc3defe-c9c5-4545-b2c0-b286b9358ad2` and worker deployment
`3d18e1e7-29f9-44a3-8b80-8673e5054db5` both completed automatically. SSH verified
the exact running revision and false/true runner flags. PostgreSQL then showed
zero Admin Graphile job listeners and one worker job listener; their two stream
listeners each remained. In 23:43–23:58, Datadog counters recorded 1,083 flow and
539 step callbacks on that worker revision and none on Admin. The selection
trace below also contains successful Admin durable enqueues after deployment.
The ticket is complete for runner isolation, not for every Watch latency cause.

## Post-isolation outcomes remain separate

- 23:44:47–23:46:00: five HTTP 200 served deliveries, six cards each; three valid
  selection acknowledgments at 361/564/441 ms. The navigation-wait harness timed
  out, so this batch is incomplete. No JavaScript error was recorded.
- 23:47:54–23:48:47: 12 HTTP 200 served deliveries, six cards each, no semantic
  fallback. Five valid selection acknowledgments at 309–456 ms and one browser
  abort at 801 ms. Trace `e3c73fbba25d1f77b5c137ec7115347a` confirms Web HTTP 503
  at 750 ms and upstream timeout at 745 ms; the Admin mutation continued for
  1,432 ms. Client database spans include a 248 ms advisory-lock call, but span
  duration alone does not separate lock execution, transport and scheduling.
- 23:54:31–23:55:19: 12 HTTP 200 served deliveries without fallback, five valid
  acknowledgments at 231–365 ms and one browser abort at 802 ms. Trace
  `a64da9690bf79a3686945e8ee6038bac` instead reports Web HTTP 200 at 560 ms,
  upstream 556 ms and Admin request 43 ms. That abort is not a confirmed server
  HTTP failure or an Admin resolver deadline failure.
- September 18 00:02:26–00:03:11: 12 served six-card deliveries and six valid
  selection acknowledgments at 240–378 ms; no HTTP/semantic failure or JavaScript
  error. This short healthy batch does not erase the failures above.

The corrected navigation harness waits for the exact target path and DOM content
rather than unrelated late `load` work. The failed earlier batch remains in the
record. The controlled traffic is not a full-traffic failure-rate estimate.

A 65-second read-only PostgreSQL sampler overlapping the 23:55 browser abort
found no lock blockers in 633 samples; its independent query round trip was at
most 8 ms. It also saw unrelated active work lasting 1.88 seconds. A later
relation-only capture identified approximately 1.93-second `language` queries;
that later window had healthy selections, so no causal attribution follows.
Sampling can miss short waits, and client connection spans are not a complete
pool-wait measurement.

A bounded timing-only capture at 00:02:26–00:03:36 observed ordinary Admin heap
and wall collection at 33.45 + 42.83 ms, with maximum loop delay 117.77 ms. No
second CPU sampler ran. The capture restored both wrappers and its loop monitor;
a separate SSH check confirmed the inspector was closed. Profiling stayed on.
These warm measurements do not invalidate the independently reproduced cold
collection cost under feat-516, and neither proves the cause of all selections.

## feat-517 release acceptance

PR #2338 merged at 23:51:54 as `cc5a5056562dce3cc70dbcd8fce2713128450e97`.
Before its deployment, fresh production `chosen-witness.html?autoplay=1` and
`sermon-on-the-mount-2.html?autoplay=1` visits both reproduced HTML React #418,
while their query-free controls passed. This independently confirms the local
cached-HTML reproduction. Railway deployment `215a8220-9a43-4be9-8148-4ea03815b9f7` subsequently completed,
and SSH verified that exact running Web revision. The identical five-case
production browser matrix passed with no errors. A real unmuted Watch now play
followed by an autoplay navigation continued unmuted playback from 1.05 to 3.56
seconds, without JavaScript errors. The causal HTML regression, unchanged-query
controls and preserved playback complete this demonstrated correction; the
original unretained arrival query and other RUM variants remain limitations.

The unsampled HTTP counter window 23:43–00:10 spans Web revisions `2bf3eba35`
and `9cdb79b13`: 25 selection HTTP 200s and one HTTP 503; delivery has 218 HTTP
200s and 135 HTTP 403 policy rejections, with no observed delivery 5xx. Those
218 HTTP 200s do **not** measure semantic delivery success; only inspected bodies
in the browser batches establish their served/fallback outcomes. Runtime loop
metrics use `env:production`, while these HTTP counters use `env:prod`; querying
the wrong tag returns no data, not evidence of no delays.

Four spaced browser batches at September 18 00:11:28–00:17:30 completed 24 valid
selection acknowledgments and 48 HTTP 200 served six-card deliveries, with no
semantic fallback, delivery HTTP failure, abort or JavaScript error. This spans
the Web hydration rollout and remains a bounded synthetic population. The
00:13 onward RUM window contains 34 Watch view events tagged with `cc5a50565`
and no retained HTML #418 event at the time checked; its short duration and
sampling do not establish universal absence.

At 00:17:24, a read-only production query confirmed the published English
`watch-home` locale still has no authored homepageRecommendations block.
`packages/feature-flags/src/registry.ts` still defaults
`forge.watch.homepageRecommendations` to false. No content republishing or
Mobile/TV UI, account-linking, deadline, authorization, attribution or rate-limit
change was made.

Six fresh-browser Simple Gospel visits on verified Web `cc5a50565` recorded
first paint at 980/1,372/564/560/580/472 ms and no JavaScript errors. Their later
VIDEO LCP candidates remain around 9.35–10.88 seconds. The separate local
media/poster controls explain that current candidate transition; these visits
do not reconstruct the historical late-heading case retained in feat-515.
