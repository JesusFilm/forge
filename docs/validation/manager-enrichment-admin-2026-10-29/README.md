# Enrichment graph through job-owned artifacts and real Admin persistence

The integrated candidate at `ba8bc18768cf316fdf3746689c6376c22e37a620`, with
`origin/main` `48ad42865` merged locally and the migration renumbering applied,
passed the refreshed deterministic acceptance run on Node 24.22.1 and a new
task-owned PostgreSQL 18.6 cluster on loopback port 55983. The merge was not yet
committed during this run. [The source manifest](./source-manifest.json) records
the exact execution-source and migration hashes, plus the pre-run combined diff
hash. No application source, index, or runtime flags were changed by the harness.

The committed Mastra graph ran in its own Vitest process. Its actual execution
and callback clients sent native HTTP to Manager's actual route handlers in a
second process. Manager's real AdminGraphqlClient called a local Yoga HTTP host
using the real Admin Pothos schema and services against PostgreSQL. The Admin
fixture resolved the dedicated synthetic Manager bearer with the actual bearer
validator and supplied per-request services/loaders. It did not run production
SSO, GraphQL Armor, Redis admission, or the full production context's unrelated
Watch rollout read.

The database applied the actual named migration files:

- `0017_manager_backend_contracts`
- `0165_manager_automations`
- `0166_manager_execution_operations`
- `0167_manager_job_revision`

Manager created the job through Admin GraphQL, reserved its artifact namespace
with revision CAS, and activated the ready namespace before binding the run.
Preparation advanced revision 0 to 2. The real `run-admission` operation included
`sourceReuse: "none"`. No copied or legacy transcript was approved implicitly.

Observed results:

- Both process tests passed. The native Mastra workflow returned `success`.
- All **31** graph bridge/callback requests returned HTTP 200.
- A fresh Admin GraphQL read returned `completed`, revision **20**, with the
  deterministic job namespace marked `ready` and `sourceVerified: true`.
- Real source, correction-report, translation, chapter, metadata, and embedding
  leaf paths ran. Both language subtitle files and the canonical source artifacts
  were written and read in the job-owned namespace.
- While the source stage's real operation claim was incomplete, attempts through
  Admin GraphQL to replace `currentRunId` or make the job terminal both failed with
  the expected in-flight-operation conflict. The original owner stayed intact.
- Foreign-namespace admission returned `400 asset_mismatch`; attempted unverified
  transcript reuse returned `400 unverified_source_reuse`, before valid admission.
- Manager's actual Mux synchronization logic read generated artifacts and
  persisted two `synced` comparisons with the correct job-owned previews.

Only external behavior was deterministic: Mux source acquisition, scripture
classification, translation/retiming, OpenRouter chapter/metadata responses,
embedding provider and ingest responses, and Mux retrieve/create transport.
Manager's correction application, storage, publication/report logic, callback
projection, GraphQL serialization, revision CAS, and Admin operation-row fences
were real. This run does not establish live Mux/S3 availability, paid-provider
behavior, Admin vector ingestion, Mastra durable accept/start HTTP admission,
production ingress/image readiness, SSO, or replica throughput. The transcript
correction fixture classified the source as non-scripture; it exercised the real
report path without changing the source wording. Cross-job simultaneous writes
remain covered by the committed graph and namespace regression suites.

[Manager job, admission negatives and fence receipts](./manager-receipt.json),
[Mastra result and artifact bytes](./mastra-receipt.json), and
[Admin HTTP operation receipts](./admin-receipt.json) retain the result. The two
Admin GraphQL errors in the latter are the deliberately rejected ownership and
terminal invalidation probes. There were no unexpected GraphQL errors.

The replayable local harness and logs remain in ignored
`.tmp/enrichment-acceptance-r2/`, inside the worktree. The scripts contain only
synthetic local credentials and clear the inherited environment. From this
checkout, with dependencies installed and the two test slots available:

```bash
.tmp/enrichment-acceptance-r2/setup-db.sh
.tmp/enrichment-acceptance-r2/run.sh
```

`setup-db.sh` manages only its own cluster/database and discovers migration files
by name, so the integration renumbering cannot silently select an old ordinal.
`run.sh` starts the Admin fixture, runs Manager with one Vitest worker, and has
Manager launch the separate Mastra worker with shared local artifact storage.
The Admin fixture stops on completion. The task-owned PostgreSQL cluster was
also stopped after evidence capture. No other database, provider, deployment,
branch, PR, or feature activation was modified.
