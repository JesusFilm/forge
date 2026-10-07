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

## Live result qualification

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

Live preparation requires an owner-entered numeric
`maximumEndToEndLossRate` alongside the other agreed policy settings; null or
omission is blocked. After the cohort and late cutoff, a separately configured
browser/edge attestor must sign complete horizon counts, a conservative upper
loss bound, quiet-hour proof, and a passed drop/retry probe. An operator with a
recent Admin session transports that signed assertion using
`attest_final_calibration` on the same protected control route. Admin verifies
its configured source/key/method binding and frozen experiment identity before
an append-only insert. Evaluate only after the receipt: a missing receipt
returns `final_calibration_pending` without freezing an inconclusive final
report. An independently proven quiet hour may cover an absent scoped Redis
hash; unproved absence remains a gap. The final report includes the receipt
digest, source, upper bound, and scoped reconciliation. A clear challenger
result can be promoted only by the separate exact manual CAS action.

The verifier code is present, but no independent source/key, approved bound
method, actual calibration, or owner loss threshold is provisioned in this
repository. Do not configure an Admin/Web/fixture signer as the external
attestor. See [CTR report](precomputed-ctr-report.md) for the signed contract
and operator sequence. A point-in-time Railway disk snapshot is also not a
launch capacity receipt; build and baseline growth still need measurement.

Each recommendation delivery or selection can make two additional sequential
scoped Redis writes. Each uses the existing 250 ms bound, so a hung Redis path
can add up to about 500 ms before the response. The browser makes no extra
request: it keeps a short ticket from the existing delivery response in memory
and returns it in the existing selection POST. Monitor Watch latency as well
as counter coverage during a cohort.

When those gaps are resolved, the owner can request the separate manual
activation in another task. This runbook does not schedule a refresh, deploy
code, activate public traffic, or message anyone.
