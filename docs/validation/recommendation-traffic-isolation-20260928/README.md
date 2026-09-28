# Recommendation traffic isolation and selective conversion

## Scope and release state

This validates feat-559 and feat-560 against the approved
[implementation plan](../../plans/2026-09-28-002-fix-recommendation-traffic-isolation-plan.md).
The implementation preserves normal recommendations and attribution, excludes
recognized crawler persistence, defers speculative browsing until activation,
and provides selective lossless conversion of older candidate evidence.

Admin [PR #2439](https://github.com/JesusFilm/forge/pull/2439), Web
[PR #2440](https://github.com/JesusFilm/forge/pull/2440), and selective conversion
[PR #2441](https://github.com/JesusFilm/forge/pull/2441) are merged. Admin and Web
have converged, the public exclusion checks passed, and the finite production
conversion pilot completed with exact parity. The existing public For You flag
remains disabled; no rollout flag was changed for these checks.

## Local verification

Integrated main baseline: `6a49276079528cf637b7bae6b2caae6c643f95a6`.

| Check                                             | Result                                                      |
| ------------------------------------------------- | ----------------------------------------------------------- |
| Full Admin Vitest suite                           | 7,440 passed; 359 skipped; 1 todo                           |
| Full Web Vitest suite                             | 4,572 passed; 10 skipped; 1 todo                            |
| Final Admin traffic/resolver/conversion checks    | 39 passed, including 11 actual PostgreSQL cases             |
| Final Web contextual and For You component checks | 46 passed, including one/five/six contextual card cases     |
| Browser lifecycle fixture                         | 4 passed after final fixture fix                            |
| Admin and Web typechecks                          | Passed                                                      |
| Admin and Web lint                                | Passed after formatting and fixture hydration-marker repair |
| Admin SDL and gql.tada generation                 | Passed; no introspection output change required             |
| Previous deployed operation documents vs new SDL  | Both seeded and For You documents validate                  |
| Disposable database migrations                    | All 105 migrations through 0104 applied                     |

The PostgreSQL no-write proof reads real curated inventory and traps every
recommendation table mutation, including tables discovered dynamically from the
current migrated schema. It tests profile-backed crawler, speculative and legacy
false-eligibility inputs. A separate ordinary issuance control persists normally.
Resolver tests cover identity bypass and credential removal before service entry,
plus ordinary/older caller behavior and untrusted classification rejection.

Conversion proof covers exact typed stage equality, nested JSON and large numeric
values, full reader parity, preserved parent/item/expiry values, unsupported
precision/counts, frozen holds, late access evidence, dry run, replay, real
retention deletion and advisory-lock contention. Failure on the second run's
delete rolls back both runs in the manifest.

## Browser and loading evidence

The test fixture uses real recommendation, consent and playback-claim components
with synthetic catalog data and mocked APIs. It returns 404 in production and
without the Playwright flag. The ordinary and simulated-prerender paths prove:

- No delivery or automatic profile POST before activation.
- A reused deferred body causes one fresh ordinary delivery.
- Render, native visibility impression, selection and matching-nonce playback
  claim use the fresh delivery; capability values are absent from the DOM.
- One refresh follows a simulated persisted `pageshow` event.
- Contextual cards navigate without evidence, selection or playback-claim calls.

In the first local development timing sample, seeded ordinary HTML response/FCP
were 169/300 ms and delivery finished at 1,160 ms. For You was 95/268 ms with
delivery finishing at 1,113 ms. Inactive fixtures made zero profile/delivery API
requests; delivery began after the explicit activation event. Mocked 300 ms API
delays establish ordering, not a production latency delta. The test simulates
`document.prerendering` and persisted `pageshow`; it does not prove native Chrome
prerender activation or BFCache restoration.

## Independent review

Fifteen bounded review passes covered correctness, testing, maintainability,
project standards, agent accessibility, relevant prior learnings, security,
performance, API contracts, data conversion, reliability, adversarial scenarios,
TypeScript, frontend races and deployment verification.

Four introduced findings were fixed: contextual positions were one-based,
partial seeded slates omitted shortfall metadata, the test fixture omitted page
metadata, and conversion identity queries preceded transaction budgets. Focused
re-review found no remaining actionable issue in those changes. Plan review also
required Admin-first deployment; the two-release barrier is explicit in the plan.

Residual limits: UA declarations do not identify every robot; sampled indexed
logs are not complete traffic accounting; frozen investigation holds need operator
review; native browser cache behavior and production latency remain separate
observations. Conversion may safely skip changed/expired/already converted runs;
stop before further batches on any unexpected skip.

## Release verification

The Admin contract merged as `663b4282b` at 02:41:08 UTC; conversion tooling
merged as `392c71f8a` at 02:41:12 UTC. Both active Admin processes converged on
`392c71f8a` before Web merged. An authenticated local GraphQL probe on each role
verified the actual process revision before querying seeded and For You delivery
with speculative classification. All four surface responses returned HTTP 200,
no GraphQL errors, empty deferred delivery and no request ID or expiry. The
probe used inert identity inputs and issued no ordinary recommendation request.
Response shape alone is not a database no-write proof; the real PostgreSQL
write-trap tests and aggregate observations provide complementary evidence.

Web merged as `36dba0bc5` at 02:54:22 UTC after this compatibility barrier.
The rebased Web CI run and its Railway preview both passed before merge.
Main-branch checks also passed, including CodeQL at 03:10:41 UTC. Web converged
at 03:16:29 UTC: one active successful deployment and replica, matching actual
process revision, configured `/watch` health 200, and the old deployment drained.
Fresh Admin checks at 03:17:18 UTC still found both roles healthy on `392c71f8a`.

Seven bounded public POSTs completed at 03:17:37 UTC:

| Probe                                   | Result                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Seeded declared crawler                 | 200; six public contextual cards; no request ID, expiry, personalization or cookie; inert capabilities |
| Seeded prefetch                         | 200; empty deferred delivery; no attribution or cookie                                                 |
| Seeded prerender                        | 200; empty deferred delivery; no attribution or cookie                                                 |
| Public For You crawler                  | 403 `feature_disabled`; existing flag preserved; live public delivery path not exercised               |
| Crawler profile status, grant and reset | All three 403 `machine_profile_rejected`; no cookie                                                    |

Every response retained private/no-store cache headers. No ordinary synthetic
delivery, selection, impression or playback claim was issued. The published
English JESUS seed was verified with a read-only catalog lookup and HTML GET.
Admin's direct deferred probes and disposable PostgreSQL tests cover For You;
they do not substitute for a live public For You rollout while its flag is held.

The fixed 03:16:29–03:20:09 UTC indexed window selected exact Web `36dba0bc5`
and Admin `392c71f8a` versions. Admin recorded eleven crawler attempts and eleven
persistence-avoided/contextual outcomes, one prefetch and one prerender attempt
with matching deferred/avoided outcomes, and **zero excluded commits**. Web also
recorded zero unexpected-upstream-commit markers. Natural ordinary traffic had
twelve upstream attempts: eleven commits (eight served and three fallback), and
one delivery timeout without a committed request. No indexed recommendation
delivery 5xx occurred. Ordinary and crawler requests rejected for invalid fetch
metadata remained rejected; the new classification did not bypass origin policy.
The public For You request stopped at its existing feature flag and reached no
Admin delivery service.

These counts combine bounded probes and natural traffic. They are hot indexed
samples with forwarding/ingestion limits, not complete traffic totals or proof
of each individual probe's log record. They do not establish an error-free Web
service or a steady-state latency comparison.

The broader Web error bucket was investigated separately. All 2,073 indexed
`status:error` messages in the new-release window were LaunchDarkly unknown-flag
messages returning defaults. An equal 220-second old-release window
(03:10:00–03:13:40 UTC) contained 2,020 messages for the same four flag keys:
question panel, Bible-quote visibility, download account gate and global beta
tester CTA. No other error class appeared in either bounded comparison. These
are repeated log events, not failed-request rates. The pre-existing registration/
evaluation question is recorded in feat-562; no flag or logging policy was
changed as part of this release.

All scoped Actions checks passed for the Admin, Web and conversion PRs, including
schema drift and shared consumers. Admin's first CI attempt exposed a pre-existing
concurrency test race: three fast reconciliation passes could finish before the
independent writer performed its asserted work. The repaired test waits for more
than ten actual overlapping writes while retaining at least three passes, each
five-second transaction budget and the twenty-second test timeout. All thirteen
cases passed, including a slower-writer probe in which the old three-pass window
would have seen only seven writes. No production budget was relaxed.

## Selective legacy preparation

The original 64 quality-audit run IDs were frozen privately before changing the
legacy population. The selector SHA-256 is
`c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1`.
Quality and cleanup audit tasks identified no additional explicit investigation
run IDs. Direct experiment/shadow/promotion/conflict/access links are also
excluded. Existing expiry remains in force.

A read-only September 12–13 UTC inventory selected ten older runs: six semantic
and four hybrid, totaling 689 stage rows and 519,932 encoded bytes. Freeze took
7.18 seconds and dry run 8.04 seconds including startup/network, with zero skips.
Per-run encoded size ranged from 3,970 to 160,100 bytes. Parent/item hashes and
expiry remained unchanged after preparation. Private artifacts are mode 0600 and
are not committed. Manifest SHA-256:
`295f69c55677ecddfac4ad106bbbb451980682a3836a1d28ceb2940bc46d70ea`.

A separate synthetic ten-run disposable benchmark converted 2,720 stages in
2.56 seconds, adding 237,568 bytes of run/TOAST allocation and 1,771,896 bytes of
WAL after a local checkpoint. Stage allocation remained unchanged. See the
[runbook](../../operations/legacy-recommendation-trace-conversion.md) for the full
measurement limits and exact parity/rollback procedure.

At `2026-09-28T02:18:58Z`, production had 11,234,263,040 filesystem bytes available
(78% used). Both active Admin roles were healthy on `8ddd29c5b`, with compact trace
writers and the worker-only runner split. This is a preparation receipt, not the
fresh pre-execution capacity check.

No immediate filesystem recovery is promised by selective DELETE. The duplicate
index saving from the earlier storage release is separate and must not be counted
again; exact-empty legacy relation reclamation remains feat-555.

## Production conversion pilot

At `2026-09-28T02:54:53Z`, the reviewed CLI converted the original frozen ten-run
manifest: **10 converted, zero skipped, 689 redundant stage rows removed, and
519,932 encoded bytes retained**. Process/startup/network-inclusive duration was
11.04 seconds. No further batch was executed.

The source was reviewed as `ff411791c` and merged in `392c71f8a`. At 02:52:43 UTC,
both actual Admin roles ran that release, each with one active successful
deployment, health 200 and compact tracing enabled; only the worker ran workflows.
The prior deployments had drained. The refreshed dry run had zero skips, and the
saved parent/item/expiry hashes were unchanged before execution. The operator
required at least 10,000,000,000 free filesystem bytes and used 64 MiB of global
WAL insertion growth as a stop-and-review threshold for further batches. That
threshold was not an in-flight cancellation or peak-use guarantee.

Read-only verification at 02:55:23 UTC found ten exact original SQL fingerprint
matches, all 689 observations in valid compact payloads, zero remaining legacy
stages for those runs, and unchanged request/run metadata, served items and
original expiry. The 64 frozen quality-audit holdouts and linked investigation
exclusions remained outside the manifest. Holds do not extend normal retention.

| Shared production measurement                           | Observed value        |
| ------------------------------------------------------- | --------------------- |
| Database measurement interval                           | 02:54:39–02:55:21 UTC |
| Global WAL insertion delta                              | 4,983,336 bytes       |
| Candidate-run allocation delta, including TOAST/indexes | +147,456 bytes        |
| TOAST allocation delta, included in the preceding row   | +131,072 bytes        |
| Legacy-stage relation allocation delta                  | 0 bytes               |
| WAL directory allocation before and after               | 100,663,296 bytes     |
| Filesystem available at 02:55:34 UTC                    | 11,207,565,312 bytes  |

Free bytes declined by 1,667,072 across the runtime snapshots. These are shared
database interval measurements with concurrent ordinary traffic, not isolated
pilot costs or continuous peak measurements. No immediate filesystem saving is
claimed. Both configured operating thresholds remained satisfied; no lock wait,
at-risk replication slot or archiver failure was observed. There were no
replication connections or slots, so these reads do not establish replication
lag or backup readiness.

The indexed post-pilot Admin window, 02:54:53–02:58:13 UTC, contained 25 seeded
completion samples on `392c71f8a`: 15 served, five empty, four fallback and one
unavailable timeout fallback. Served p95 was approximately 1,108 ms. This small
deployment-transition sample does not establish a causal link or a steady-state
latency comparison. No further conversion batch followed.

The same window recorded 16 unknown-category measured attempts/commits and nine
legacy-ineligible contextual attempts/avoided writes. The wider 02:51–02:58:13
window included speculative attempted, deferred and persistence-avoided counters
for both seeded and For You, with zero indexed speculative commits. Indexed
forwarded logs are incomplete and have no role dimension here; they cannot
count all requests or attribute both role probes independently.

The latest three durable retention entries remained successful zero-root runs,
most recently September 27 at 10:30 UTC. They do not prove loaded purge capacity.
The last legacy write remained September 27 at 23:24:43.215 UTC, with original
expiry October 26 at 23:24:43.126 UTC. Feat-554 retains the first two loaded purge
and capacity gates; feat-555 retains separately reviewed physical reclamation.
