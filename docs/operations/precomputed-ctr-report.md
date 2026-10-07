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

Ordinary retention archives each expired raw visit exactly once into compact
per-browser clusters and per-arm totals, keeping a UUID marker to reject
replayed visit IDs. The request retains a small private provenance marker
after its thin visit link expires, so a late private event cannot silently
become ordinary public evidence. Accepted receipt times and delivery summary
writes are clipped at the declared late-event cutoff. These compact rows are
deleted with the experiment at its configured retention horizon.
