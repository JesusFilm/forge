# Recommendation event storage migration

Status: implementation authorized 28 October 2026; production qualification pending.
Owner: Nisal. Started: 28 October 2026, Pacific/Auckland.
Roadmap: [feat-888](../roadmap/content-discovery/feat-888-recommendation-event-storage-migration.md).
Repository baseline: `c46657d0f484ab06e29800fa1622134f41d78c68`.

## Owner direction already established

- Move event history away from the serving PostgreSQL database, with ClickHouse
  as the proposed primary event store rather than a permanent additional copy.
- Recommendation calculations can read the event store through a backend API;
  small derived profiles and recommendation lists can remain in serving storage.
- Write a specification through grill-with-docs, then deliver the agreed change
  through implementation, review, normal deployment, and verification.
- Preserve the dirty primary checkout. This specification lives in an isolated
  worktree based on current main.

The owner accepted decisions 1–7 and the 24-hour outage target in decision 9
on 28 October. Decision 8 must prioritize durable waiting and automatic retry
while serving continues. The owner correctly challenged the repeated Q8 as an
implementation recommendation rather than a meaningful owner decision. Resolve
the technical mechanism through engineering evidence instead of repeating a
rubber-stamp question; no provider purchase approval is inferred from that reply.
Exact table ownership, outbox capacity, delivery guarantees,
physical retirement, infrastructure sizing and cost still need resolution.
The owner subsequently requested `implement-spec` execution. Implement the
accepted behavior and resolve engineering details in the task graph below.
Infrastructure purchase, cutover and storage claims require concrete evidence;
implementation authorization does not establish those facts.

## Vocabulary and ownership

Use the existing [Recommendations glossary](../../CONCEPTS.md#recommendations).
Do not create a second competing root glossary. Update that glossary as new
terms are agreed; keep technology and implementation decisions in this spec and
ADRs rather than glossary definitions.

The existing domain distinguishes Recommendation Evidence, Recommendation
Playback Episode, Recommendation Outcome Revision, Recommendation Profile
Projection, and Recommendation Served Item. The agreed Recommendation Event
History includes recommendation interactions and Watch playback/exposure for
both A/B strategies, including source-neutral playback. Search analytics and
other unrelated product-event stores are outside this migration.

Recommendation Serving State and Recommendation Learning Freshness name the
derived delivery state and eligibility-to-usable-state delay. The canonical
glossary defines these without prescribing storage technology.

## Grounding already checked

- The 28 October 06:27 NZDT capacity snapshot measured 41.11 GB of database
  allocation and 7.48 GB of filesystem headroom. Watch exposure allocation was
  8.48 GB, including 5.32 GB of indexes. These are dated measurements, not a new
  live inventory or a guaranteed savings estimate. The subsequent Railway CLI
  read was unauthorized and returned no fresh capacity evidence.
- Watch V2 evidence must match an issued served binding, inherits its expiry,
  and supports event identity/replay checks. Its table is used for both
  operational admission and analytical reporting. Moving the table requires
  preserving both responsibilities, not merely redirecting report queries.
- `playback-outcome-consumer.ts` reads published outcomes and episodes from
  PostgreSQL before downstream profile feedback. Co-watch projection reads
  canonical outcome revisions with eligibility and suppression checks.
- Profile projection currently has a five-minute coalescing setting and a
  five-minute reconciliation schedule. These settings are not a demonstrated
  end-to-end freshness guarantee.
- New anonymous Watch exposures have 14-day retention. Existing exposure rows
  retain their recorded expiry. Shared recommendation request/trace retention
  is 29 days; other families have their own lifetimes. Migration does not itself
  authorize extending those periods or reviving expired evidence.
- The public editorial-versus-current A/B is running. Revision 3 was refreshed
  on 28 October and contains 86,765 eligible visits. Preserve assignment,
  attribution, cohort dates, outcome revisions and existing immutable reports.
  The cohort ends 20 November 11:05 NZDT, with a 24-hour late-event window.
- Core main `d1bc3afa80ab9b2f224a07cf81adb9e8594b6071` declares Cloudflare
  Queues feeding ClickHouse Cloud for short-link events. Its checked redirect
  schema has no TTL; its consumer drops batches when unconfigured and has no
  application event identity in the checked row schema. Reusing its general
  architecture does not establish suitability of those semantics for Forge.

## Decision tree

1. Event ownership boundary — accepted: recommendation and Watch history.
   - Exact table/reader inventory and rollout slices can now be developed.
2. Required freshness — accepted: five-minute normal-operation target from
   eligibility-ready feedback, preserving immediate session exclusions.
   - Projection cadence, lag measurements and serving strategy are next.
3. Outage behavior — accepted: retain valid serving and durably buffer events.
   - Buffer capacity, acknowledgement and recovery contracts remain open.
4. Retention intent — accepted: preserve existing recorded expiry and policies.
   - Partitioning, TTL and erasure implementation can now be developed.
5. Operational isolation — accepted: dedicated Forge service in the existing
   organizational account; exact sizing and cost remain unverified.
6. Durable handoff boundary — accepted: bounded temporary PostgreSQL outbox.
7. Historical continuity — accepted: backfill still-unexpired in-scope history.
8. Outage recovery — accepted intent: durable pending events and background
   retry while valid serving continues. Queue technology and scheduled recovery
   are engineering work, not another owner confirmation gate. Complete storage
   exhaustion remains unresolved pending capacity evidence.
9. Buffer outage horizon — accepted: 24 hours at measured peak traffic, subject
   to original event expiry. Actual peak input, space and catch-up requirements
   must be measured; acceptance of the target does not establish capacity.
10. Exact infrastructure and budget — depends on measured outbox/sink sizing.

- Establish sink ownership, outbox capacity, access, latency and actual incremental
  cost. A hosting preference does not authorize an unpriced purchase.

11. Migration and rollback — detailed design depends on decisions 8–10.
    - Define duplicates, corrections, erasure propagation, reconciliation,
      cutover and rollback while preserving the ongoing A/B.
12. Release acceptance — depends on migration design and measured baseline.
    - Define parity, serving performance, freshness, durable recovery,
      PostgreSQL retirement, physical headroom and total operating cost.

## First decision round — accepted 28 October 2026

The owner answered recommended for all four questions.

1. Move recommendation and Watch playback/exposure history, covering both
   current and editorial recommendation paths. Unrelated search/product stores
   and the configured GA/Datadog integrations are unchanged.
2. Target eligibility-ready feedback becoming usable within five minutes under
   normal operation. Preserve immediate session exclusions and current playback
   finality rules. This is a target to implement and measure, not existing proof.
3. Continue serving valid derived results while new events are durably buffered
   during event-store outages. Show freshness and recover with bounded work.
   Expiry, deletion, reset and other viewer controls still take effect; cached
   state cannot override those controls.
4. Preserve current expiry horizons: 14 days for new anonymous exposures, the
   recorded expiry on legacy exposure rows, 29 days for shared recommendation
   request/trace history and existing family-specific rules elsewhere. A replay
   or migration does not restart retention. Longer history is a separate decision.

The architectural trade-off is recorded in
[ADR 0001](../adr/0001-recommendation-event-history-and-serving-state.md).

## Infrastructure and handoff findings

Core's production configuration demonstrates ClickHouse Cloud with a separate
Cloudflare queue for short-link events; its configuration is evidence of a
pattern, not Forge capacity or a required provider choice. Forge already requires
a durable temporary PostgreSQL outbox and owns a PostgreSQL-backed worker.

Engineering decision, 28 October: use that bounded outbox as the durable queue
and deliver directly to ClickHouse. This preserves the accepted waiting/retry
behavior while removing a remote pending-payload erasure surface. The earlier
managed-queue candidate was not an owner-selected vendor. Outbox payloads now
remain until confirmed ClickHouse persistence, instead of an intermediate queue
acknowledgement. They are temporary pending work, not a retained history copy.

This increases how often PostgreSQL carries backlog during sink outages. The
accepted managed-queue design already required a 24-hour PostgreSQL buffer for
queue outages; the direct path still has to prove that budget under live load.
If it cannot, quantify additional capacity or an external buffer before purchase
or cutover. A second external payload store is not part of this implementation.

The fresh read-only 28 October 00:57 UTC snapshot found 7,357,292,544 bytes free
on a 48,891,670,528-byte filesystem and 41,318,291,135 bytes of database
allocation. Watch exposure occupied 8,582,479,872 bytes, including
5,381,455,872 bytes of indexes. A bounded trailing-24-hour scan found 391,960
Watch rows present, with a largest five-minute bucket of 4,303. That is one
observed window, not the total in-scope peak or a future throughput guarantee.
Encoded outbox size, allocated index/maintenance overhead, playback-fact/A-B
arrival peaks and recovered throughput still need measurement.

ClickHouse plan, region, always-on capacity, compression, storage and existing
contract determine the price. The dedicated service has not been provisioned.
The work-account sign-in reaches new-account completion; organization access was
requested from its owner. Public default-region prices are not a service quote.

## Confirmed implementation choice

```text
Authenticated event admission
  -> transaction: compact operational state + bounded PostgreSQL outbox
  -> existing worker: leased bounded delivery with retry
  -> ClickHouse: confirmed persisted event history
  -> idempotent canonical projections and reports
  -> compact serving state
```

## Second decision round — accepted and clarified 28 October 2026

5. Accepted: dedicated Forge ClickHouse service in the existing organizational
   account to isolate compute, scaling and service incidents. Establish the
   actual priced configuration before provisioning.
6. Accepted: a bounded temporary PostgreSQL forwarding outbox until a durable
   sink confirms persistence, with prompt deletion after acknowledgement and
   explicit storage/age limits. No permanent duplicate event history. Exact
   atomicity and replay contracts remain engineering work.
7. Accepted: backfill still-unexpired in-scope history in bounded batches,
   preserving original identity and expiry, and keep the current A/B's cohort
   and reports intact. Never restore already-expired data.
8. Owner clarification: wait and retry in the background while serving
   continues; investigate temporary storage and scheduled retry, including a
   Redis queue. This establishes the recovery intent, not a choice of Redis or
   permission to acknowledge an event that no durable store accepted. Interpret
   continued serving as continued viewer/recommendation service with delayed
   event processing, subject to existing serving dependencies and validity.
9. Accepted: a 24-hour outage design target at measured peak traffic, with
   early alerts and bounded catch-up. This is a minimum outage tolerance target,
   not a new event expiry or permission to discard pending events at hour 24.
   Original expiry and erasure still apply. The owner challenged the repeated
   Q8 as lacking a meaningful decision; the technical recommendation below is
   for engineering qualification rather than another approval question.

## Durable delivery and recovery

### Business behavior

An eligible submitted event is accepted once operational admission and its
pending outbox payload commit together. The HTTP response does not wait for
ClickHouse. Valid recommendations continue serving within their existing
privacy, expiry, eligibility and dependency constraints. Reports and learning
show lag while the sink is unavailable. Failure to commit admission is a visible
persistence failure, never a successful fallback acknowledgement.

The worker recovers after restart without manual intervention. A one-minute
scheduled sweep reclaims expired leases and retries due rows with increasing
delay and jitter. Each page, statement, request, batch and concurrency setting
has a bound. No network request occurs inside the admission transaction. Large
event bodies stay out of workflow arguments/logs.

### Handoff and replay

1. The producer validates the family-specific schema and redaction, immutable
   identity, authority, original timestamps/expiry and revision. Commit its
   compact operational state and envelope in one PostgreSQL transaction.
2. Lease a bounded due page, commit the lease transaction, then deliver through
   authenticated ClickHouse HTTP with a hard deadline. Use synchronous insert,
   or asynchronous insert with acknowledgement only after durable flush.
3. Remove only payloads whose sink persistence was confirmed, fenced by the
   current lease token. A timeout or ambiguous response retains pending work.
   Stable identity/revision plus canonical reads prevent duplicate effects.
4. Acknowledge each projection/report stage separately. Sink persistence does
   not prove learning or an A/B report has caught up.
5. On expiry or erasure, remove pending payload under its own legitimate
   disposition. A quarantined/corrupt event remains a visible failure requiring
   repair. There is no finite retry count that silently discards valid events.

The 24-hour target is outage tolerance, not an event TTL or a discard deadline.
Original expiry always wins. If finite capacity is exhausted, stop admission
with a bounded explicit persistence error and alert; keep independent serving
paths available. Never consume reserved serving space to hide event loss.

### Canonical history and complete-through evidence

Use stable `(family, logicalId, revision)` and an immutable envelope digest.
Canonical reads select a consistent revision before filtering deletion/expiry;
ClickHouse background replacement or TTL timing is not the correctness boundary.
Corrections retain their original identity/partition/expiry. Logical duplicate
and conflict semantics must survive regrouped retry batches and backfill.

A plain allocated sequence does not establish commit order or a safe global
watermark. For readers needing a complete snapshot, use a transactional stream
cursor with compact terminal markers, or prove an equivalent bounded barrier.
Only confirmed persistence establishes delivered history. Expired/erased
terminal dispositions remain distinct, and quarantined gaps prevent a false
complete-through claim. Playback finalization must have every admitted fact
through its episode watermark; final A/B reports require the source cutoff to
be complete. Oldest-pending age alone must not be labeled complete-through.

### Privacy and expiry

Pending payloads are locally removable in the same privacy-control transaction.
Before starting remote delivery, recheck the applicable generation/erasure fence.
A worker may already have copied a payload or begun an insert when erasure wins;
track bounded in-flight work and reconcile remote deletion after possible late
completion. Serving, projection and authorized history reads immediately apply
current privacy controls while physical cleanup is confirmed separately.

TTL and PostgreSQL DELETE do not prove immediate physical removal from storage
or backups. Preserve existing obligations and classify delayed/failed erasure
truthfully. A later replay cannot recreate erased data or extend original expiry.

### Capacity and catch-up calculation

Measure admitted peak arrival rate by family, encoded event bytes and allocated
outbox bytes with its actual indexes. Include revisions and sustained bursts;
A/B visit counts are not a substitute for total event throughput.

```text
T = 86,400 seconds
pending events = peak admitted events/second * T
outbox bytes = sum(per-family pending events * allocated bytes/event) * margin
catch-up seconds = pending events / (recovery events/second - live events/second)
```

Choose a measured burst margin, and reserve WAL, vacuum/bloat, retry updates and
non-event growth separately. Catch-up needs recovery throughput greater than
ongoing input while serving remains healthy. The 7.36 GB free-space observation
is not an outbox allocation. Configure hard byte/event caps plus early age/space
alerts; prove capacity and catch-up before enabling the migrated production path.

### Engineering evidence and decisions still needed

Qualify exact family codecs/readers, current-revision conflicts, snapshot
barriers, admission/lease contention, physical outbox allocation, sustained
recovery and the priced dedicated service. Present only concrete spending or
product trade-offs to the owner. Queue selection and retry mechanics are routine
engineering choices under the implementation authorization.

Sources:

- [PostgreSQL queue-like skip-locked reads](https://www.postgresql.org/docs/18/sql-select.html)
- [PostgreSQL transaction and sequence behavior](https://www.postgresql.org/docs/18/transaction-iso.html)
- [ClickHouse asynchronous inserts](https://clickhouse.com/docs/optimize/asynchronous-inserts)
- [ClickHouse pricing](https://clickhouse.com/pricing/)

## Constraints carried forward

- Preserve exact audio/language, publication/playability, canonical duplicate
  exclusions, attribution, profile opt-out/reset/erasure and per-record expiry.
- Accepted missing content coverage remains separate from actual server,
  persistence and playback failures. Storage migration does not alter ranking
  policy or experiment variants.
- Keep daily cleanup and the existing capacity observer running during design.
  Their unresolved operational-margin obligations remain independent.
- Use normal reviewed PR-to-main deployment. Preserve unrelated code and docs.
- Distinguish reduced PostgreSQL row/index requirements, physically reclaimed
  filesystem space, and total system cost. Validate each claimed benefit.

## Implementation graph and acceptance

The owner requested implementation on 28 October. Use one integration branch,
`codex/recommendation-event-storage-integration`, based on current main, with
isolated child worktrees. The repository's `docs/roadmap/` tracker remains the
source of ticket status. The parent feat-888 stays in progress until every
required child and actual release verification is complete.

| Ticket   | Work                                                           | Depends on                             |
| -------- | -------------------------------------------------------------- | -------------------------------------- |
| feat-889 | Event envelope and bounded transactional outbox                | —                                      |
| feat-890 | ClickHouse schema and confirmed HTTP persistence               | feat-889                               |
| feat-891 | Worker relay, recovery, health and capacity controls           | feat-889, feat-890                     |
| feat-892 | Anonymous Watch history with compact admission state           | feat-889, feat-890                     |
| feat-893 | Recommendation/playback history and serving projections        | feat-889, feat-890                     |
| feat-894 | A/B, trace and operator reporting parity                       | feat-892, feat-893                     |
| feat-895 | Privacy, backfill, reconciliation and retirement               | feat-891, feat-892, feat-893, feat-894 |
| feat-896 | Priced infrastructure, release and measured storage acceptance | feat-895                               |

The ticket files define exact ownership, entrypoints and acceptance. Child
completion needs tested code integrated into this branch; the release ticket
also requires actual deployment and operational evidence. This decomposition
preserves the complete accepted scope, including source-neutral playback and
both A/B variants. A queue prototype or anonymous-exposure-only migration does
not complete feat-888.

### Test boundaries

Use behavior tests at the existing authenticated event submission interfaces,
the transactional pending-event store and delivery worker, bounded history
reader interfaces, projection/report output, and privacy/backfill operational
entrypoints. These are the observable boundaries of the accepted requirements;
the owner's standing authorization covers routine implementation/test choices.
Use the requested TDD red/green loop with real isolated PostgreSQL where atomic
commit, leasing, caps, migration or concurrent replay is the behavior under test.
Stub external HTTP only at its public boundary; qualify actual provider behavior
separately. Preserve existing API shapes and test expiry, duplicates, corrections,
rollback, late events, outages and recovery before cutover.

### Storage ownership

The read/write inventory found transactional responsibilities in raw tables.
Retain compact live authority for issued request/item bindings, one-use selection
handoff and replay identity, open playback episodes and bounded unfinalized fact
material, current eligibility/privacy/erasure fences, active A/B visit attribution
and archived-measurement counters. Derived profiles, vectors, recommendation
lists and co-watch graphs remain serving state. Their raw source foreign keys
need explicit replacement before source history retirement.

Move retained payload history for requests/traces, served items, rendered and
impression facts, selections, playback facts/episodes/outcome revisions, content
actions, anonymous Watch exposures and A/B visits/links. Readers include recent
context/history, finalization, profile/co-watch projection and reconciliation,
precomputed CTR/engagement, usefulness extraction and operator trace/exposure
views. Operational retention is bounded by capability/finality/attribution needs;
renaming a permanent history copy does not meet the storage goal.

### Release gates

- Atomic accepted event and outbox commit; rollback leaves neither, outages keep
  committed events pending, and capacity rejection is an explicit failure.
- Stable logical identity, revision and original expiry survive replay and
  backfill. No duplicate learning/reporting effects or resurrected erased data.
- Complete-through evidence prevents finalization or final reports from reading
  partial asynchronous history. Immediate session exclusions stay synchronous.
- Cross-store fixed-as-of parity covers both active A/B arms and source-neutral
  playback. Preserve sticky assignments and immutable published reports.
- Outbox/ClickHouse retention and erasure, including pending payloads, pass
  privacy qualification. A provider TTL or merge process alone is insufficient.
- Measured peak input, allocated outbox overhead, sink capacity, resource budgets
  and catch-up throughput demonstrate the 24-hour target with earlier alerts.
- Reviewed green integration PR, normal PR-to-main deployment, actual HTTP and
  worker revision verification, then bounded release observations.
- History retirement reduces measured PostgreSQL allocation/growth; report
  physical filesystem headroom and total system cost separately. Preserve the
  daily retention observer and open capacity obligations until their own proof.

Infrastructure prices, full event capacity and cross-store erasure remain
qualification work. They are not grounds to claim the migration is deployed or
to bypass the normal release path.
