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
