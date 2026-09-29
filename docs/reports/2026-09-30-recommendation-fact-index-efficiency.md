# Recommendation fact index efficiency, 2026-09-30

## Shipped migration candidate

`0115_recommendation_fact_duplicate_constraints` drops the unique indexes
behind `recommendation_render_event_key` and
`recommendation_impression_event_key`. In both tables, `capability_jti` is
non-null and already individually unique. Thus each removed composite
constraint enforces no additional row identity. Neither is an FK target, and
application lookup/replay uses the individually unique `item_id`. The migration
keeps primary identity, capability and item uniqueness, request lookup, expiry,
and request/item lineage constraints. It has a two-second lock acquisition
bound and rolls back both drops if either lock is unavailable.

The live catalog observation supplied to this work measured the rendered
composite index at **125.70 MB**. That is a potential production relation-byte
reduction for that index after the migration commits; the impression composite
index adds further benefit, but its production size was not supplied here.
These are allocated index bytes, not a measured filesystem recovery or a
steady-state growth forecast. The parent release must record actual relation,
WAL, and filesystem values after deployment.

The `request_id,item_id` composites are also logically implied by the unique
`item_id`, but Prisma 6.19.3 rejects the schema without them: the relation is
one-to-one on the composite request/item FK, and Prisma requires matching
composite uniqueness on the defining side. We therefore retain both indexes
and the existing `requestId_itemId` reader selector. Dropping them only in SQL
would leave schema and generated client out of alignment.

## Native database validation

On an isolated PostgreSQL database migrated from `0001` through `0115`, the
focused DB test inserted real request, item, render, and impression rows. It
confirmed that a second fact for one item and a second item for one capability
both fail with `23505`; mismatched request/item lineage fails with `23503`;
legacy two-column request/item lookup returns the same fact; request cascade
deletes both facts; and request, item, capability, and expiry indexes remain.
Prisma generation completed after the schema change. This proves constraint
behavior on a disposable database, not production lock availability.

## Watch exposure candidate, deferred

On PostgreSQL 18.6, in the task-owned `forge_storage_indexes` database, a
480,000-row Watch exposure fixture (160,000 windows, three event kinds per
window, varying item paths with 80-character path components), the current
eight-column `watch_surface_exposure_window_item_idx` occupied
**105,963,520 bytes**. A six-column `(window_id, surface, block,
presentation, placement, position)` candidate occupied **24,944,640 bytes**,
an **81,018,880-byte / 76.5%** reduction. Exact item and window lookups
remained index-backed, filtering two sibling events by `item_path` and `kind`.
The full-window cohort scan still used a sequential scan. A timed ordinary
`CREATE INDEX` of the wide key took **1,812.208 ms** and advanced WAL by
**94,682,080 bytes** on this local fixture. A timed ordinary create of the
narrow key took **754.502 ms**. The wide lookup plan used five shared-page
reads; the narrow one used one shared-page hit and three reads while filtering
two sibling rows. Individual `EXPLAIN ANALYZE`
execution times varied with cache state, so this is plan and storage evidence,
not a latency improvement claim.

The candidate is **not** in this migration. Ordinary `CREATE INDEX` blocks
writes, and `CONCURRENTLY` cannot run inside the repository's transactional
Prisma migration pattern. The local build time does not establish a safe
bounded lock on the live table. A follow-up should measure production row
count, write rate, relation size, representative exact/window query latency,
and an explicit lock budget before replacing the index. No production data was
changed in this work.
