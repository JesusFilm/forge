---
status: accepted
date: 2026-10-28
---

# Separate recommendation event history from serving state

Move recommendation and Watch playback/exposure history to a primary ClickHouse
event store, and retain compact derived profiles, shared viewing relationships,
recommendation lists and necessary admission state for fast serving. The owner
selected this direction to remove raw-history storage and cleanup pressure from
the serving PostgreSQL database, including evidence from both A/B variants.
Unrelated product-event stores are outside this decision.

Learning targets incorporation of eligibility-ready feedback within five minutes
under normal operation. During an event-store outage, continue using valid
serving state while buffering new events durably. Existing expiry, profile
reset/deletion and content eligibility remain binding, including on cached state.
Migration and replay preserve recorded expiry rather than extending history.

The owner also selected a dedicated Forge ClickHouse service in the existing
organizational account, a bounded temporary PostgreSQL forwarding outbox, and
backfill of still-unexpired history. The outbox permits operational admission
and pending delivery to commit together; acknowledgement by a qualified durable
downstream queue permits its payload to leave PostgreSQL. Delivery retries run
in the background while valid recommendations continue serving. The owner set
a 24-hour outage tolerance target at measured peak traffic. It does not reset
event expiry or authorize dropping pending events at hour 24. Qualifying queue
technology, actual buffer/catch-up capacity and durability is engineering work;
pricing remains unresolved.

This trades immediate cross-store visibility and single-database transactions
for independent event retention and serving availability. Event admission,
deduplication, correction, erasure, queue capacity and migration reconciliation
need explicit contracts before implementation. Merely duplicating the permanent
event history into both databases would not meet the storage objective. No
deployment, service purchase or production cutover is recorded by this ADR;
the remaining decisions are in the
[specification](../plans/2026-10-28-recommendation-event-storage-spec.md).
