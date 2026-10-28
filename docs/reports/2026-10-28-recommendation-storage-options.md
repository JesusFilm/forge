# Recommendation storage options

Decision evidence for draft PR #2950, dated 28 October 2026. This comparison
does not change the owner's one-attempt ClickHouse direction or authorize a
production rewrite. The implementation and service are not released.

## What the measurements establish

The 00:57 UTC read-only production snapshot found 41,318,291,135 bytes of
database allocation and 7,357,292,544 bytes of filesystem headroom. Anonymous
Watch exposure storage accounted for 8,582,479,872 bytes, including
5,381,455,872 bytes of indexes. These are dated observations, not today's
available capacity or an estimate of reclaimable bloat. Indexes are already
included in relation totals; do not add them twice.

The local PostgreSQL fixture has 2,000 six-item windows and 38,000 event rows.
After `VACUUM ANALYZE`, the original representation occupied 24,461,312 bytes;
the proposed receipt/item/window representation occupied 19,824,640 bytes,
18.96% less. It retains admission, replay and exact issued-item bindings. This
is a representation comparison on fresh synthetic tables, not a forecast of
production reduction. Compact operational authority still has a material cost.

The actual bounded ClickHouse reader completed a 400,000-row local fixture in
2,755 ms but timed out at 1,000,000 rows in 3,005 ms. Its three-second deadline
was unchanged. The dated 391,960 currently present Watch rows/day implies
roughly 5.5 million rows over 14 days, before corrections, and does not capture
a full peak. That reporting horizon has not been qualified. A successful small
query does not establish workload suitability or justify raising the timeout.

## Alternatives and tradeoffs

| Option                                               | What it can improve                                                                                            | What it does not establish                                                                                    | Work or constraints                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Existing PostgreSQL expiry cleanup and vacuum        | Reuse space left by expired rows; constrain retained growth without another service                            | Immediate file shrink, deletion of unexpired history, or lower billed capacity                                | Preserve daily cleanup and truthful backlog evidence; measure dead/live allocation and long transactions before changing maintenance |
| PostgreSQL payload compaction and index reduction    | Reduce retained bytes while keeping one transactional authority                                                | Every index is removable, or a smaller fixture proves production savings                                      | Audit constraints and readers, qualify online migration and rollback, measure lock time/WAL/temporary disk and serving latency       |
| PostgreSQL physical reclamation                      | Rebuild a bloated relation/index into a smaller allocation                                                     | Safe execution with current headroom, or a lasting cure for oversized live data                               | Fresh bloat/space evidence and a bounded operational plan; avoid an unplanned table rewrite                                          |
| ClickHouse history plus compact PostgreSQL authority | Separate analytical history/query load from serving storage; permit old payload/index retirement after cutover | Complete history under best-effort export, lower total cost, or removal of all PostgreSQL event-related state | Finish reader/retirement/privacy work, prove report capacity, obtain service access/configuration and price, then qualify deployment |

Standard PostgreSQL vacuum normally makes space reusable inside existing
files. `VACUUM FULL` rewrites the table, needs additional disk space and an
exclusive table lock. It is not an automatic follow-up to deleting rows.
See [PostgreSQL 18 vacuum guidance](https://www.postgresql.org/docs/18/routine-vacuuming.html).
`REINDEX CONCURRENTLY` avoids blocking ordinary writes but builds a replacement
index; qualification must account for its extra work and coexistence with the
old index. See [PostgreSQL 18 REINDEX](https://www.postgresql.org/docs/18/sql-reindex.html).

The separate local binary-digest experiment reduced the reindexed compact
representation from 18,038,784 to 15,507,456 bytes. Application compatibility,
throughput and migration safety were not qualified, and the fixture was
restored to hexadecimal digests. That is an option for investigation, not a
shipped saving. Reindex/page-packing changes must not be credited to the event
store migration.

## Cost and release decision

ClickHouse bills compute, storage and applicable data transfer separately.
Its public AWS us-east-1 examples include $159.66/month of always-active Basic
compute and $436.95/month for the illustrated two-replica Scale compute. These
are vendor examples, not a quote for the existing organization, region, tier,
discounts or workload. Continuous event ingestion also means an idle-service
example cannot be assumed. See the
[billing examples](https://clickhouse.com/docs/products/cloud/reference/billing/billing-overview)
and [public pricing](https://clickhouse.com/pricing), checked 28 October 2026.

The relevant comparison is the complete steady-state and migration cost:

```text
new operating cost = remaining PostgreSQL cost
                   + ClickHouse compute/storage/transfer cost
                   + operational maintenance cost

PostgreSQL allocation reduction = retired payload and index allocation
                               - replacement compact allocation
```

Temporary coexistence, backfill, WAL, index build space and backups are separate
migration costs. Lower PostgreSQL allocation reduces its bill only if the
provider's billed resources can actually be reduced. Moving data alone proves
neither a lower total bill nor returned filesystem space.

Organization access was declined pending this comparison. No dedicated service
configuration or actual organizational quote is available. Keep production
gates off, continue the existing PostgreSQL retention process, and finish local
correctness and compact-state qualification. Reassess the ClickHouse release
against a representative workload and total-cost comparison before provisioning
or retiring production history. PostgreSQL compaction remains a usable
alternative if that qualification does not pass; it is not cancelled by the
draft migration.

## Evidence locations

- [Migration specification](../plans/2026-10-28-recommendation-event-storage-spec.md)
- [Watch storage qualification](../roadmap/content-discovery/feat-892-watch-event-history-storage.md)
- [Report semantics and capacity](../roadmap/content-discovery/feat-894-recommendation-history-report-parity.md)
- [Release qualification](../roadmap/content-discovery/feat-896-recommendation-history-release-verification.md)
- [Existing storage and physical recovery guidance](../solutions/best-practices/recommendation-storage-semantic-and-physical-proof-20260930.md)
