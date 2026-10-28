---
status: accepted
date: 2026-10-28
---

# Separate recommendation event history from serving state

Move recommendation and Watch history to a dedicated Forge ClickHouse service.
Keep compact operational authority and derived recommendation state in serving
PostgreSQL. Preserve original expiry, privacy, playback and current A/B controls;
backfill still-unexpired history.

The owner's latest 28 October direction is asynchronous best-effort delivery:
start a direct ClickHouse send, let the caller continue without awaiting it,
and measure failures. Automatic retries and queues are deferred. No PostgreSQL
forwarding payload is written on success or failure. Bound the background
attempt and in-flight memory. Necessary operational transactions still commit
before export starts.

This supersedes the earlier outbox, durable recovery and 24-hour buffering
decision. The undeployed prototype is removed; withdrawn requirements are not
claimed complete. Failed or crashed attempts may lose historical events, and
observed counters do not prove zero unobserved loss. Learning/reporting disclose
missing coverage. Erasure and operational admission remain reliable controls.

Continue serving valid derived results through event-store outages, subject to
current eligibility and viewer controls. Target five-minute incorporation of
successfully delivered eligibility-ready feedback, measuring delivery loss
separately. Keep immediate exclusions and complete operational playback facts
independent of potentially incomplete history.

Core has multiple patterns: its Journeys Plausible helper is nonblocking, while
its short-link ClickHouse path uses a background Cloudflare queue and retries.
Forge's one-attempt policy is the owner's selection. No purchase, cutover or
storage saving is established by this ADR; qualification and release remain in
the [specification](../plans/2026-10-28-recommendation-event-storage-spec.md).
