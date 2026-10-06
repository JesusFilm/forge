# Private precomputed catalog build

`POST /forge-precomputed-catalog-generation` on Mastra is the authenticated
entry point for the first build and later manual refreshes. It starts a private
GPT-6 Astra generation and resumes the same generation after an interruption.
There is no recurring schedule and completion does not activate Watch delivery.
The current recommendation system remains available while a build is incomplete
or failed.

The local and database fixtures prove protocol behavior only. They are not an
actual catalog build, a measured dollar budget, or evidence that every source
has recommendations. An actual first run requires an authorized paid OpenRouter
key for `openai/gpt-6-astra`, `ADMIN_RECOMMENDATION_CATALOG_URL`,
`ADMIN_RECOMMENDATION_INGEST_URL`, `ADMIN_MASTRA_RECOMMENDATION_API_KEY`,
`MASTRA_SERVICE_API_KEYS`, `PRECOMPUTED_GA4_PROPERTY_ID=320198532`, and
`PRECOMPUTED_GA4_SERVICE_ACCOUNT_EMAIL` with ADC impersonation access. The
Admin ingest bearer and Mastra service bearer are separate credentials. Use the
normal PR-to-main deployment path; this procedure does not deploy code.

Before submitting a build, choose a new `generationId` and UTC `inputCutoff`.
The cutoff and catalog identity remain fixed for that generation. Verify GA
qualification and the actual model route with read-only/paid smoke checks, then
obtain a fresh PostgreSQL capacity observation. Read
`pg_database_size(current_database())` and `pg_control_system().system_identifier`
from the target database and measure **free bytes on the PostgreSQL PGDATA
volume**, not on the Admin or Mastra service filesystem. Record a conservative
projected build size from a measured source sample. The implementation enforces
a conservative **minimum** 5 GB reserve; that floor is not a measured or
approved total headroom budget. Choose any additional reserve from the target
volume's actual obligations and growth. The measurement must be less than 30
minutes old. Admin crosschecks database size and cluster identity, subtracts
other active build reservations, and blocks new paid/write work if the
attestation expires or capacity is insufficient. It cannot independently
measure PGDATA free bytes from SQL. Do not invent an available-byte value.

If another build receives or refreshes its capacity allowance after your
measurement, admission rejects that older sample. Obtain a new PGDATA and
database observation before retrying. Reservations for builds that finish or
become blocked after the sample remain accounted for until a later observation
includes their writes. The displayed write estimate resets per accepted
observation; it is not cumulative generation allocation.

Write the request to a private JSON file without credentials:

```json
{
  "generationId": "catalog-2026-10-06-a",
  "inputCutoff": "2026-10-06T00:00:00.000Z",
  "historyRequired": true,
  "capacity": {
    "measuredAt": "2026-10-06T00:10:00.000Z",
    "clusterSystemId": "<observed decimal cluster identifier>",
    "observedDbBytes": 0,
    "availableBytes": 0,
    "reserveBytes": 5000000000,
    "projectedBytes": 0,
    "sampleSourceCount": 1,
    "sampleBytes": 1,
    "source": "operator_verified_pgdata_df"
  }
}
```

Replace **every** placeholder/zero with the measured value; the example is
intentionally not executable as a capacity approval. Submit it with a Mastra
service bearer:

```bash
curl --fail-with-body --silent --show-error \
  -X POST "$MASTRA_URL/forge-precomputed-catalog-generation" \
  -H "Authorization: Bearer $MASTRA_SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @/secure/path/catalog-build.json
```

HTTP 202 returns a Mastra `runId` and `generationId`. Review progress and the
private report at Admin `/dashboard/recommendations/precomputed?generation=<id>`.
The report distinguishes sources completed with edges, explicitly empty, and
failed; shows model tokens and known provider-reported USD charges; counts
unresolved/unknown charges; counts every actual GA HTTP attempt including
qualification, pages, and retries; and labels GA bytes/cost unknown where the
provider did not report them. GA snapshot query/page counts are a separate
provenance measure, not a substitute for actual HTTP attempt counts. The report
also shows elapsed time, measured stored size, and the capacity attestation.
Do not infer a refresh budget from fixtures or from known charges while pending
attempts remain unresolved.

If a process crashes or an external provider is temporarily unavailable, use
the **same** generation ID, cutoff, and history setting after the existing
20-minute source lease expires. Obtain a new physical capacity observation and
resubmit through the same route. Completed checkpoints and provisional choices
are reused; a genuinely repeated paid call receives a new call ID and charge
record. A call reserved before a crash remains an unknown charge until its
receipt is known. If a source has a deterministic invalid output or stale
input, it is reported as failed and the generation cannot become ready. Start a
new generation after correcting that cause. An explicit capacity block or
expired attestation pauses further work without treating sources as valid
empty results.

For a later refresh, choose a **new** generation ID and cutoff and use the same
route. The new manifest includes every eligible source, so old sources can gain
connections to newly available targets or change ranking with later analytics.
A complete A/B generation is immutable. Keep the first build's actual cost and
coverage report for deciding refresh cadence; no cadence is configured here.
