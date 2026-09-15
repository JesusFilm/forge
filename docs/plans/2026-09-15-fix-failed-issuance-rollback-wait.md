---
title: "Return known failed recommendation issuance without waiting for slow rollback"
type: fix
status: in-progress
date: 2026-09-15
roadmap: feat-496
---

## Evidence and scope

Primary-host trace `6aa8a5a80000000070cd728ca94d97f9` at 01:55:52 UTC shows
semantic recommendation issuance spending 1,065 ms inserting served items, then
2,294 ms awaiting ROLLBACK. Web aborts that Admin request after 3.5 seconds and
recovers through contextual fallback at 4.15 seconds. The helper awaits Prisma's
whole transaction promise even after its callback has failed and cannot commit.

Reproduce a failed callback followed by delayed rollback. Bound callback work to
the existing issuance deadline and return its known failure without awaiting
rollback completion; keep Prisma responsible for rollback and observe its final
promise. Never race successful commit acknowledgment against an outer timer:
the existing committed-ISSUED response guarantee must remain intact. Preserve
all transaction atomicity, API shapes, limits, flags and homepage publication.

## Verification

- Red/green delayed-rollback regression, operation deadline, rollback completion
  and no unhandled rejection, successful slow commit still reported as served.
- Real PostgreSQL atomic rollback after callback timeout and a delayed failed
  transaction acknowledgment, with no later request/item/audit writes.
- Scoped/full Admin checks, real database tests, build, sequential review,
  durable learning, normal PR/main deployment and fixed production observation.

## Evidence collected

The original delayed-rollback regression fails with a pending response; the fix
passes it and the callback-deadline case. The existing successful delayed commit
still returns `served`. Full Admin suite: 6,596 passed, 269 skipped, one todo.
All four tests in the existing real PostgreSQL curation/issuance entrypoint pass,
including prior-write rollback after the callback deadline. Types, scoped
lint and the production build pass. Sequential review found no unresolved correctness, data integrity,
reliability, API or standards findings. The fix merged as #2302 and deployed at 02:34:45 UTC. Release probes and
playback passed; the final observation is recorded in
`docs/operations/watch-runtime-recovery-2026-09-15.md`.
