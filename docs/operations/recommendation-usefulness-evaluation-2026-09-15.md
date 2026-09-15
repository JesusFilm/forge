# Profile recommendation usefulness comparison

Protocol: `recommendation-usefulness-offline-v1`. Preparation for `feat-505`;
the older local draft used `feat-472`, which now belongs to a different ticket.
Code inspected: `origin/main` at `3cc4017af`, September 15, 2026.
Status: **prepared, awaiting routed A/A and a reconciled experiment snapshot**.
This document and the offline CLI do not activate an experiment or certify uplift.

## What the evidence supports

The September 15 production profile audit found 5,380 personalized below-player
requests across 855 profiles in seven days. Personalized matched CTR was 5.32%
versus 2.72% for contextual delivery; personalized rows generated 35 qualified
views. The groups have different viewing histories and were not randomized.
The separate For you feed had 13 profile-backed requests across nine profiles,
two selections and no recorded starts. That cohort cannot establish usefulness.

The audit was a live read-only extraction at 02:03:52 UTC; its behavioral window
ended at 01:45 UTC. These figures describe that extraction, not a new database
read performed while writing this protocol. Source artifact:
`docs/reports/2026-09-15-profile-recommendations/report.md` in the analysis checkout.

Immediate exit means **an ambiguous observation**. It can indicate a wrong
selection, previewing, interruption, technical trouble, or content mismatch.
Do not count it as a like, proven dislike, satisfaction, or a primary success
metric. Keep any exit observation classifier and profile policy identical in
both experiment arms and record their versions. A policy change during the
experiment requires a new version; it must not silently change the treatment.

## Bounded comparison

| Contract        | Version 1 decision                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface         | Web `watch-below-player-v1`; For you remains a separate evaluation                                                                           |
| Cohort          | Human-classified English requests with a current, eligible durable profile and compatible published projection, identified before assignment |
| Unit            | Existing `anonymous_profile` experiment unit: profile identity plus privacy generation, experiment-scoped digest                             |
| Allocation      | Sticky 50/50, same unit throughout the experiment generation                                                                                 |
| Control         | `semantic-transcript-pgvector-v1`, with direct profile retrieval explicitly bypassed inside the enrolled control arm                         |
| Challenger      | Exact `semantic-profile-hybrid-v1` manifest and recorded generator/composition versions                                                      |
| Shared behavior | Same language, watchability, repeat/history policy, feedback policy, collector, card count, deadlines and curated fallback behavior          |
| Enrollment      | Fixed UTC start/end, at most 14 days; no enrollment after end                                                                                |
| Follow-up       | Requests, selections and claimed episodes in each unit's first 24 hours after assignment                                                     |
| Outcome capture | Wait another six hours for the last episode's hard fact horizon, then verify finalization/classification completion                          |
| Outside cohort  | Existing ordinary direct-profile/contextual behavior                                                                                         |

English is a supported cohort restriction, not evidence that all English
content is embeddable. Check the actual current content contract and projection
before assignment. Missing compatible content prevents enrollment; record its
aggregate exclusion count. This comparison does not depend on expanding locale
or source coverage from the excluded ticket.

Do not use the operational request/session digest as a substitute assignment
unit. `experiment/assignment.ts` already supports profile identities, sticky
allocation and privacy-generation fencing. Product policy requires no separate
consent prompt: `docs/analytics-and-recommendation-policy.md` governs enablement.
Preserve explicit disable, reset, deletion and retention behavior.

## Remaining routing and evaluation seams

1. `apps/admin/src/services/recommendations/delivery.service.ts` starts
   `experimentPromise` with an explicit `profileTokenDigest != null` bypass.
   Its `resolveExperiment` method remains available through the injected
   `assignExperiment` dependency. A future routing change must resolve the
   declared cohort before this bypass, preserve ordinary delivery outside the
   experiment, and prevent a control assignment from re-entering direct profile
   retrieval. Enrollment cannot depend on successful card retrieval or exposure.
2. `experiment/assignment.ts` accepts an exact semantic A/A or hybrid experiment.
   The hybrid path requires the current exact shadow decision and bounded
   promotion approval. Its semantic A/A uses a session unit, so that existing
   A/A alone does **not** reconcile this profile-unit cohort. Prepare a
   behaviorally equivalent, profile-unit A/A route with the same cohort,
   fallback and exposure path before A/B.
3. Persist assignment even when no cards are returned. Propagate the selected
   assignment through `delivery-issuance.ts`, request attribution and accepted
   eligible impressions. Preserve sticky allocation across navigation/reloads;
   never assign based on whether an impression eventually arrives.
4. Enrollment end and assignment expiry currently share experiment lifecycle
   bounds. The routing contract needs separate enrollment cutoff versus existing
   assignment follow-up: assignments remain usable through the last unit's
   24-hour follow-up. Do not truncate the last enrollees at enrollment end.
5. `experiment/evaluation.ts` and `experiment/policy.ts` are A/A-oriented. They
   count units with **any** qualified view, use Wilson intervals and an A/A
   guardrail pass. They do not implement this count-per-unit metric or fixed
   follow-up. The snapshot timestamp used as a watermark proves a consistent
   read, not finalization or late-fact completeness. Do not reinterpret an
   existing `pass` row as this protocol's `improve` result.

These are activation prerequisites. The delivered changes deliberately do not
alter production routing, create an experiment row or implement unrelated
pending roadmap prerequisites.

## Snapshot extraction contract

Run a repeatable-read, read-only transaction with bounded statement/lock
timeouts. Pin experiment id, generation, configuration digest, cohort, manifest,
classifier, eligibility and feedback versions in the extraction record.

1. Start with **all** assignments in the declared enrollment interval and exact
   generation. Retain zero-exposure, zero-card, fallback and zero-view units.
   Count fenced assignments separately; do not silently remove them to repair
   balance. Deletion must still erase its subject data. If erasure prevents
   reconciling the original denominator, return `data_unhealthy` and record
   aggregate attrition; do not recreate erased identity/history.
2. Join requests by `experiment_assignment_id`, then selections and episodes
   through the exact request/item/selection lineage. Limit request creation,
   selection occurrence and episode claim to `[assigned_at, assigned_at + 24h)`.
   Count only recommendation-origin episodes with valid attribution. Direct
   playback can train profiles but is not attributed primary viewing.
3. Choose the highest retained revision for **each episode and exactly
   `active-watch-proxy-v1`**, as of capture time. Select the latest revision
   before filtering for qualification. A later unqualified revision replaces an
   earlier qualified one; `legacy-position-v0` must not double-count the episode.
4. Require finalized/timed-out state, `hard_until <= captured_at`, and the latest
   outcome's experiment eligibility. Bound decision reads by the scoped outcome
   ids; do not scan every eligibility row. Reconcile missing outcomes, missing
   active coverage, conflicts and late revisions independently. An elapsed clock
   or an empty queue does not establish healthy collection.
5. Deduplicate visible impressions by item, selections by their persisted
   identity, and primary views by episode. Collapse all qualifying episodes to
   one integer count per assigned unit. Multiple qualified episodes from the
   same unit remain multiple views; uncertainty samples the whole unit.
6. Validate arm/configuration/manifest/probability against both requests and
   exposures, including requests with no exposure. Reconcile assignment counts
   independently before building the JSON. The CLI cannot reconstruct missing
   ledger rows or verify an operator's health booleans.

The primary estimand is the arm difference in qualified recommendation views
per assigned profile for episodes acquired in that 24-hour follow-up, including
their permitted late outcome facts. It is neither CTR nor satisfaction.
Secondary metrics: active minutes per assigned unit, units with a start, units
with a qualified view, matched item CTR and human shares. Do not select a winning
secondary result after seeing the data.

## Readiness, guardrails and stopping rule

All thresholds below are proposed protocol settings to freeze in the reviewed
configuration digest before enrollment, not claims that current traffic passes.

| Gate              | Required evidence                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile A/A       | At least 200 assigned units per arm, two full UTC days and a closed outcome window; exact request/exposure lineage and equivalent serving path; no outcome efficacy claim                    |
| Sample ratio      | 50/50 assignment chi-square <= 10.828 (one degree of freedom, diagnostic threshold p=0.001)                                                                                                  |
| Attribution       | Zero conflicting unit assignment, wrong-arm/version exposure, duplicate units or unresolved revision conflicts                                                                               |
| Outcome health    | Zero unresolved mature episodes; missing active coverage <=5% of claimed episodes, separately checked in both arms                                                                           |
| Collection        | Successful real browser selection-to-playback journey; accepted receipt and durable storage reconciliation; no unexplained delivery/collection outage                                        |
| Arm comparability | Missing active-coverage rate difference <=2 percentage points; claim receipt/attribution failure-rate difference <=2 points                                                                  |
| Delivery          | Challenger timeout/error rate no more than 1 point above control; card-return rate no more than 2 points below control; p95 latency increase <=200 ms and within the deployed service budget |
| Playback          | Fatal playback error rate no more than 1 point above control among claimed episodes; report per-assignment rate too                                                                          |
| Privacy/retention | Fencing/deletion applied; raw evidence wholly inside 29 days; successful retention and original denominator reconciliation                                                                   |

`collectionHealthy`, `guardrailsPassed`, `aaPassed`, `routingVerified` and
`retentionHealthy` must cite supporting records in a companion capture manifest.
Missing or unknown evidence means false. The CLI checks pooled active coverage
in addition to these required per-arm checks; its output is not their proof.

Fix enrollment dates, sample target and minimum useful delta before A/B. Monitor
health daily; stop exposure on an operational guardrail failure. Make one
efficacy decision after enrollment closes and every unit's follow-up matures.
Do not stop early for a favorable effect or extend enrollment because p-values
are disappointing. If the planned sample cannot be reached in 14 days, finish
as inconclusive and design a new version with a realistic effect size.

The CLI resamples assignments independently within each arm 2,000 times using
an input-derived deterministic seed and reports a percentile 95% interval.
It requires the prespecified sample target (at least 200 per arm) and at least
20 nonzero units per arm before calculating that interval. Sparse samples stay
inconclusive. Keep the arm's heavy viewers together; do not bootstrap clicks.
This is an approximate interval, not a sequential test or permission to peek.

- `improve`: the interval lies above the prespecified minimum useful delta and
  health/operational gates pass.
- `no_benefit`: the interval rules out that useful delta, or an operational
  guardrail fails. Inspect the reason code; a guardrail failure does not prove
  zero causal viewing effect. This means the treatment should not be adopted
  under this protocol.
- `inconclusive`: insufficient sample/events or an interval crossing the useful
  delta. A/A health passing alone does not establish benefit.
- `data_unhealthy`: broken/unknown measurement, immaturity, retention,
  contamination, fencing or denominator reconciliation; do not interpret uplift.

Late valid revisions require a new output and input digest, with a supersedes
reference in the capture manifest; retain previous aggregate results. Never
rewrite a result to hide a reversal.

### Sample-size assumptions

Use the profile A/A's per-unit count variance, not request counts or CTR, for
power planning. A two-arm normal approximation is
`n_per_arm = 2 * (1.959964 + 0.841621)^2 * variance / effect_gap^2` for
two-sided 5% error and approximately 80% power. This extends the
[NIST mean-shift calculation](https://www.itl.nist.gov/div898/handbook/prc/section2/prc222.htm)
to two independent arms; count overdispersion increases the required sample.

Illustration only: variance 0.03, minimum useful delta 0.006 views/profile and
true expected delta 0.012 give effect gap 0.006 and **13,082 profiles per arm**.
The CLI's adoption rule requires the lower interval bound above 0.006, so power
must use the gap between the expected effect and this adoption margin, not the
margin alone. None of these assumed values is a production estimate.

The observed 855 personalized profiles/week cannot support 26,164 distinct
eligible profiles within two weeks at that traffic level. Returning profiles
also overlap across weeks. Do not promise a conclusive small-effect experiment
until A/A measures eligible enrollment and variance. Freeze a feasible sample
and meaningful effect before A/B, or retain the honest inconclusive outcome.

## Run the read-only inventory

From the repo root, with a provisioned read-only database credential in the
environment (never commit or print it):

```bash
psql -X --set=ON_ERROR_STOP=1 \
  --file=apps/admin/src/services/recommendations/experiment/usefulness-readiness.sql \
  "$READ_ONLY_DATABASE_URL"
```

This returns experiment configuration/assignment aggregates and a bounded
24-hour request/impression/exposure inventory. It prints no viewer identifiers,
raw histories or vectors. Zero assignment rows are normal for ordinary direct
profiles and mean there is no experiment result to evaluate. The inventory is
not the extractor for the outcome snapshot and does not certify readiness.

## Run the offline evaluator

The CLI requires Node 24 (native TypeScript stripping); no package installation
or database connection is needed. Store the minimized snapshot outside the repo
with restricted access because its experiment-scoped unit digests are still
pseudonymous identifiers. Export only the aggregate result.

```bash
node apps/admin/src/services/recommendations/experiment/usefulness-offline.ts \
  /secure/experiment-snapshot.json > /secure/experiment-result.json
```

Exit codes: 0 valid evaluated input (inspect `decision`), 1 invalid input/usage,
2 `data_unhealthy`. The CLI never creates database evaluations or changes
assignment/promotion/routing. Its output includes a SHA-256 input digest,
aggregate arm counts/means, uncertainty and reason codes, without unit digests.

Actual input schema/example below. This empty, **synthetic** example exits 2;
it is not real evidence and cannot pass preparation gates:

```json
{
  "schemaVersion": "recommendation-usefulness-offline-v1",
  "experimentId": "synthetic-example-only",
  "configurationDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "enrollmentStart": "2026-09-01T00:00:00Z",
  "enrollmentEnd": "2026-09-02T00:00:00Z",
  "capturedAt": "2026-09-03T06:00:00Z",
  "plannedAssignmentsPerArm": 13082,
  "minimumUsefulDelta": 0.006,
  "health": {
    "assignmentLedgerCount": 0,
    "claimedEpisodes": 0,
    "missingActiveEpisodes": 0,
    "unresolvedEpisodes": 0,
    "contaminatedAssignments": 0,
    "fencedAssignments": 0,
    "conflictingOutcomes": 0,
    "aaPassed": false,
    "routingVerified": false,
    "retentionHealthy": false,
    "collectionHealthy": false,
    "guardrailsPassed": false
  },
  "units": []
}
```

Each real `units` entry must have `unitDigest` (64 lowercase hexadecimal chars
from the persisted **profile** assignment), `unitKind: "anonymous_profile"`,
`arm: "control" | "challenger"`, ISO `assignedAt` inside the enrollment window,
and nonnegative integer `qualifiedViews`, including zero. All health counts are
nonnegative integers. Include every assigned unit once; do not use the exposed
subset. A capture manifest must record immutable experiment generation,
configuration digest, source/extraction checksums, classifier/eligibility
versions, guardrail evidence and any superseded result.

## Validation and completion boundary

Run the focused suite from `apps/admin`:

```bash
pnpm exec vitest run src/services/recommendations/experiment/usefulness-offline.test.ts
```

The tests exercise zero-view denominators, repeated views, duplicate units,
missing assignments, full maturation/retention, SRM, collector gaps, privacy
fencing, sparse samples, meaningful-effect decisions, session-identity refusal
and the real native-Node CLI. They use synthetic data.

Preparation is complete when these artifacts are reviewable. The usefulness
experiment ticket remains in progress until the routed profile A/A, frozen
protocol, actual assigned cohort, mature snapshot and versioned result exist.
Do not close it because this CLI or the historical A/A service passes tests.
