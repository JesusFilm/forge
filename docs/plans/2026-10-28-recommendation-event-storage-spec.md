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
Exact table ownership, queue qualification and capacity, delivery guarantees,
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
10. Exact infrastructure and budget — depends on queue and measured sizing.

- Establish queue ownership, capacity, access, latency and actual incremental
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

Core's checked production Terraform declares one ClickHouse Cloud replica with
8 GiB memory in AWS `us-east-2`, always on. The documented Plausible target
shares that service with the short-link `redirects` database using separate
database users. This is configuration evidence; live capacity, access, contracted
pricing and readiness for Forge are unverified. A separate database provides
namespace/permission separation but does not establish independent compute or
failure isolation.

The focused Forge code/config search found no existing recommendation ClickHouse
or Cloudflare Queue integration. Existing PostgreSQL transactions coordinate
event admission, identity, sequence and downstream processing; crossing stores
requires an explicit durable handoff. A bounded outbox is one candidate: it
holds only unforwarded payloads until durable queue acceptance and is distinct
from retained event history. Its byte/age caps, duplicate keys, acknowledgement
semantics and behavior when full still need specification.

Cloudflare documents at-least-once queue delivery, a 25 GB backlog limit per
queue, and paid-plan retention configurable up to 14 days. A queue is finite;
neither an indefinite outage buffer nor exactly-once application effects can be
assumed. An accepted event's original expiry still applies during replay.
Queue acknowledgements must not claim that learning or analytics have caught up.

Current public prices are available, but a Forge quote has not been established:
Cloudflare operations are billed per message and size, including retries;
ClickHouse charges separately for compute and storage. Region, plan, steady
traffic, catch-up capacity, compression, concurrency and existing contracts all
affect the estimate. Do not treat the default-region price as a quote for Core's
region or choose a spending cap without the owner.

Sources checked 28 October 2026:

- [Core production configuration](https://github.com/JesusFilm/core/blob/d1bc3afa80ab9b2f224a07cf81adb9e8594b6071/infrastructure/environments/prod/main.tf)
- [Core ClickHouse module](https://github.com/JesusFilm/core/blob/d1bc3afa80ab9b2f224a07cf81adb9e8594b6071/infrastructure/modules/clickhouse/service/main.tf)
- [Core module defaults](https://github.com/JesusFilm/core/blob/d1bc3afa80ab9b2f224a07cf81adb9e8594b6071/infrastructure/modules/clickhouse/service/variables.tf)
- [Cloudflare delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Cloudflare pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [ClickHouse pricing](https://clickhouse.com/pricing)

## Second decision round — accepted and clarified 28 October 2026

5. Accepted: dedicated Forge ClickHouse service in the existing organizational
   account to isolate compute, scaling and service incidents. Establish the
   actual priced configuration before provisioning.
6. Accepted: a bounded temporary PostgreSQL forwarding outbox until a durable
   queue confirms acceptance, with prompt deletion after acknowledgement and
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

## Outage recovery design — proposed implementation of decision 8

### Business behavior

An eligible submitted event can be accepted while ClickHouse or the managed
queue is unavailable if the admission transaction and pending-event store can
commit. The viewer receives a bounded response after durable acceptance; the
HTTP request does not remain open waiting for downstream recovery. Reports and
learning may lag, while valid Recommendation Serving State remains usable.

Pending delivery survives process restart. Automatic recovery is required;
normal outage recovery must not depend on somebody pressing a retry button.
Delayed reporting is explicit. Original expiry, erasure and privacy generation
apply before every replay and before using derived state.

### Proposed flow

1. Validate the event, its authority and replay identity. Commit required
   operational state and a Pending Recommendation Event together in PostgreSQL.
2. A worker leases bounded pages of due outbox rows and publishes them to a
   durable managed queue. Remove the payload only after confirmed acceptance
   under the selected queue's documented durability and retention contract.
3. A queue consumer batches events into ClickHouse. Acknowledge messages after
   confirmed persistence. An ambiguous response may cause replay of the same
   event ID; canonical readers and processors must apply each logical event
   once, including revision/correction semantics.
4. Incremental jobs derive profile/co-watch state and analytics from accepted
   history. Serve compact valid results through the existing backend.
5. A recurring recovery sweep finds due outbox entries and expired worker leases
   independently of a successful enqueue notification. Proposed sweep cadence:
   one minute, with bounded concurrency and increasing retry delays with jitter.
   Transient outages remain retryable; malformed/conflicting events require a
   visible bounded quarantine and repair path rather than an infinite hot loop.

The existing Admin worker and PostgreSQL-backed workflow runtime can host the
relay and recovery sweep; the current profile reconciliation scheduler provides
a local example. Its existing five-minute cadence is not itself the proposed
one-minute relay cadence. Large payloads must live in the bounded outbox, not be
duplicated indefinitely in workflow logs or arguments.

| Failure                                          | Durable owner and proposed recovery                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| ClickHouse unavailable                           | Managed queue retains pending messages; consumer retries with backoff.                                       |
| Managed queue unavailable                        | PostgreSQL outbox retains events; relay and recovery sweep retry.                                            |
| Worker crashes before sending                    | Expired lease makes the same outbox entry eligible again.                                                    |
| Queue/ClickHouse committed but response was lost | Replay the stable identity; avoid duplicate learning or reporting effects.                                   |
| All eligible durable stores cannot accept        | Cannot confirm durable acceptance. Exact overflow policy remains open; foreground retries must stay bounded. |

No architecture provides unlimited waiting with finite disk or memory. Age/byte
alerts must precede exhaustion and explicit rate admission must protect serving
headroom. An expired or erased payload must not be resurrected merely to empty
a queue. Losing an unexpired event due to retry exhaustion or queue retention
is a measurement/delivery failure, not successful processing.

### Redis option and current evidence

Redis with BullMQ can provide scheduled retries and exponential backoff, but
its persistence and no-eviction policy must be configured and verified. The
current Admin package uses `ioredis` and PostgreSQL-backed `workflow`; BullMQ is
not an installed dependency. The shared Redis client disables its in-process
offline queue and allows one retry per command. These client settings do not
establish the server's persistence, replica durability, eviction or spare memory.
No live Redis persistence inventory was obtained in this investigation.

BullMQ's production guidance requires persistence and `noeviction`. Redis AOF
with once-per-second synchronization can still lose recent acknowledged writes
on a crash. A Redis queue would therefore need an explicitly accepted durability
contract or retained upstream replay evidence; it cannot silently replace the
durable acceptance promise with an ordinary cache write.

Engineering recommendation: use the approved PostgreSQL outbox plus Cloudflare
Queues as the first managed-queue candidate, with relay/recovery in the existing
worker. Redis is an alternative queue implementation to price and qualify if
needed, not an additional third fallback store by default. Actual regional
availability, queue capacity, retention, erasure behavior and network access
remain required implementation checks.

Sources checked 28 October 2026:

- `apps/admin/src/infra/redis.ts`
- `apps/admin/src/workflows/recommendationProfileReconciliation.ts`
- `apps/admin/src/services/recommendations/profiles/reconciliation.job.ts`
- `apps/admin/package.json`
- [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production)
- [BullMQ retry behavior](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [Redis persistence choices](https://redis.io/docs/latest/operate/rs/databases/configure/database-persistence/)

## Engineering qualification following decisions 8 and 9

Do not ask the owner to reapprove the outbox/queue/worker diagram. Establish
feasibility and price, then surface only material choices with concrete
consequences. The 24-hour target does not authorize unlimited PostgreSQL growth.

### Capacity and catch-up calculation

For each event family, measure an admitted peak arrival rate `lambda` in
events/second and encoded event size distribution. Measure allocated bytes per
outbox event with its actual indexes separately from queue message bytes.
Include sustained bursts and event revisions; A/B visit counts are not a proxy
for total event throughput.

For a conservative constant-rate sizing envelope, without taking credit for
expiry during the outage:

```text
T = 86,400 seconds
pending events = lambda * T
required outbox bytes = pending events * measured outbox bytes/event * margin
required queue bytes = pending events * measured queue bytes/event * margin
catch-up seconds = pending events / (recovery events/second - live events/second)
```

Use per-family sums for mixed payload sizes. Record the selected safety margin
and its measured burst basis. The catch-up equation only has a finite positive
result when recovery throughput exceeds ongoing input; qualify that throughput
under serving and database resource limits. Add WAL, vacuum/bloat, lease/retry
updates and non-event growth reserves to the PostgreSQL disk budget. The dated
7.48 GB free-space observation is not a validated outbox allocation.

Qualify each failure domain separately: queue unavailability puts the backlog
in PostgreSQL; ClickHouse unavailability puts it in the queue. Queue retention
must cover outage plus catch-up and operational margin, subject to application
expiry. A 24-hour queue TTL alone cannot demonstrate recovery from a 24-hour
outage. If measured capacity cannot meet the target, present the actual
capacity/cost alternatives before provisioning or cutover.

### Delivery qualification

Cloudflare supports HTTP pull consumers from existing infrastructure; a
Railway worker can therefore consume the queue without introducing a new
Cloudflare-hosted application. Producer HTTP support, scoped credentials and
the full acknowledgement path must also be validated. Cloudflare documents
permanent deletion after retry exhaustion when no dead-letter queue exists.
Consequently default retries alone do not satisfy the accepted outage behavior.

Use a durable dead-letter destination and monitored bounded recovery, and avoid
burning message retries during a known downstream outage. Verify primary and
dead-letter retention, retry limits, poison-event isolation and replay before
claiming the 24-hour target. Events remain pending until confirmed ClickHouse
persistence or a legitimate expiry/erasure disposition. Lost accepted events
are failures, not a completed delivery. A dead-letter queue alone does not
establish automatic recovery or indefinite storage.

Sources checked 28 October 2026:

- [Cloudflare HTTP pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/)
- [Cloudflare dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- [Cloudflare queue limits](https://developers.cloudflare.com/queues/platform/limits/)

### Remaining owner decision frontier

No repeat of Q8 or Q9 is needed. Obtain measured sizing, a priced configuration
and migration alternatives before asking about spending, storage exhaustion
trade-offs or rollout timing. Exact contracts, inventory and validation are
engineering work and should not become a list of rubber-stamp questions.

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
| feat-890 | ClickHouse schema and qualified HTTP transport                 | feat-889                               |
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
- Outbox/queue/ClickHouse retention and erasure, including queued payloads, pass
  privacy qualification. A provider TTL or merge process alone is insufficient.
- Measured peak input, allocated outbox overhead, queue bytes, resource budgets
  and catch-up throughput demonstrate the 24-hour target with earlier alerts.
- Reviewed green integration PR, normal PR-to-main deployment, actual HTTP and
  worker revision verification, then bounded release observations.
- History retirement reduces measured PostgreSQL allocation/growth; report
  physical filesystem headroom and total system cost separately. Preserve the
  daily retention observer and open capacity obligations until their own proof.

Infrastructure prices, live capacity and selective queued-payload erasure remain
qualification work. They are not grounds to claim the migration is deployed or
to bypass the normal release path.
