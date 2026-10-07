# Saved Video recommendation A/B control

The manual control is visible at Admin
`/dashboard/recommendations/precomputed/public`. The incumbent remains the
default after migration and after every catalog build, report read, or CTR
evaluation. The isolated rehearsal can select an A/B cohort, promote an exact
final fixture result, and restore the incumbent. Live `prepare` and `start`
exist, but they require the owner-entered numeric policy, complete real Astra
generation and catalog, verified seven-day incumbent baseline, Web request
health, and separate launch-capacity receipt. Do not interpret a fixture winner
as live evidence or treat a successful preparation as activation.

## Obtain the first real catalog cost and coverage

Follow [the catalog build procedure](precomputed-catalog-build.md) with the
authorized Astra and GA credentials, a fresh observed PGDATA capacity
attestation, a fixed UTC cutoff, and a new generation ID. This is a paid,
manual build through the usual deployed Mastra entry point, not an A/B start.
Read the resulting Admin build report at
`/dashboard/recommendations/precomputed?generation=<id>`: inspect source
coverage, failures and empty results, token counts, provider-reported USD,
unknown charges, GA HTTP attempts, elapsed time, and retained storage. Report
the actual observed cost and unresolved charges to the owner before choosing
any recurring refresh cadence. No cadence is configured by this feature.

Review [storage and retention](precomputed-storage-capacity.md) alongside the
build report. The local capacity and CTR fixtures are protocol tests; they are
not Railway headroom, real model spend, or a qualified eligible-human traffic
sample.

## Manual selection and rollback

The Admin page and authenticated agent HTTP route call the same control
services. The agent route is
`GET/POST /api/recommendations/precomputed/public-control`, using an existing
Admin session. Mutations require a canonical same-origin `Origin` header,
`Content-Type: application/json`, and
`x-forge-csrf: precomputed-public-control-v1`. `prepare`, `start`, and
`promote` require recent authentication; rollback remains available without
re-authentication. All responses are `no-store`. A producer/Mastra bearer
cannot operate this route.

`prepare` freezes a complete generation, source-set and incumbent-routing
digests, a one-UTC-calendar-month cohort window, and the predeclared numeric
stopping policy. It does not change Watch serving. `start` requires the exact
prepared configuration digest and current pointer version; it does **not**
require a winner report. A/B
assignment is stable by browser within the fixed cohort. `evaluate` stores an
immutable revision based on actual admitted visits and accepted clicks; a
provisional or inconclusive result cannot promote. `promote` requires a final
challenger report's exact experiment, generation, revision, and saved evidence
digest. These transitions are compare-and-swap and write compact operator
audit rows. Live authority passes preparation and start only when its actual
prelaunch evidence checks pass; no fixture can stand in for those receipts.

`rollback` needs the current pointer version, exact experiment/generation and
report revision/digest (null while still in A/B), plus a reason code. It
switches selection to the incumbent immediately without deleting the cohort,
issued requests, accepted late events, archived counts, final report, or
model-cost receipts. If a response is lost, **read the pointer first** before
retrying; a stale version must not be guessed. An active or retained cohort
pins its frozen generation against retirement. Raw visit/request evidence
follows the 29-day retention path, compact CTR aggregates preserve the
decision, and operator audit rows expire after a year.

After the experiment's one-year review horizon ends, an operator may call
`release_retained` with the exact incumbent pointer version, retained
experiment ID, and reason code. This drops only the rollback pin; ordinary
bounded retention may then remove the expired cohort and, when no other
protection applies, its generation. An early or mismatched release is denied.

## Live result qualification remains blocked

Admin readiness lists missing evidence explicitly. The public report labels
its bot-exclusion count as **Admin-bound only**: known crawlers and prefetches
skipped at Web never reach that counter. For a live cohort, Web now retains
only bounded per-experiment hourly request counts. Its authenticated read
distinguishes attributed delivery attempts, eligible responses, click
acknowledgements, and server-observed failures; the report reconciles those
against Admin's durable distinct visits and selections. Retries can raise Web
counts without adding a distinct visit or click. Missing hours, unscoped
response-less Admin failures, and browser/network attempts that never reached
Web remain unknown, not zero. See [CTR report](precomputed-ctr-report.md).

Live promotion remains closed even when scoped server counts show no observed
shortfall. The next qualification step is an independent production
browser/edge calibration over the same frozen cohort and late-event horizon,
including induced drops and retries, plus the owner's numeric acceptable-loss
limit. Bind the calibration, uncertainty and threshold to an immutable final
report before changing the live promotion guard. No threshold is assumed by
this runbook. A point-in-time Railway disk snapshot is also not a launch
capacity receipt; build and baseline growth still need measurement.

When those gaps are resolved, the owner can request the separate manual
activation in another task. This runbook does not schedule a refresh, deploy
code, activate public traffic, or message anyone.
