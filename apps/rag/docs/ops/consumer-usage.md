# Consumer usage reporting (feat-528)

Usage is additive metadata in `usage_private`, separate from corpus, credentials,
portal sessions and lifecycle audit. Consumer owners receive no report access.
No IP, headers, queries, results, credential selector, secret or verifier is stored
in accounting. Existing credential verifiers stay in `consumer_private`.

## Accounting and windows

Every active registered credential admission increments its stable consumer's
request count once. HTTP retries are separate attempts. Validation and retrieval
errors count as attempts; only Node's completed `ServerResponse.finish` with a
2xx status increments success. A disconnect before finish does not. Empty
retrieval is a successful 200. Rotation preserves identity. Revoked/unknown auth,
auth outages, body-limit rejections and legacy shared tokens go into bounded
service counters without consumer attribution. Health, portal and report reads
are excluded. Success describes server completion, not delivery to a caller.

Reports use UTC half-open `[from,to)` windows keyed to admission, **aligned to
minute boundaries**, with at most 31 days in one read. This implements the
plan's proposed minute aggregates without claiming second-level precision.
Unaligned boundaries are rejected rather than rounded. Metrics are unsampled
and durable; no deletion/retention policy is introduced. Pending attempt IDs are
random operational deduplication state and never exposed in reports.

`GET /internal/usage?consumer=<stable UUID>&from=<UTC Z>&to=<UTC Z>` returns only
`consumerId`, `label`, `windowStart`, `windowEnd`, `requestCount`,
`successfulRequestCount`, `lastActivityAt`, `generatedAt`, `completeThrough`, and
`coverageStatus`. Counts are safe JSON integers; an overflow fails the report.
An unknown consumer is 404, invalid window 400, missing report authority 403.
Responses are `Cache-Control: no-store`. A report DB failure is 503, never zero.

`pnpm usage:report --consumer <UUID> --from <UTC Z> --to <UTC Z>` uses the
bounded HTTP capability, with `RAG_USAGE_REPORT_URL` and
`RAG_USAGE_REPORT_SECRET` injected from the approved receiver. The command never
accepts SQL or database credentials. It validates fixed fields and an 8 KiB
response cap, refuses redirects, visibly marks partial coverage, and exits
nonzero on unavailable coverage or any report failure.

## Coverage and recovery

Each instrumented instance persists its start, five-second heartbeat/watermark,
and graceful stop. Admission and checkpoints serialize locally and lock the
collector row in PostgreSQL; a closed admission watermark rejects late writes.
Completion atomically removes pending state and increments successes once.
Reports read counts and coverage in one repeatable-read snapshot. Complete
coverage requires independently declared deployment/replica inventory across the
whole window, matching collectors for every expected replica, every
intersecting instance flushed through its interval, no pending attempts and no
durable gaps. An open collector cannot cover a window past its acknowledged watermark; a
heartbeat older than 30 seconds signals unavailable collection. Already flushed
closed windows keep their coverage when later collection stops. Pending attempts or recorded gaps make covered windows
partial. Re-reading a complete closed window preserves totals.

A telemetry write failure lets bounded retrieval proceed but freezes that
collector's progress. Recovery must persist a gap from its last acknowledged
checkpoint before advancing again. If recording the gap fails, its watermark
stays stale. Missing Node transport instrumentation records a gap rather than
claiming successes. Reports before first instrumentation, across a shutdown
without a replacement collector, or during delayed flush are unavailable.

After a crash, first confirm that the exact collector instance is stopped;
never infer death solely from a stale heartbeat. Operators can inspect the
non-sensitive collector metadata with their restricted writer capability. Then
run `pnpm usage:reconcile --instance <UUID> --confirmed-stopped` with the writer
URL injected. It refuses a heartbeat less than 30 seconds old, reconciles
pending attempts conservatively without guessing successes, and persists the
uncertain interval as a gap. No corpus changes or destructive schema rollback
are needed. Historical uncertainty remains visible after recovery.

## Independent deployment inventory

A separate operator capability maintains `deployment_inventory` with deployment
ID, UTC start/end and expected replica count. Serving cannot create or change
these rows, and the report role reads only the inventory view. Reports partition
windows at every inventory/collector boundary. Missing inventory, missing or extra
collectors, undeclared deployments or an unflushed expected replica force
`unavailable`, even while another replica remains healthy. Unknown deployment
instrumentation therefore cannot silently produce a complete zero.

Provision an independent inventory login with only `USAGE` on `usage_private`
and `SELECT, INSERT, UPDATE` on `deployment_inventory`, no other table or role
rights. Inject its URL as `RAG_USAGE_INVENTORY_DATABASE_URL` into the operator
receiver only, never serving or RAGBot. `pnpm usage:inventory` verifies the role
before writes. Declare the deployment using
`--deployment <ID> --from <UTC Z> --replicas <1..64>` before activation; close
it with `--deployment <ID> --to <UTC Z>` only after every replica has stopped.
A database guard preserves ID, start and replica expectation and permits one
terminal close. Scaling needs a new declared deployment interval, rather than
rewriting historical expectations. During rolling deployment, inventory includes
both live deployments. Failures remain unavailable until inventory and all
collectors match; do not lower the expectation to hide an uninstrumented replica.

Serving records `RAILWAY_DEPLOYMENT_ID` (or explicit
`RAG_USAGE_DEPLOYMENT_ID` for local/non-Railway use). Collection configuration
without a deployment ID refuses startup. The inventory must come from an
independent deployment/replica source: application self-registration cannot
verify that source's accuracy. This authority separation is what lets a missing
collector fail coverage rather than merely requiring a manual observation.

## Provisioning and activation

Use the normal PR-to-main migration/deploy flow. This implementation authorizes
no production provisioning, consumer creation, cutover or direct deploy.

Provision distinct login roles without ownership, admin flags, role-switching,
sequence or other application privileges. Grant `USAGE` on `usage_private` only:

- Usage writer: `SELECT, INSERT, UPDATE` on `minutes`, `collectors`, `gaps`,
  `denials`; `SELECT, INSERT, DELETE` on `pending`.
- Report reader: `SELECT` only on `consumer_labels`, `report_minutes`,
  `report_collectors`, `report_pending`, `report_gaps`, `report_inventory`. Views expose no
  verifiers, contacts, ownership, lifecycle text or corpus.

Run `pnpm db:verify-usage-roles` with `RAG_USAGE_WRITER_DATABASE_URL` and
`RAG_USAGE_REPORT_DATABASE_URL`. The verifier rejects unexpected effective,
column-level and SET-reachable table privileges and privileged role flags.
The writer is separate from both consumer roles and the corpus reader.

Enable collection with `RAG_USAGE_WRITER_DATABASE_URL` after registered auth
is configured. Reporting also requires `RAG_USAGE_REPORT_DATABASE_URL` and
`RAG_USAGE_REPORT_TOKEN_HASHES`, a JSON object mapping only `jaco` and/or
`ragbot` to SHA-256 hashes of independently generated report secrets. Use high
entropy secrets, deliver directly into each approved receiver, and never put
values in command arguments, output, documentation or evidence. Hash comparison
is constant-time. Remove/replace the corresponding hash to revoke/rotate report
access. Retrieval credentials and portal cookies cannot authorize reporting.

Before granting RAGBot reports, an allowlisted initial owner must create it
through feat-530's portal UI and save the one-time retrieval key directly in its
receiver. Set `RAG_USAGE_RAGBOT_CONSUMER_ID` to that stable ID; startup verifies
it exists through the label view. Grant its independent report secret only after
this registration. This is a separate operator capability, not an ownership
permission, retrieval tool or general database credential.

Activation evidence must compare independent inventory with actual live
replicas/deployments before declaring a covered window. Do not use a healthy
replica's heartbeat as fleet inventory. Maintain inventory on rollback and
scaling. Roll reporting back independently: remove report access and keep
collection where possible; otherwise missing/stopped intervals make coverage
unavailable. Never revive denied credentials or shared-token access incidentally.

Jaco owns activation and recovery. Feat-529 owns actual `forge-rag-retrieve`
dogfood, seven-day migration and separately approved cutoff. The production
capacity review in feat-563 must cover minute-row growth, pending-state backlog,
write latency, inventory maintenance, heartbeat overhead and backup cost before
volume expansion. Implementation tests use synthetic, disposable local data.
