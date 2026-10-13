# Private precomputed catalog build

The current first-build path is the **protocol-4 manual subscription runner**,
`precomputed:subscription:run-manual`. It runs on the initiating operator's
computer through that person's signed-in Codex subscription and writes a private
generation to the Admin selected by its authenticated catalog and ingest URLs.
It uses `gpt-6-astra`; it has no paid model API fallback. Starting, resuming,
refreshing and deciding when to run again are separate manual actions. A build
never starts from a schedule, deployment, new content, page view or allowance
reset. Completion does not activate Watch delivery; the incumbent remains the
default until a separate [public-control decision](precomputed-public-control.md).

Local fixtures and pilot results establish protocol behavior and observed usage
only. They are not a complete catalog, a full-run allowance forecast, a dollar
bill, or evidence of production readiness. Subscription calls consume included
allowance; do not label that consumption as a $0 API bill or infer a refresh
cadence from a small pilot.

The local config accepts an optional top-level `concurrency` integer from 1 to
12; omission preserves serial execution. It bounds independent video profiles
and source-pair recommendation batches as well as simultaneous Codex calls.
Maps and reductions within one profile, and pages within one source, remain
ordered. The model, prompts, evidence, output limits and generation digest do
not change. More concurrency can reduce elapsed time but does not reduce total
allowance usage or promise a proportional speedup.

Keep one runner and one active attempt for a generation. Do not launch several
copies of the command to add concurrency. Each call still obtains fresh account,
allowance and durable reservation admission. A failed task stops new work;
already-dispatched calls drain and save their receipts before the attempt closes.
Capacity refreshes and lease heartbeats are shared within the runner.

For the updated CLI, send `SIGINT` or `SIGTERM` to the actual runner Node process
to request a graceful pause. Wait for its `operator_paused` terminal result and
reconcile receipts before resuming with a new attempt. The signal does not kill
active model calls; those retain their existing timeout and usage handling.
Recovery and explicit manual profile replacement remain concurrency 1. Review
physical overlap and observe throughput at the chosen concurrency before using
it to forecast a completion time. Earlier CLI versions do not have this signal
handler and must not be stopped using this procedure.

## Prepare a protocol-4 run

Use the target Admin's read-only catalog to review **every** eligible source at
one fixed UTC `inputCutoff`. Supply its strictly sorted `sourceVideoIds`,
`sourceSetDigest`, `selectedCorpusDigest` and `candidatePoolDigest`. The runner
re-reads the catalog, builds the candidate retrieval and recomputes those
digests before accepting the run. Its `manualGenerationInputDigest` also binds
the cutoff, complete selected content, retrieval digests, exact model, prompt
and schema versions, and GA import policy. Do not substitute hand-guessed
digests or change the source set after starting a generation. Setting
`work.mode` to `"full"` processes the complete frozen source set. `"pilot"`
requires `sources` entries with a `sourceVideoId` and `exclusiveEndRank`; it
stops at those explicit boundaries and does not complete the generation.

Protocol 4 **imports an existing sealed GA aggregate capture**. The named
`originGenerationId` must be visible and verifiable in the **same Admin
database and private object store** as the new destination. The origin and
destination must agree on the source set, cutoff, selected corpus, route
mapping, source-pattern table, query specification, GA property and time zone,
and requested/usable coverage. The destination's qualification policy is
`referrer_navigation_v1`. The runner probes the origin, prepares the new
generation, copies and binds the capture, and reads historical Watch aggregates
from that immutable artifact. It does not make new GA API queries or accept a
local-origin capture through a production Admin URL. If the target Admin lacks
a verified origin, provision it with the explicit capture-only procedure below;
the protocol-4 runner cannot create one.

The compressed GA capture is stored outside PostgreSQL in Admin's private
object store (`RAILWAY_S3_*` in the deployed setup). The operator needs local
`stagingDirectory` space to read the imported capture. PostgreSQL holds the
generation, compact content profiles, edge decisions, choices and bounded
physical-call/usage provenance. Measure object-store, staging, backup and
PGDATA headroom separately. A missing or corrupt capture fails closed.

Run the read-only local account check before preparing an invocation:

```bash
pnpm --dir apps/mastra run precomputed:subscription:check
```

It reports the current account reference, exact model route, billing basis and
allowance admission without making a model call. The runner then checks the
same initiating account and fresh identity/allowance again before inference;
each reserved call also requires a fresh observation. Admission requires
included-subscription billing, **more than 25% weekly allowance remaining**
and, when a five-hour limit applies, **more than 25% of that window remaining**.
Unknown, credit-only or insufficient allowance stops the run. Keep the
operator's Codex login on their local computer; a browser Admin session or a
shared service login is not authority to use it. Do not copy login material or
the Admin ingest bearer into the JSON config.

Obtain fresh physical capacity evidence for the **target** Admin database.
Admin's `capacity_probe` returns its observed database bytes and PostgreSQL
cluster identifier. The configured local `capacityProbe.executable` receives
that probe as a final JSON argument and must return JSON containing
`measuredAt`, `clusterSystemId`, `observedDbBytes`, `availableBytes`,
`reserveBytes`, `projectedBytes`, `sampleSourceCount`, `sampleBytes` and
`source: "operator_verified_pgdata_df"`. Measure `availableBytes` on the
PostgreSQL **PGDATA volume**, not the Admin, Mastra or operator filesystem;
use a measured source sample for the projection. The runner requires the same
cluster ID, rejects a lower physical database byte count than the preceding
Admin probe or an observation older than 25 minutes, and refreshes capacity
during a long run. Contemporaneous nonnegative growth preserves the actual
physical measurement; Admin applies its existing size-consistency check and
accounts for subsequent growth and overlapping reservations before admission.
Admin imposes its own 30-minute
attestation bound and a minimum 5 GB reserve; that floor is not a measured
total headroom budget. Neither process can derive PGDATA free bytes from the
database-size query alone. Do not invent a capacity value.
The runner supplies the probe request but does not bundle a physical-volume
measurement executable; verify the configured executable before starting.

Write a private JSON config matching
[`run-manual-subscription-catalog.ts`](../../apps/mastra/src/scripts/run-manual-subscription-catalog.ts)
and [`gaImportDestinationSchema`](../../apps/mastra/src/services/precomputed-recommendations/ga-capture-import-client.ts).
This is a **shape example only**: every placeholder needs an observed value,
and the file is not executable as shown.

```json
{
  "input": {
    "invocation": "start",
    "generationId": "<new-generation-id>",
    "generationInputDigest": "<64-hex-derived-generation-digest>",
    "attemptId": "<new-uuid>",
    "inputCutoff": "<UTC-ISO-timestamp>",
    "initiatingAccountRef": "<account-reference-from-local-check>",
    "reviewed": {
      "sourceVideoIds": ["<first-sorted-source-id>", "<next-sorted-source-id>"],
      "sourceSetDigest": "<64-hex-reviewed-source-set-digest>",
      "selectedCorpusDigest": "<64-hex-selected-corpus-digest>",
      "candidatePoolDigest": "<64-hex-candidate-pool-digest>"
    },
    "destination": {
      "generationId": "<same-new-generation-id>",
      "generationInputDigest": "<same-generation-input-digest>",
      "sourceSetDigest": "<same-source-set-digest>",
      "inputCutoff": "<same-UTC-ISO-timestamp>",
      "selectedCorpusDigest": "<same-selected-corpus-digest>",
      "candidatePoolDigest": "<same-candidate-pool-digest>",
      "routeMappingDigest": "<64-hex-origin-route-mapping-digest>",
      "sourcePatternTableDigest": "<64-hex-origin-source-pattern-table-digest>",
      "querySpecDigest": "<64-hex-origin-query-spec-digest>",
      "propertyId": "320198532",
      "propertyTimeZone": "America/New_York",
      "qualificationPolicy": "referrer_navigation_v1",
      "requestedStart": "<YYYY-MM-DD>",
      "requestedEnd": "<YYYY-MM-DD>",
      "usableStart": "<YYYY-MM-DD>",
      "usableEnd": "<YYYY-MM-DD>",
      "requestedCoverageDigest": "<64-hex-origin-requested-coverage-digest>",
      "usableCoverageDigest": "<64-hex-origin-usable-coverage-digest>"
    },
    "originGenerationId": "<sealed-origin-id-in-same-admin>",
    "work": { "mode": "full" }
  },
  "codexExecutable": "<absolute-path-to-local-codex-executable>",
  "stagingDirectory": "<absolute-path-to-existing-local-directory>",
  "capacityProbe": {
    "executable": "<absolute-path-to-reviewed-capacity-probe>",
    "args": []
  }
}
```

The script requires the Codex and capacity-probe executables to be files and
the staging directory to exist. It rejects CI and Railway execution. Supply
`ADMIN_RECOMMENDATION_CATALOG_URL`, `ADMIN_RECOMMENDATION_INGEST_URL` and the
dedicated `ADMIN_MASTRA_RECOMMENDATION_API_KEY` in the operator environment;
the runner sends that bearer only to the configured HTTPS Admin endpoints (or
permitted local/internal HTTP endpoints). Its strict config has no field for a
paid model API key or GA credentials.

## Provision a target GA origin without model calls

After the separately authorized deployment and production-write decision, run
`precomputed:ga:capture-origin` from the operator's local checkout. It uses the
existing protocol-3 two-pass GA capture, physical HTTP receipts, private upload,
header verification and historical qualification. Its fixed `captureOnly: true`
mode returns **before model construction or source claims**, with
`state: "incomplete"`, `gaOriginReady: true` and the verified `snapshotRef`.
No OpenRouter key or Codex model invocation is required. This is GA-origin
provisioning, not a completed recommendation generation.

Qualification accepts the existing `DATA_TRUNCATION_TYPE_PROPERTY` boundary or
one unambiguous `DATA_TRUNCATION_TYPE_DATE_RANGE` leading unavailable prefix.
For date-range truncation, every reported range must be the same singleton,
start at the original requested start, and end before the requested end. GA's
[start and end dates are inclusive](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData),
so an unavailable range of `2022-06-21` through `2022-08-10` produces a candidate
usable start of `2022-08-11`. The artifact records the exact raw singleton in
`sourceAvailability.dataTruncationDateRanges`, retains the original requested
range, and does not invent a scalar `truncationDate` for this case. Qualification
requeries the usable range and still rejects truncation, thresholding, sampling,
schema restrictions, other-row loss, or timezone mismatch. Gaps, nonprefix,
multiple ranges, conflicting or mixed evidence fail closed. The two complete
capture passes and destination verification remain required; this change does
not establish full-history support or automatically resume a failed capture.

The deployed target needs the catalog, ingest and GA-capture routes and their
migrations, private `RAILWAY_S3_*` storage, and a dedicated ingest bearer in
`MASTRA_RECOMMENDATION_INGEST_API_KEYS`. On the local operator machine, load that
same bearer as `ADMIN_MASTRA_RECOMMENDATION_API_KEY`, with:

```text
ADMIN_RECOMMENDATION_CATALOG_URL=https://admin.jesusfilm.org/api/internal/mastra/precomputed-catalog
ADMIN_RECOMMENDATION_INGEST_URL=https://admin.jesusfilm.org/api/internal/mastra/precomputed-recommendations
PRECOMPUTED_GA4_PROPERTY_ID=320198532
PRECOMPUTED_GA4_SERVICE_ACCOUNT_EMAIL=watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com
```

The GA-capture URL is derived from the ingest URL's origin. Authenticate GA with
the approved local ADC impersonation path or privately loaded approved
`PRECOMPUTED_GA4_CREDENTIALS_JSON`; neither belongs in the command config. Existing
GA variables on hosted Mastra do not configure the local command. CI/Railway
execution and additional config fields are refused. There is no scheduled or
hosted capture endpoint; the old hosted catalog route remains blocked.

Prepare a private file with this shape; replace the capacity placeholder with
the exact fresh measurement object documented above:

```json
{
  "input": {
    "generationId": "<new-target-origin-id>",
    "inputCutoff": "<fixed-UTC-ISO-timestamp-for-origin-and-destination>",
    "capacity": "<fresh-measured-capacity-object>"
  },
  "stagingDirectory": "<absolute-existing-private-local-directory>"
}
```

This example is not executable. The complete catalog and selected corpus are
read from the target Admin and hashed by the producer; no local origin or
hand-guessed identity is accepted. Review the intended target/cutoff first, then
invoke explicitly:

```bash
pnpm --dir apps/mastra run precomputed:ga:capture-origin \
  --config /absolute/private/path/ga-origin.json --execute
```

For an interrupted capture, inspect pending GA receipts and retained staging,
then explicitly invoke the **same** origin ID, cutoff and staging directory with
fresh capacity. The existing journal resumes saved pages and verification;
unsettled recent HTTP reservations fail closed. A sealed-origin invocation
downloads and re-verifies the immutable artifact without new GA queries.
Capture-only never completes sources. Inspect Admin's build report for pending
sources, zero model calls and reconciled history calls, and verify the origin
with `ga_import_origin_probe` before preparing the subscription destination.
Keep `captureOnly` on every origin invocation; do not continue that protocol-3
origin as a paid catalog build. Use a distinct protocol-4 generation ID and the
same frozen cutoff/corpus for subscription inference. Catalog changes after
the cutoff can invalidate resumption/import and require a separately reviewed
new origin; do not silently refreeze it.

Protocol-4 import also requires explicit target Admin
`GA_CAPTURE_IMPORT_OBJECT_BUDGET_BYTES`, `GA_CAPTURE_IMPORT_TEMP_BUDGET_BYTES`
and `GA_CAPTURE_IMPORT_TEMP_RESERVE_BYTES`. These are separate from PGDATA
admission. Measure the target Admin's temporary filesystem, existing object
inventory and planned origin/destination overlap before choosing them. The
import charges a destination artifact copy against the retained object budget
and twice its compressed artifact bytes against temporary reservations. A
configured S3 bucket alone does not establish those budgets.

Verify import preparation with the deployed environment path, including
`CI=true` where present. Admin's environment-validation bypass can leave
configured numeric values as strings; the import boundary normalizes them before
enforcing safe-integer and range checks. Raw environment hashes alone do not
prove import readiness. Missing, empty, invalid or unsafe values still stop
preparation, and object/temporary exhaustion checks retain the configured limits.

## Start, inspect and resume

A first production sample can use the existing `pilot` work mode on the same
complete frozen manifest intended for the full build. Select one or two
reviewed source IDs and set each `exclusiveEndRank` to its **entire frozen
candidate-pool length**, derived from `buildCandidateRetrieval`, rather than a
short early page. The runner processes their complete selected profiles and
candidate pages and can finalize those sources while leaving the generation
incomplete. It reports `pilot_boundary`; whole-generation completion remains
exclusive to `full` mode. The earlier short-boundary pilots finalized zero
sources because they did not cover those full pools.

For initial admission, use a reviewed measured native source sample with an
explicit conservative projection and fresh target PGDATA. The contract does
not require a finalized protocol-4 source before any inference. A historical or
provisional sample must retain its schema/completeness qualifications; it is not
proof of full-catalog peak growth. After the authorized bounded sample, reconcile
every physical call and measure finalized-source, reusable-profile, batch,
checkpoint, WAL and retained storage growth. Review the full-run overlap
scenario, then explicitly resume the **same** generation with `work.mode: "full"`,
unchanged frozen identities and a new execution attempt. Preserve partial
checkpoints if allowance or capacity stops the sample; do not dispatch unknown
usage again. This sequence creates the first completed-source capacity evidence
without requiring an unsupported local-to-production transfer or a new build
mode.

Only after reviewing the target, config, allowance and capacity, invoke the
runner explicitly:

```bash
pnpm --dir apps/mastra run precomputed:subscription:run-manual \
  --config /absolute/private/path/catalog-build.json --execute
```

`start` opens a protocol-4 generation and a distinct execution attempt; the
runner records profile and shared edge calls, their observed token usage and
bounded operator provenance in Admin. In `full` mode it sends `complete` only
after all sources finalize, then closes its attempt. Inspect the command's
`state`, `reason`, `completedSourceCount`, `processedPageCount` and `knownUsage`,
and the private Admin report at
`/dashboard/recommendations/precomputed?generation=<id>`. Distinguish complete
sources with edges, valid empty sources, failed sources and unresolved usage.
Subscription allowance consumption is not a provider-reported USD charge.

A stopped process does **not** automatically restart. An operator may explicitly
resume the **same** generation with `invocation: "resume"`, its unchanged cutoff,
digests, reviewed catalog and GA destination, and a **new** `attemptId`, after
the prior process has exited and no live source lease remains. Choose the next
pilot boundaries or `work.mode: "full"` explicitly; changing the work scope does
not change the frozen generation identity. Recheck the local account/allowance,
Admin state, pending call receipts and
physical capacity first. Completed checkpoints are reused; do not silently
redispatch a call with unknown consumption. A deterministic invalid output or
changed catalog identity can make the generation unfinishable; diagnose that
failure before starting a new generation. A later refresh uses a new generation
ID, cutoff and reviewed source set and remains a separate manual decision.

## Production and legacy boundary

The Admin ingest and Watch reader use the database of the Admin endpoint they
receive. There is **no authenticated export/import of a complete protocol-4
generation** across Admin databases: the `ga_import_*` actions transfer only a
sealed GA capture before source or model work. A completed generation in a
restored local Admin database can be reviewed locally but cannot be served by
production Admin. Do not use a raw database restore/copy as a release path.
Without a separately implemented and verified whole-generation transfer, a
production catalog requires its own manual inference run targeting the
**deployed production Admin** and an origin capture verified there. A full local
run would otherwise have to be repeated for production.

Production code must first pass the normal PR-to-main merge and deployment
path, with explicit owner authorization for those steps; do not publish a local
worktree with `railway up` or a direct redeploy. A production build/write is a
separate authorized action. It does not start an A/B test or replace the
incumbent. Public preparation, live-readiness checks and activation remain
separate manual controls.

The older `POST /forge-precomputed-catalog-generation` Mastra route describes
the **legacy protocol-3/OpenRouter** build, which captures GA aggregates in two
matching paginated passes and seals an external artifact. Older generations
retain their original protocol and qualification. That route and a paid
OpenRouter key are **not** fallback paths for the subscription runner or this
first protocol-4 build. Do not add a snapshot mode to an existing generation or
carry its model decisions into a new qualification.
