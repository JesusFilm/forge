---
module: Manager subtitle artifact review
date: 2026-10-24
problem_type: security_issue
component: service_layer
tags: [manager, admin, artifacts, concurrency, subtitle-editor]
---

Review metadata and object bytes must share an acknowledged identity. A
service-local queue does not coordinate multiple Manager processes. The Admin
conditional mutation compares the entire observed artifact manifest and asset
identity in one Prisma update. Retry after a failed comparison with a fresh
manifest. Ordinary artifact updates lock the same row and preserve review-owned
entries; they cannot restore stale launch-consumption or revision state.

Reviewed names retain their historical prefix and add job/request hashes.
Create objects conditionally, verify bytes on collisions and ambiguous writes,
and re-read metadata after ambiguous persistence. Never replace an existing
object to recover from a metadata failure. Generated names and old reviews
remain readable; no object migration or deletion is required.

Save IDs acknowledge equal content, base, actor, source and session only.
The browser clears dirty state only for the acknowledged submitted snapshot.
Initialization owns a retained exchange/bootstrap promise independently of
viewport subscriptions, including React StrictMode cleanup. A failed bootstrap
retains the exchanged capability for retry rather than reusing a consumed code.

See `docs/plans/2026-10-24-pr752-subtitle-review-integrity.md` for this repair's
scope. Offline injected-Prisma tests establish application behavior and query
predicates; they do not qualify PostgreSQL engine behavior. Keep publication and
feature completion separate from this local repair.

A mounted editor can receive a different launch without remounting. Clear its
active capability/base/save intent at that boundary and keep any old dirty text
in a separate copyable, read-only draft until explicitly discarded. A successful
bootstrap owner, rather than the mere presence of old bootstrap data, admits
save. Reload may retry only the current launch's exchanged token. Every pending
save/reload response must still belong to the current owner before applying it.
Equal base bytes across jobs do not establish common draft ownership.

Scarce limiter keys need an admission proof. Reserve verified-job buckets only
after matching an unconsumed, unexpired launch. Rejected inputs share a separate
fixed hash-slot cache; collisions may throttle failures but cannot reject a valid
new capability. Cache an exact rejected request digest to refuse repeated bad
requests before another job read. Both caches expire, remain bounded at 1024
entries each and retain ten-attempt windows. Varied invalid codes still require
job validation; these local controls do not qualify deployed ingress/DB capacity.
