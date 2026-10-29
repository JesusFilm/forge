# Enrichment graph through real Admin persistence

Candidate: integrated graph `7d281c435`, callback CAS `af426afd5`, OAuth service
bearer fix `87054b790`. Node 24.22.1 and task-owned PostgreSQL 18 on loopback 55890. No deployment or paid-provider request occurred.

Two separate Vitest processes shared a throwaway artifact directory. Mastra
instantiated the committed `createForgeVideoEnrichmentWorkflow`, created its real
workflow run and called `run.start`. Its execution and callback clients sent
native HTTP requests to Manager's actual `/api/internal/enrichment-execution`
and `/api/internal/enrichment-callback` route handlers. Manager used its real
AdminGraphqlClient against the real Admin Pothos schema/services over a local
Yoga HTTP fixture, backed by PostgreSQL with migrations 0164–0166.

Only external provider behavior was deterministic: Mux source acquisition,
scripture judgment, translation/retiming, embeddings/provider ingest and Manager
Mux sync. Source/correction/translation/chapter/metadata/embedding leaf execution,
artifact storage, bridge serialization/authentication/admission, callbacks,
Admin ownership fences, revision checks, and job-detail reads were real. The
embedding provider-ingest fixture does not prove Admin vector ingestion.

Observed receipts:

- Committed Mastra workflow returned `status: success`, `ok: true`.
- All **30** bridge/callback requests returned HTTP 200.
- A fresh Admin job read returned `completed`, revision **18**, source and both
  translated subtitle artifact keys, chapter/metadata outputs and persisted Mux
  report. Manager applied the source correction report to actual shared storage.
- Both independent process tests passed. This is an application/service/database
  roundtrip, not a production ingress, image, Auth SSO, Mastra accept/start route,
  paid-provider, live Mux publication, or replica throughput proof. Durable
  accept/start concurrency and cross-process callback CAS have separate tests.

[Manager job and HTTP receipts](./manager-receipt.json) and
[Mastra workflow receipt](./mastra-receipt.json) retain the exact deterministic
fixture result. The source and artifact-isolation review repairs require their
own later regression checks; this receipt predates those repairs.

Transient harnesses used for this run (removed by the later environment restart):
`/tmp/forge-automation-admin-http.ts`,
`/tmp/forge-manager-enrichment-http.test.ts`,
`/tmp/forge-manager-enrichment-http.config.mjs`,
`/tmp/forge-mastra-enrichment-http.test.ts`, and
`/tmp/forge-mastra-enrichment-http.config.mjs`.
Their shared cwd was `/tmp/forge-enrichment-integration-shared`; processes ran
using each package's installed Vitest and config aliases, with local-only
synthetic credentials. Never point these disposable fixture scripts at a shared
or production database.
