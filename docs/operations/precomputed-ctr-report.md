# Precomputed recommendation CTR report

The Watch experiment's durable report is available in Admin at
`/dashboard/recommendations/precomputed/visits`. Select an experiment to see
its frozen cohort and latest revision; revision links open immutable earlier
results. The older visit/click panels read the ordinary raw lifecycle and can
show fewer visits after expiry. Use the versioned CTR report for the full cohort.

An AI using an existing Admin OAuth session cookie with
`read:recommendation-aggregates` can read the same stored JSON result through
`GET /api/recommendations/precomputed/ctr-report?experimentId=<id>`.
Add `&revision=<1..33>` to retrieve a specific revision. Responses are
`no-store`; an HTTP 200 response with `status: "unavailable"` means no stored
report exists at that address. Authentication, permission, and request errors
use non-200 responses. The endpoint never evaluates, routes traffic, or promotes
a generation.

An operator may declare **fixture-only** numeric settings before the first
visit, then save provisional evaluations. Existing experiments with retained
or archived visits cannot gain a policy retroactively; create a fresh private
test. At most 32 provisional revisions can be stored, reserving revision 33
for the one final report at `endsAt + lateEventCutoffHours`. Evidence accepted
within the cutoff can create a new provisional revision. After finality,
subsequent evaluations return the same stored result. The policy and every
report revision are immutable.

Primary CTR counts distinct eligible Watch visits with at least one accepted
recommendation selection over all eligible visits in the assigned arm. Empty,
failed, and fallback deliveries remain in that denominator. A selection may
count without a qualified impression; card CTR separately uses matched
selections over qualified impressions. Inference groups repeated visits by
browser and uses a fixed-horizon cluster delta-method interval with a
tabulated conservative Student-t critical value. The interval is an
approximation, not an exact small-sample coverage guarantee.

The private report always says **inconclusive**: bot eligibility is not
verified, browser event loss is unobservable, and fixture settings are not a
measured human baseline or an agreed live stopping policy. No report read or
evaluation activates public serving.

A live report additionally reads Web's authenticated, experiment-scoped hourly
counters over the frozen cohort and late-click cutoff. Web counts attributed
delivery attempts only after Admin identifies the experiment, and counts
click attempts, acknowledgements, and failures only when a short signed
measurement ticket binds the request to that experiment. These are **request
attempts**, so retries may exceed the durable distinct visits and accepted
selections. The report marks missing Redis hours, unbalanced attempt/outcome
hours, and any observed shortfall against durable Admin rows. A zero-counter
hour is not inferred from a missing Redis hash. The global Watch counters are
diagnostic and cannot substitute for these scoped counters.

Server counters alone leave client/network loss **unobservable**: a browser
that never reaches Web, or a lost Web response after an Admin commit, cannot
be proved absent by either server store. The final verifier accepts one
independently signed calibration per frozen experiment. It binds the exact
experiment, generation, configuration, policy digest, cohort, and late cutoff;
the configured source and measurement method; complete initiated/reached-Web
delivery and click counts; an upper transport loss bound; and a passed
drop/retry probe. Both the independent source and Web's experiment counters
must count request attempts, including each retry, over the same cohort and
late horizon. A verified excluded or not-eligible request stays in its known
outcome bucket; a response-less upstream failure, missing scoped attribution,
or failed response cannot be silently treated as a successful request.
The owner must declare `maximumEndToEndLossRate` numerically in the live policy
before preparation. There is no default or approved value in this repository.

The attestor signs one bit per UTC hour from cohort start through the late
cutoff, least-significant bit first, asserting zero experiment traffic only for
set bits. A missing scoped Redis hash is covered only by a matching signed
zero-traffic bit. A missing hour without that independent proof stays unknown.
Global Watch hashes can have unrelated failures or gaps; they remain visible
diagnostics and cannot override complete, independently qualified cohort
evidence. The signed bound plus reached-Web requests absent from scoped
counters and scoped failed responses forms the reconciled upper loss bound. If
scoped counts exceed the independent reached-Web census, the sources conflict
and cannot qualify. A reconciled bound above the agreed limit or incomplete
scoped evidence leaves the result inconclusive; an invalid signature cannot
create a receipt.
Reading a result, attesting, and evaluating never change serving; promotion
remains an exact manual action.

After the fixed late cutoff, submit the compact Ed25519 JWS through the
recent-session, same-origin Admin operator route with
`{"action":"attest_final_calibration","assertion":"<signed JWS>"}`. The JWS
header uses `alg: EdDSA`, `typ: precomputed-calibration+jws`, and a configured
`kid`; the signed payload uses `precomputed-final-calibration-v1`. The Admin
environment keyring `PRECOMPUTED_FINAL_CALIBRATION_PUBLIC_KEYS` maps each key ID
to its independently approved `sourceId`, `boundMethod`, and public key. Admin
never receives the private key. The assertion must be under 8 KiB and observed
within 15 minutes of submission. Only one immutable receipt is stored, and it
expires with the experiment; raw viewer events are not copied into Admin.
Evaluate **after** submission. Without a valid receipt, final evaluation
returns `final_calibration_pending` without consuming the immutable final
revision; after final evaluation, late receipt submission is rejected.

No independent production attestor, approved bound method, public key, source
collection, or owner loss limit has been selected or provisioned here. Those
external decisions and actual observations are still required before a real
cohort can qualify. The verifier will not accept operator-entered counters or
a fixture signature as production authority.

## Launch evidence versus final certification

The [public-control runbook](precomputed-public-control.md) describes baseline
start, verification configuration, timing and the proposed numeric policy.
Baseline qualification is separate from the independent final attestation:

| Stage              | Required evidence                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline start     | Deployed production Admin/Web human-verification path, incumbent routing and explicit recent-session operator action. Begin at the next UTC hour.                                                                                                                                                         |
| Live prepare/start | Final unstopped qualified baseline after 168 hours plus 24 late-click hours and five-minute grace; complete matching Web baseline counters; exact observed baseline CTR and agreed policy; complete real catalog and fresh launch capacity. A winner report or final calibration receipt is not required. |
| Final evaluation   | One independent signed receipt covering cohort start through `endsAt + lateEventCutoffHours`, including every retry and quiet-hour proof, reconciled with scoped Web counters and durable Admin evidence. Missing receipt returns `final_calibration_pending` and reserves finality.                      |
| Promotion          | Separately authorized manual action identifying the exact experiment, generation, immutable final revision and evidence digest; inconclusive results cannot promote.                                                                                                                                      |

Although no final keyring or receipt is checked at launch, the independent
collector must be operational from cohort start to make its complete-horizon
claim possible. Choose a source that observes initiation separately from Web
receipt, including requests lost before Web; a second reading of Admin or Redis
is not independent evidence. A key and a successful synthetic probe alone do
not establish live coverage. An edge collector alone also needs an approved
conservative treatment of browser-to-edge losses. Keep the private signing
key outside Admin and Web; provision only its approved public key/source/method
binding to Admin through the normal authorized configuration path.

At the late cutoff, the attestor must produce an assertion binding
`experimentId`, `generationId`, `configurationDigest`, `policyDigest`,
`startsAt`, `endsAt`, `finalAt`, `sourceId` and `sourceRunId`. Its
`collectionMode` is `independent_initiation_and_web_receipt_v1`, `authority`
is `independent_browser_edge`, `coverage` is `complete`, and `dropRetryProbe`
is `passed`. Delivery and click initiation counts must each be positive;
reached-Web counts are nonnegative and cannot exceed initiated counts. Include
the conservative `lossUpperBoundRate`, the approved `boundMethod`, and canonical
`quietHourBits` for every UTC hour through the late cutoff. The verifier checks
the signed bound against the observed transport shortfall; reconciliation adds
reached-Web attribution gaps and scoped failed responses before comparing the
agreed loss limit. Those are attempts, not unique visitors or clicked visits.

Submit within 15 minutes of the signed `observedAt`, after the full late cutoff
and before saving a final report. Failure to gather the independent evidence
does not extend the experiment: new admissions still stop at the frozen
calendar-month end and serving returns to the incumbent. Preserve pending or
inconclusive status rather than fabricate a winner.

## Existing independent telemetry feasibility

The October 13 production inventory confirms Web has Datadog RUM application
and client-token configuration plus an ingestion API key. A RUM query/application
key was not found in the inspected runtime; read access, retention filters and
actual collection completeness remain unverified. The current
`apps/web/src/components/DatadogRum.tsx` initializes `sessionSampleRate: 50`
and `trackResources: true`. Recommendation delivery/selection code has no
independent experiment-bound initiation census or attestor signing path.
[Datadog sampling](https://docs.datadoghq.com/real_user_monitoring/guide/sampling-browser-plans/)
and resource diagnostics can help investigate loss, but multiplying sampled
counts cannot establish the contract's complete attempt census, signed quiet
hours or a one-percent conservative bound. Raising sampling alone would not
prove delivery of the independent telemetry or add the missing frozen identity.

[Cloudflare HTTP logs](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/)
expose request path, method and edge/origin response outcomes. They could help
reconcile edge-to-Web failures if an existing complete, unsampled source and its
delivery health are verified. Account/zone access, Logpush availability,
sampling, configured fields, destination retention and observed drop/retry
behavior are presently unknown. The existing delivery endpoint carries no
experiment identity in its URL, and private capabilities/tickets in POST bodies
must not be copied into external logs. Unattributed requests cannot silently
be assigned to the cohort. Requests lost before reaching Cloudflare remain an
additional blind spot.

Neither inspected telemetry path presently satisfies the signed contract.
Before requesting a new attestor, inspect authorized Datadog read access and
Cloudflare logging configuration for an existing independently scoped source.
Any proposed source still needs complete initiation/receipt counts, frozen
identity, collection-health evidence, conservative treatment of pre-edge loss,
quiet-hour proof and the drop/retry probe. This audit does not require a new
analytics database or authorize an instrumentation rewrite; keep those unknowns
explicit until a bounded collection method is reviewed.

Ordinary retention archives each expired raw visit exactly once into compact
per-browser clusters and per-arm totals, keeping a UUID marker to reject
replayed visit IDs. The request retains a small private provenance marker
after its thin visit link expires, so a late private event cannot silently
become ordinary public evidence. Accepted receipt times and delivery summary
writes are clipped at the declared late-event cutoff. These compact rows are
deleted with the experiment at its configured retention horizon.

## Playback engagement alongside CTR

New report revisions include the optional `engagement` block, version
`observed-active-watch-v1`. Admin shows it on the public control page and the
saved/private report page; the authenticated JSON reader returns the same data.
Save a fresh revision to include retained playback from an existing cohort. This
does not restart assignment, regenerate a catalog, or change the frozen CTR rule.
The ordinary public A/B launched through `start_ab` is an observed comparison;
the stricter certification sections above apply to the separate qualified path.

| Measure                                      | Numerator                                                                                  | Denominator                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Visit CTR                                    | Eligible visits with at least one accepted recommendation selection                        | All eligible visits                      |
| Engaged-view rate                            | Eligible visits with at least one recommendation-attributed qualified active-watch outcome | All eligible visits                      |
| Active watch minutes per 100 eligible visits | Observed active playback milliseconds / 60,000 × 100                                       | All eligible visits                      |
| Click-to-playback capture                    | Claimed recommendation playback episodes                                                   | Accepted selections                      |
| Active-time capture                          | Claimed episodes with complete or partial active-time evidence                             | Claimed recommendation playback episodes |

A qualified view uses the existing `active-watch-proxy-v1` rule: at least 30
seconds of foreground playing time **or** 25% of known duration. Hidden time,
pauses, and seeking are not active watch time. Empty and failed deliveries remain
in the visit denominator. Each visit counts once for engaged-view rate; distinct
claimed episodes contribute their observed active time. The report uses exact
visit → request → accepted selection → claimed episode lineage and the latest
outcome revision published by the report cutoff. Unattributed/direct playback,
conflicted episodes, and mismatched generations do not contribute engagement.

Read coverage before comparing variants. Outcomes are asynchronous: pending
claims can mature in later revisions. Complete/partial capture, absent outcomes,
missing active-time evidence, invalid episodes, and pending episodes are shown
separately; pending is an overlapping diagnostic, not an additional total.
Partial capture contributes an observed lower bound. A click without a claim may
mean navigation was abandoned or capture failed. These counters do not prove
that all client/network events arrived.

Engaged-view uplift includes an approximate 95% browser-clustered interval using
the existing visit-ratio method. Active minutes are descriptive. Engagement is a
secondary observed comparison, not a replacement stopping policy or automatic
winner. Compare all three measures together once capture has matured in both arms.

The archive-before-delete transaction retains engagement totals and per-browser
engaged counts. Archives written before migration `0162` have zero
`engagement_measured_visits`, meaning unknown, not measured zero. Any unmeasured
archived visits withhold full-cohort engagement rates and intervals. Entirely
missing playback evidence after accepted clicks also yields unavailable rates;
a cohort with no accepted clicks has a known zero engagement numerator. Older
immutable report revisions remain readable with engagement unavailable.

Deploy verification: confirm `0162_precomputed_playback_engagement` is applied,
save one fresh revision for the running experiment, inspect all three measures
and capture details, and confirm the serving pointer/version and cohort dates
are unchanged. Rolling back application code may leave these additive columns
in place; do not delete existing immutable report revisions.
