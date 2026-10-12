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
a verified origin, stop; the protocol-4 runner cannot create one.

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
use a measured source sample for the projection. The runner rejects a mismatch
with Admin's database bytes/cluster ID or an observation older than 25 minutes
and refreshes capacity during a long run. Admin imposes its own 30-minute
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

## Start, inspect and resume

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
