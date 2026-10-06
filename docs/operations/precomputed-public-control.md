# Saved Video recommendation A/B control

The manual control is visible at Admin
`/dashboard/recommendations/precomputed/public`. The incumbent remains the
default after migration and after every catalog build, report read, or CTR
evaluation. The isolated rehearsal can select an A/B cohort, promote an exact
final fixture result, and restore the incumbent. **There is no live launch
path yet:** the authenticated live human/bot and tracking-loss verifier is not
implemented. Do not interpret a fixture winner as live evidence.

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
digests, a cohort window, and the numeric stopping policy. It does not change
Watch serving. `start` requires the exact prepared configuration digest and
current pointer version; it does **not** require a winner report. A/B
assignment is stable by browser within the fixed cohort. `evaluate` stores an
immutable revision based on actual admitted visits and accepted clicks; a
provisional or inconclusive result cannot promote. `promote` requires a final
challenger report's exact experiment, generation, revision, and saved evidence
digest. These transitions are compare-and-swap and write compact operator
audit rows. Only the isolated fixture authority currently passes readiness.

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

## Live launch remains blocked

Admin readiness lists the missing verifier and evidence explicitly. The
current public report labels its bot-exclusion count as **Admin-bound only**:
known crawlers and prefetches skipped at Web never reach that counter. Ordinary
browser classification does not prove a human visit. A live qualification
must bind trusted bot/human signals, visit-ID and browser-identity loss,
Web/edge exclusion coverage, an agreed numerical stopping policy, generation
cost/coverage, capacity, and cohort/control identities into an immutable
versioned receipt. Until that code and audit are implemented and reviewed,
live start and promotion return a readiness error, even if a catalog build
finishes or a fixture shows a challenger result.

When those gaps are resolved, the owner can request the separate manual
activation in another task. This runbook does not schedule a refresh, deploy
code, activate public traffic, or message anyone.
