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

Follow [the catalog build procedure](precomputed-catalog-build.md) with a
verified GA origin in the target Admin, a fresh observed PGDATA capacity
attestation, a fixed UTC cutoff, and a new generation ID. The approved path is
the protocol-4 `precomputed:subscription:run-manual` command on the initiating
operator's computer, using that person's signed-in Codex subscription and exact
`gpt-6-astra`. It writes to the configured target Admin; there is no supported
whole-generation local-to-production import. Each start or resume is explicit,
with fresh identity, allowance and capacity checks. The default allowance reserve
is 25%; the account owner's explicit authorization permits the local
`minimumRemainingPercent: 0` option described in the catalog build procedure.
Exhausted or unavailable allowance still stops new work. There is no paid model
API fallback or automatic resume.
Read the resulting Admin build report at
`/dashboard/recommendations/precomputed?generation=<id>`: inspect source
coverage, failures and empty results, known token counts, unknown consumption,
account allowance observations, GA HTTP attempts, elapsed time, and retained
storage. Preserve historical API charges separately; subscription usage has no
provider USD receipt and must not be described as zero token consumption. Report
the actual observed usage and unresolved consumption to the owner before choosing
any recurring refresh cadence. No cadence is configured by this feature.

Review [storage and retention](precomputed-storage-capacity.md) alongside the
build report. The local capacity and CTR fixtures are protocol tests; they are
not Railway headroom, real model spend, or a qualified eligible-human traffic
sample.

## Start the qualified incumbent baseline

After authorized normal deployment and verification configuration, an operator
with a recent Admin session and `operate:recommendation-experiments` submits
`{"action":"start_baseline"}` to the protected public-control POST route below.
This schedules incumbent-only measurement; it does not activate A/B. The Admin
must run with `NODE_ENV=production`, the Turnstile fixture flag off, the human
proof secret and exact hostname allowlist configured, an incumbent pointer,
a valid incumbent routing manifest, and no already-enabled baseline. Do not
stop a completed baseline merely to mark it finished: stopped runs cannot
supply the live launch certificate.

Verify these dependencies before starting the clock:

| Runtime              | Configuration and evidence                                                                                                                                                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web                  | Real `NEXT_PUBLIC_WATCH_RECOMMENDATION_TURNSTILE_SITE_KEY`, matching `WATCH_RECOMMENDATION_TURNSTILE_SECRET_KEY`, exact `WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES`, and `WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET` of at least 32 bytes; fixture flag off. Siteverify must accept action `watch_recommendations` for an allowed hostname. |
| Admin                | The same `WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET` and hostname allowlist; the Web consumer bearer must be authorized as a non-fleet consumer. Admin validates a receipt bound to visit, signed browser, source, locale and audio language.                                                                                              |
| Web counters         | Working `REDIS_URL` and `WATCH_RECOMMENDATION_MEASUREMENT_API_KEY` of at least 32 characters. Counters must survive process restarts and cover every completed UTC hour.                                                                                                                                                                 |
| Admin counter reader | The same measurement API key and `PRECOMPUTED_WATCH_MEASUREMENT_URL=https://www.jesusfilm.org/watch/api/internal/recommendations/precomputed-measurement`. The reader requires HTTPS and the `/watch` prefix, with no URL credentials, query, fragment or redirects; verify the authenticated contract for completed UTC hours.          |

The October 13 read-only production configuration inventory at
`2026-10-12T19:14:40Z` found these human-proof, Turnstile and measurement values
absent from both Admin and Web. Web's existing tester secret does not qualify
live traffic. Existing Web-to-Admin private GraphQL routing is configured, and
Railway production configuration access is available; neither proves the new
feature is deployed or that Redis and the verification path work. The fresh
read-only deployment/database audit at `2026-10-12T19:15:47Z` found Admin health
HTTP 200, public-control HTTP 404, and zero precomputed tables in the actual
Admin PostgreSQL target. The feature is undeployed; the baseline has no recorded
production start or qualified sample at this checkpoint. The physical volume
snapshot is separate from a catalog or launch-capacity receipt.

The canonical `www.jesusfilm.org/watch` returns HTTP 200; the bare domain
redirects to `www`. Web has a configured Redis URL, but actual counter coverage
still needs verification after deployment. The inspected runtime/local stores
have no Cloudflare/Turnstile credential, and the Cloudflare browser session is
signed out. An authorized account session or identified secure credential store
is therefore needed to inspect existing widgets before provisioning.

For authorized provisioning, first inspect the owning Cloudflare account for a
suitable real widget. If none exists, use the
[Turnstile dashboard](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)
to add a widget, or the
[supported widget API](https://developers.cloudflare.com/turnstile/get-started/widget-management/api/)
with the account ID and `Turnstile Sites Write` permission. Account-level
`Turnstile Sites Read` permits inventory; a zone cache-purge credential does
not establish that permission. Use the actual canonical browser hostname(s),
not an unverified Railway service domain, and store the secret key privately.
Propose a real **Managed** widget for `www.jesusfilm.org`: the existing client
uses explicit rendering, action `watch_recommendations` and
`appearance: "interaction-only"`. Non-Interactive is an alternative only after
its actual production verification flow is checked. Preserve the existing
player-independent loading. Generate separate strong human-proof and
measurement secrets in the approved secret store, share each only between its
required runtimes, and stage the public sitekey before Web's normal build.
Observe the existing production approval boundary; this procedure does not
authorize widget creation, secret provisioning, deployment or baseline start.

Known crawlers, prefetches and prerenders are excluded before human admission.
An ordinary user agent or a supplied Cloudflare header is not human proof.
Only a valid Siteverify result and its short Web-signed receipt admit a baseline
visit. Redis counts request attempts, including retries; PostgreSQL counts
distinct admitted visits and accepted selections. GA page views, historical
navigation aggregates and the development week cannot substitute for this sample.

For command time `T`, the service chooses
`S = (floor(T / 1 UTC hour) + 1) UTC hour`, even when `T` falls on an exact hour.
The collection ends at `S + 168 hours`; late selections close at `S + 192 hours`;
the earliest report finalization is **`S + 192 hours + 5 minutes`**. For example,
a command at `2026-10-13T00:30:00Z` schedules `S=2026-10-13T01:00:00Z` and can
first finalize at `2026-10-21T01:05:00Z`, or **October 21, 14:05 NZDT**. This is
an example, not a recorded production start. Record the actual returned start,
end and earliest finalization in UTC and Pacific/Auckland after the action.

Read Admin readiness to obtain the saved final report and its digest. Launch
requires an unstopped `live_verified` 168-hour baseline with nonzero eligible
visits and an observed CTR, all 168 Web hours complete and balanced, qualified
delivery attempts at least equal to durable visits, and zero observed
`click_unavailable` and `delivery_verification_unavailable` in that window.
An absent hour remains unknown. A failure to collect this evidence requires
repair and a new qualified window; do not shorten or backfill the baseline.

## Proposed numeric policy for owner agreement

These are **proposals**, not approved live values or fixture defaults. Freeze
the agreed policy before preparation; preserve the accepted 50/50 assignment,
one UTC calendar month, return to incumbent and manual reevaluation.

| Policy field                       | Proposed value or required observation                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baselineHumanVisitCtr`            | Unknown until the qualified final baseline; copy its exact `visitCtr`, bound to `baselineReportDigest`. Historical GA CTR is not eligible.                              |
| `minimumDetectableAbsoluteUplift`  | `0.02` (two percentage points) for planning.                                                                                                                            |
| `minimumPracticalAbsoluteUplift`   | `0.01` (one percentage point), alongside the existing 95% clustered interval excluding zero.                                                                            |
| `plannedPower`                     | `0.80`; the stored number is a planning declaration, not a runtime power calculation.                                                                                   |
| `minimumEligibleVisitsPerArm`      | Proposed floor `11000`, raised if baseline repeat-visit/variance analysis requires more.                                                                                |
| `minimumIndependentBrowsersPerArm` | Proposed floor `11000`; the evaluator checks both nominal and effective browser counts. Confirm feasibility and sample planning from qualified traffic before agreeing. |
| `minimumDurationHours`             | `672` (the shortest calendar month); the separately frozen calendar-month end remains mandatory and may be 696, 720 or 744 hours later.                                 |
| `lateEventCutoffHours`             | `24`.                                                                                                                                                                   |
| `maximumActualFallbackRate`        | `0.05`. This concerns actual fallback lineage, not valid empty or partial recommendation rows.                                                                          |
| `maximumUnlinkedDeliveryRate`      | `0.01`.                                                                                                                                                                 |
| `maximumEndToEndLossRate`          | `0.01`, requiring an independently justified conservative bound at final certification.                                                                                 |

The sample floors do not establish that this deployment can meet 80% power.
Before agreement, use actual baseline eligible visits, distinct browsers,
repeat-visit distribution and observed CTR to assess the declared two-point
effect under the existing browser-cluster method. The report's `10+` bucket
does not expose exact cluster moments; do not infer a precise design effect
from that bucket. Exact variance planning, expected month traffic, retained
bytes per visit and combined volume projection remain unknown until measured.
If the one-month cohort misses sample or health thresholds, report inconclusive;
do not extend it or promote automatically.

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
digest, source, signed transport bound, and reconciled bound that also charges
reached-Web attribution gaps and scoped failed outcomes. A clear challenger
result can be promoted only by the separate exact manual CAS action.

The final receipt and `PRECOMPUTED_FINAL_CALIBRATION_PUBLIC_KEYS` are **final
winner-certification requirements**, not current `prepare`/`start` gates. A final
receipt cannot exist at launch because it covers the complete cohort plus late
clicks. Operationally, select an independent source, approve its bound method,
and prove its collection/drop-and-retry path before the cohort starts so the
required full-horizon evidence can be collected. The current code does not
enforce this operational checkpoint. An edge-only census cannot by itself
observe browser attempts that never reach that edge; do not assert complete
browser-to-Web loss from server counters. The independent source must account
for this blind spot conservatively under its approved method.

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
