---
title: "fix: Attribute and resolve remaining Watch API stalls"
type: fix
status: active
date: "2026-09-18"
---

## Scope

Continue feat-496 from freshly fetched `a64f651353c06f9d58917983e0a94603e9995fca`
in the owned `codex/feat-496-api-stalls-20260918-q7v` worktree. Resolve the
remaining demonstrated selection HTTP 503 and HTTP 200 `delivery_timeout`
failures through a reproduced cause, minimal fix, normal PR/main deployment and
separate production acceptance. No other active task or open PR owns this scope
at intake; preserve all other worktrees and local services.

## Known facts and rejected shortcuts

The prior live observer measured a ten-connection main Prisma pool, acquisition
waits up to 741 ms and more than 100 pending waiters. Independent PostgreSQL
sampling observed advisory-lock waits and transactions waiting for application
work. Neither observation identifies the workload filling the pool. Individual
Prisma image-derivative spans are not SQL counts: the pinned client batches
identical-shape `findUnique` calls. Runner isolation and cold-profiler fixes are
already deployed and must not be re-proposed as the remaining cause.

## Investigation and causal gate

1. Verify actual deployed revisions, current HTTP populations and sampled
   selection/delivery traces. Retained traces and short healthy windows are not
   absence evidence. Preserve fallback-body outcomes separately from HTTP codes.
2. Attribute connection acquisition, lease occupancy and query completion
   independently. Link leases to bounded sanitized query fingerprints and
   backend PIDs; use a separate read-only database sampler to distinguish
   execution/locks from application idle time. Record diagnostic overhead and
   restore all wrappers/listeners/inspectors with a bounded cleanup guard.
3. Form a workload-specific hypothesis from those observations and state a
   falsifiable prediction. Reproduce it with the actual pinned Prisma/pg stack,
   owned local database, representative data cardinality and concurrency, plus
   an independent small-transaction/selection probe. Test alternative causes;
   do not infer SQL fan-out from ORM span counts.
4. Make one demonstrated correction. Preserve mutation commit acknowledgment,
   live eligibility, identity, authorization, attribution and database integrity.
   Use regression and performance controls that fail before and pass after.

## Release and acceptance

Use Compound Engineering plan/work/review/compound, with sequential review under
the repository tool mapping. Run touched tests, real PostgreSQL coverage, types,
lint, build, schema checks if applicable and formatting. Fetch newer main and
rerun relevant checks before normal squash PR/main merge. Verify the executing
revision and installed correction, then monitor meaningful workload overlap.
Record HTTP failures, semantic fallbacks, acknowledgment validity/aborts and
browser errors separately; leave feat-496 open if the demonstrated failure
remains. Document durable learnings and all residual uncertainty.

No larger deadlines, larger connection budgets, ambiguous mutation retries,
hidden errors or disabled profiling/telemetry. Selection does not use Redis
admission. Keep the authored English homepage block removed and
`forge.watch.homepageRecommendations` default off. No Mobile/TV UI, account
linking or curation republishing. No local-code deployment or manual production
redeploy. No shared database/service mutations without ownership verification.
