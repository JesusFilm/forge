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

The report separately labels client/network loss **unobservable**: a browser
that never reaches Web, or a lost Web response after an Admin commit, cannot
be proved absent by either server store. A scoped result of “no observed
shortfall” is not a verified loss rate or a live winner. To qualify a live
result later, collect an independent production browser/edge calibration of
initiated Watch delivery and click attempts against the same frozen cohort and
hour range, include deliberately dropped/retried requests, record its measured
loss and uncertainty, and obtain the owner's numeric acceptable-loss limit
before versioning an immutable qualification receipt. Do not use a fixture or
global counter surplus to fill a scoped or client-side gap. Until that receipt
is implemented and reviewed, final live reports remain inconclusive and
manual promotion stays closed.

Ordinary retention archives each expired raw visit exactly once into compact
per-browser clusters and per-arm totals, keeping a UUID marker to reject
replayed visit IDs. The request retains a small private provenance marker
after its thin visit link expires, so a late private event cannot silently
become ordinary public evidence. Accepted receipt times and delivery summary
writes are clipped at the declared late-event cutoff. These compact rows are
deleted with the experiment at its configured retention horizon.
