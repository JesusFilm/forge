# Recommendation event storage migration

Status: implementation authorized; updated to the owner's asynchronous,
best-effort delivery direction on 28 October 2026. Production is not switched.
Owner: Nisal. Roadmap: [feat-888](../roadmap/content-discovery/feat-888-recommendation-event-storage-migration.md).
Integration: `codex/recommendation-event-storage-integration` in an isolated
worktree. Preserve the dirty primary checkout.

## Latest owner decision takes precedence

Move recommendation and Watch event history out of serving PostgreSQL into a
dedicated Forge ClickHouse service in the existing organizational account.
Keep compact operational authority and derived recommendation state in serving
storage. Preserve current retention, privacy, playback and active A/B behavior.

The owner explicitly clarified: start sending directly to ClickHouse immediately
without awaiting the response in the caller. A retry queue was considered, then
deferred with "for now just don't worry about it if it fails" and a request to
measure failures. Make one bounded background attempt; count its outcome and
continue. Do not enqueue, retry automatically or store a PostgreSQL forwarding
payload on either the success or failure path.

This supersedes the earlier outbox-first, durable retry and 24-hour outage-buffer
requirements. They are withdrawn for this version, not completed. Remove the
undeployed local outbox prototype. Redis and Cloudflare buffering are possible
later work and are not part of this release.

Events can be lost on failure or process death before delivery. Observed failure
counters cannot enumerate every crash loss. Do not claim guaranteed delivery,
lossless history, complete-through watermarks or a low measured failure rate
before observations exist. This tolerance concerns historical-event export;
operational admission, playback, privacy and erasure remain reliable controls.

## Retained scope and decisions

- Cover recommendation interactions and Watch playback/exposure for current and
  editorial strategies, including source-neutral playback. Unrelated product
  events/search analytics, GA and Datadog integrations remain outside scope.
- Target usable learning within five minutes of eligibility-ready delivered
  feedback under normal operation. Measure delivery loss separately. Preserve
  immediate session exclusions and complete operational playback finality.
- Continue serving valid derived results during ClickHouse outages, subject to
  original expiry, publication/playability, exact audio/language and viewer
  controls. Missing exported feedback must not invalidate independent serving.
- Preserve original retention: 14 days for new anonymous Watch exposures,
  recorded legacy expiry, 29 days for request/trace history and existing
  family-specific periods. Backfill never renews expiry.
- Backfill still-unexpired history with original IDs, revisions and timestamps.
  Bounded checkpointed migration/reconciliation is distinct from the no-retry
  policy for live event export.
- Preserve the active A/B's sticky assignments, cohort dates, attribution and
  published immutable reports. Keep necessary compact operational accounting;
  disclose missing analytical coverage instead of treating a partial sample as
  a complete experiment or inferring a winner from it.
- Obtain the actual dedicated service configuration and price before purchase.
  ClickHouse organization access has been requested from Tatai. No service is
  provisioned and no savings are established.

Use `CONCEPTS.md` vocabulary and
[ADR 0001](../adr/0001-recommendation-event-history-and-serving-state.md).

## Core comparison

Checked `JesusFilm/core` main `dbf87798b90965cc0dd4c3e98935e6853e8ffc87`.
Journeys' `fireCaptureEvent` calls Plausible without awaiting or adding retry
logic in that helper. Short links instead use a background Cloudflare Queue
send under `waitUntil`, log enqueue failures without delaying redirects, and
retry failed ClickHouse inserts in the consumer. Production specifies three
retries and a dead-letter queue. Core therefore has multiple patterns; Forge's
one-attempt policy follows the owner's explicit choice.

Core source paths:

- `libs/journeys/ui/src/libs/plausibleHelpers/plausibleHelpers.ts`
- `workers/short-links-redirect/src/index.ts`
- `workers/short-links-redirect/src/queue.ts`
- `workers/short-links-redirect/wrangler.toml`

## Delivery behavior

```text
Existing operational admission commits
  -> start ClickHouse send immediately
  -> caller continues without awaiting network completion

Background attempt
  -> confirmed persistence: count success
  -> error / timeout: count failure or unknown outcome
  -> no queue, automatic retry or persistent forwarding payload
```

Send only after the existing operational transaction commits. Network I/O never
runs inside that transaction; a rolled-back event is not exported. The caller
still awaits necessary operational writes. Their authority is not removed by
the nonblocking history export.

Start the promise immediately and register it with the runtime's background
lifetime support. Next request paths can use `after(promise)` with an already
started promise. Worker callers require an owned background lifetime/drain path.
Catch all rejections, including failure-reporting errors. Graceful draining does
not guarantee survival of process crashes.

Bound encoded bytes, batch size, response bytes, overall deadline and concurrent
in-flight work. Saturation counts as a capacity drop: do not wait for a slot or
create a hidden queue. Defaults remain disabled until qualification. The caller
does not await the network even if ClickHouse never responds.

Inside the background attempt, use confirmed synchronous insertion or async
insertion with `wait_for_async_insert=1`. Caller nonblocking behavior does not
require unconfirmed server acknowledgements. A timeout can mean the server
stored the event but its reply was lost; distinguish this from confirmed failure.

### Measurements

Observe attempted event count, confirmed successes, failures by bounded reason,
timeout/unknown outcomes, capacity drops, in-flight count/bytes and duration.
Use bounded labels such as family and validated A/B arm where available; no
payloads or per-event IDs in logs/metric labels. Reuse telemetry independent of
ClickHouse, so delivery failure cannot hide its own instrumentation.

Report observed failure rate over an explicit window against attempted events,
with unresolved outcomes and coverage gaps separate. Restarts can lose unflushed
observations. Missing instrumentation is not zero failures. Compare family/arm
distributions before interpreting learning or A/B changes. No permanent raw
history table is introduced just to measure transport.

## History and operational ownership

Keep compact issued request/item bindings, one-use handoff/replay identity,
open episode state and bounded unfinalized facts, current eligibility/privacy
fences, active A/B attribution and compact archived-measurement counters.
Profiles, vectors, lists and co-watch graphs remain serving state. Replace raw
source foreign keys only with equivalent lineage and current revalidation.

Move retained payloads for requests/traces, served items, rendered/impression
facts, selections, playback episodes/facts/outcome revisions, content actions,
anonymous Watch exposures and A/B visits/links. Readers include recent history,
profile/co-watch, CTR/engagement, usefulness extraction and authorized operator
trace/exposure views. Renaming a permanent raw-history copy is not migration.

Watch V2 served rows enforce live admission. Replace them with compact authority;
keep pre-cutover bindings until recorded expiry where their original manifest
cannot be reconstructed. Preserve replay/conflict and batch response semantics.

Playback finalization uses complete bounded operational facts and a committed
episode sequence, not an assumed-complete ClickHouse sample. Export loss may
reduce analytical coverage; it must not produce a falsely valid playback
outcome. Preserve necessary A/B accounting and report coverage honestly.

## Canonical history, privacy and expiry

Stable `(family, logicalId, revision)`, payload digest and original timestamps
survive duplicate submissions and backfill. Select the consistent latest
revision before filtering deletion/expiry. Background merge or TTL timing is
not the correctness boundary. Same-revision conflicts are visible failures.
Duplicate transport or backfill must not double-count delivered history.

Apply privacy fences before export and history/projection reads. Bound in-flight
inserts and reconcile remote deletion after possible late completion. Erasure
and privacy control work remains reliable and independently tracked; allowing
lost analytics does not authorize failed deletion. TTL and SQL DELETE do not
prove immediate physical removal from backups.

Report unavailable, stale or incomplete history distinctly. Operational
database, GraphQL, playback and eligibility errors remain real failures.
Historical export failure is measured separately and does not fail a completed
viewer action.

## Migration, rollback and capacity

Build disabled transport and compact state first. Backfill unexpired rows in
bounded checkpointed pages. Reconcile delivered identities/digests, original
expiry and fixed-as-of reports. Separate accepted live export loss from data
corruption or backfill defects; never manufacture parity.

Use separate export and reader gates. Retain temporary legacy history only
through a defined qualification/cutover window. Before compact-only writes,
establish a bounded rollback source or safe forward-fix path. Retire old
payloads/indexes only after reader, privacy and A/B dependencies are safe.

The 28 October 00:57 UTC read-only snapshot found 41,318,291,135 bytes of database
allocation and 7,357,292,544 bytes free on its filesystem. Watch exposures used
8,582,479,872 bytes, including 5,381,455,872 bytes of indexes. The trailing-day
scan found 391,960 currently present Watch rows and a largest five-minute bucket
of 4,303. These partial, dated observations are not a full traffic peak or
savings estimate.

Measure encoded sizes, concurrent send memory/latency, sink ingestion/query
capacity, surviving compact state and actual storage/cost changes. The withdrawn
24-hour buffering target is not a release requirement. Database page reuse,
reduced allocation and physical filesystem reclamation are separate claims.

## Implementation and release

| Ticket   | Work                                                      | Depends on                             |
| -------- | --------------------------------------------------------- | -------------------------------------- |
| feat-889 | Bounded redacted event envelope                           | —                                      |
| feat-890 | ClickHouse schema and confirmed insert/read               | feat-889                               |
| feat-891 | Nonblocking one-attempt dispatch and failure measurements | feat-889, feat-890                     |
| feat-892 | Anonymous Watch history and compact admission             | feat-889, feat-890, feat-891           |
| feat-893 | Recommendation/playback history and serving projections   | feat-889, feat-890, feat-891           |
| feat-894 | A/B and authorized operator reporting                     | feat-892, feat-893                     |
| feat-895 | Privacy, backfill, reconciliation and retirement          | feat-891, feat-892, feat-893, feat-894 |
| feat-896 | Priced service, release and measured storage effects      | feat-895                               |

Use implement-spec's isolated implementer worktrees, merger handoffs, TDD and
independent standards/spec review. Test observable submission, dispatch,
history, projection/report and privacy/backfill boundaries. Use real isolated
databases for atomicity and canonical queries, external HTTP boundary stubs for
failures. Prove caller completion before unresolved delivery, one attempt on
failure, no forwarding store, bounded saturation and truthful counters.

Release requires reviewed green code, all required CI checks, normal PR-to-main
deployment and actual Admin HTTP/worker revision verification. Qualify serving
performance, playback/A/B authority, privacy, expiry, delivered-feedback
freshness and explicit loss observations. Measure actual PostgreSQL retirement,
filesystem headroom and total cost separately. Preserve the independent daily
retention monitor and open capacity work. Feat-888 remains in progress until
the entire implementation and actual release evidence are complete.
