# Consumer usage reporting (feat-528)

Usage reports answer one question: how many recorded requests and completed
successful responses did each consumer have in the selected date range?
Every admitted portal user can read every consumer's report using their existing
GitHub login. Consumer ownership still controls management actions.

## Accounting and windows

Every request authenticated to an active registered credential increments its
stable consumer's request count once. HTTP retries are separate attempts;
post-auth validation and retrieval errors count as requests. Only Node's completed
`ServerResponse.finish` with a 2xx status increments success. A disconnect before
finish does not. Empty retrieval is a successful 200. Rotation preserves identity.
Revoked/unknown auth, auth outages and pre-auth body-limit rejections go into
service counters without consumer attribution. Historical legacy-token counts
remain in the existing records. Health,
portal and report reads are excluded. Success describes server completion.

Counts are durable, unsampled minute aggregates in `usage_private`. Random pending
attempt IDs deduplicate success updates transactionally; unfinished attempts
remain requests without an invented success. No IP, headers, queries, results,
credential selector, secret or verifier is stored in usage accounting.

UTC half-open `[from,to)` windows are keyed to admission, minute-aligned and
bounded to 31 days per read. Invalid boundaries are rejected, never rounded or
shifted. Return every recorded count in that range, including requests before
or after a service interruption. An existing consumer with no records returns
zero. Unknown consumers return 404; invalid windows return 400. An actual report
DB failure returns 503 with an error, not a successful zero response.
A failed accounting write is logged with a generic event and does not block
retrieval or hide other recorded counts. Reports describe recorded usage;
requests whose accounting could not be persisted cannot be reconstructed.

## Portal and optional machine reports

The portal Usage comparison table provides dates, consumer-name search, 20-row
pagination, requests, successes and last activity. Consumer links open details
with the selected window and report generation time. Show counts whenever the
read succeeds. Clear stale totals and show an error when the read fails.
Load the Usage client only when entering Usage; do not preload reports.

`GET /portal/usage?consumer=<UUID>&from=<UTC Z>&to=<UTC Z>` uses the existing
portal session. `GET /portal/usage/reports?consumer=<comma-separated UUIDs>&from=<UTC Z>&to=<UTC Z>`
validates at most 20 distinct consumers, rechecks admission once and returns
`{ reports: [...] }`. Each report has its own repeatable-read snapshot.
Responses are `Cache-Control: no-store`. No consumer ownership gate applies.

Optional machine reporting uses `GET /internal/usage` and independent report
credentials. `pnpm usage:report --consumer <UUID> --from <UTC Z> --to <UTC Z>`
reads `RAG_USAGE_REPORT_URL` and `RAG_USAGE_REPORT_SECRET` from its receiver.
No SQL/database credentials in arguments. The CLI validates the report contract,
limits responses to 8 KiB, refuses redirects and exits nonzero on a failed read.
Both APIs and CLI return only `consumerId`, `label`, `windowStart`, `windowEnd`,
`requestCount`, `successfulRequestCount`, `lastActivityAt` and `generatedAt`.

## Provisioning and activation

Use normal PR-to-main migration/deploys. Provision separate restrictive logins
with `USAGE` on `usage_private`, no ownership, admin flags, role-switching,
sequence or unrelated application privileges:

- Writer: `SELECT, INSERT, UPDATE` on `minutes` and `denials`;
  `SELECT, INSERT, DELETE` on `pending`.
- Reader: `SELECT` on `consumer_labels` and `report_minutes` only.

Run `pnpm db:verify-usage-roles` with `RAG_USAGE_WRITER_DATABASE_URL` and
`RAG_USAGE_REPORT_DATABASE_URL`. The verifier also permits the narrowly defined
retired metadata grants of existing roles for rolling-deploy compatibility;
new roles do not need those grants. Unexpected corpus/credential/table privileges
remain rejected. No production role alteration is performed by this change.

Collection uses `RAG_USAGE_WRITER_DATABASE_URL` with registered consumer auth.
Portal reporting uses `RAG_USAGE_REPORT_DATABASE_URL` with existing portal config
and the usage writer. There is no separate enable flag or deployment identity
requirement, and no additional human secret.
Optional machine access requires independent hashed report credentials in
`RAG_USAGE_REPORT_TOKEN_HASHES`. Register RAGBot through the portal first;
`RAG_USAGE_RAGBOT_CONSUMER_ID` verifies that prerequisite for its machine grant.
This is separate from the personal retrieval key.

## Correction of the original design — 2026-09-29

The original coverage status, collector heartbeat/watermark, crash reconciliation,
independent deployment inventory and suppression of counts were a design mistake
for this feature. They are removed from application/reporting code and commands.
No inventory registration, heartbeat recovery, narrow diagnostic dates or proof
of uninterrupted tracking is required to read usage. Dates are never changed to
obtain a report.

Migration `20260929020000_simplify_usage_counting` makes the old pending
`collector_id` nullable. New code omits it; old instances can still write it
during a rolling deployment or rollback. Existing request/success totals and
timestamps are untouched. Old coverage tables/views and already-applied migration
files are retained as inert historical data for audit and rollback, not used by
new serving/reporting code. No table/record deletion or retention policy is added.

Feat-529 records the completed owner-reported registration period; feat-609
owns static-token removal. Feat-568 reviews count-row growth,
pending backlog, write/report latency and backup costs before volume expansion.
Historical provisioning writes remain recorded in
[the production audit](../../../../docs/roadmap/rag/evidence/feat-529/production-usage-role-provisioning.md).
