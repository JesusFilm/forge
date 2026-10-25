# Feat-528 implementation scope

Usage is the number of recorded authenticated requests and completed successful
responses per consumer for the selected UTC date range. The 2026-09-29 product
correction removes the original coverage/inventory design as unnecessary and
misleading. Do not recreate coverage status, deployment inventory, heartbeats,
watermarks, reconciliation or count-suppression gates.

Keep atomic admission increments and transactionally deduplicated completions in
separate raw-SQL metadata tables. Counts are unsampled. Reports sum minute rows
for the consumer and exact minute-aligned `[from,to)` range, bounded to 31 days.
Interruption, historical time before instrumentation and unfinished attempts do
not hide stored counts. A successful empty read for an existing consumer is zero;
an actual DB read failure is an error. Never alter selected dates to obtain totals.

All admitted portal users can read every consumer report using their existing
GitHub session. Consumer management stays owner-restricted. Optional machine
report credentials are independent of retrieval keys. RAGBot is registered in
the portal before an optional machine grant.

## Selected layout: A

Keep the comparison table with consumer-name search and 20-row pagination.
Display requests, successful responses and last activity. Consumer links open the
selected window and generation time. Remove Coverage and Complete through fields.
Load Usage only on navigation. Validate every consumer/window before a bounded
batch read, checking admission once. Failed reads clear stale totals and show
an error. No automatic retry, browser storage or telemetry.

## Safe rollout and verification

Add a migration making the legacy pending collector reference optional. New code
writes no collector reference; old and new instances can overlap without losing
counts. Preserve existing aggregates, timestamps and applied migrations. Leave
retired DB metadata inert for audit/rollback. New least-privilege roles need only
counting and aggregate-reading grants; existing narrow legacy grants remain
accepted without requiring production role edits.

Reproduce the original seven-day report regression before the fix. Test actual
PostgreSQL counts across interruptions, original date preservation, consumer
isolation, zero/history, half-open boundaries, pending requests, concurrent
admissions, rotation and completion deduplication. Test minimal roles and real
write failures, HTTP failures/disconnects/revocation, API/CLI failures, and the
real browser table/details/error path. Verify lazy loading, resource size/timings
and responsive layout. Run full RAG tests, typecheck, lint, import-law, migration
and schema drift checks. This implementation makes no direct production writes
or deploys and does not authorize shared-token cutoff.
