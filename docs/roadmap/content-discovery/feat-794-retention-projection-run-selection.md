---
id: "feat-794"
title: "Select expired projection run links through reference indexes"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-10-27"
duration: 1
depends_on: []
blocks: []
tags: [recommendations, retention, postgres, performance]
---

## Problem

The October 27 r2930-w03 second pass failed in projection_run_unlink_page
with P2028 after admitting 881 ms, preserving 100 committed roots. The phase
contains selection and update; the exact failing statement is unknown. A
read-only selection analogue scanned 43,725 run rows for one eligible link.
This later phase is outside feat-793's root-only admission protection.

## Scope

Add a focused projection-run link selector/helper beside retention-decision-links.ts
and integrate it into retention.service.ts. Select nonempty expired parents
through existing expiry/reference indexes, then at most the existing page size
of exact run/reference pairs. Recheck reference identity and parent stored expiry
when unlinking in the same phase transaction. Preserve locks, five-second budget,
root admission, counters, failure handling and honest continuation. Empty expired
parents must not hide later eligible links. Empty-parent probes remain linear in
expired parents examined; a page limit is not a total work bound.

## Verification

Native PostgreSQL: sparse eligible references, empty-parent prefixes, high fan-out,
live generations, reassigned references, deduplication and committed paging.
Capture and explain the actual parameterized helper query. Compare old/new work
on identical local data with alternating trials. Retain full retention composition
and focused service tests, CI runner timeout settings, full Admin typecheck,
lint, formatting and normal hooks. Selector-only plans and shared production CPU
proxies do not prove full-invocation or production CPU efficiency. Feat-554's
remaining qualifying daily cycle is separate; manual passes add zero credit.

## Entry points

- `apps/admin/src/services/recommendations/retention-projection-run-links.ts`:
  `selectExpiredProjectionRunLinks` and `unlinkExpiredProjectionRunLinks`.
- `apps/admin/src/services/recommendations/retention.service.ts`:
  `projection_run_unlink_page`, `expiredRunLinkPage`, `batchLimitReached`.
- `apps/admin/src/services/recommendations/retention-projection-run-links.db.test.ts`:
  real PostgreSQL plans, committed paging and concurrent reference guards.
- `.github/workflows/ci.yml`: include the native file in the existing loaded
  standalone-retention step with `--no-file-parallelism --testTimeout=60000`.

## Local evidence and limitations

Six alternating trials per query on identical fixtures captured the actual
Prisma relation query and the actual parameterized helper query. Sparse links
reduced run-heap visits from 50,007 to seven, with median selector time from
135.099 ms to 4.855 ms. High fan-out reduced run-heap visits from 50,100 to 100,
with median time from 139.758 ms to 6.821 ms. These are local selector-only
measurements; temporary tables use local buffers, and other validation was
running on the host. No full-invocation or production CPU gain is established.

The 100,000-empty-parent fixture is a real adverse case: the new query examines
all expired parents and took a median 303.414 ms versus 153.544 ms for the old
query. It still returns later eligible references rather than falsely reporting
an empty page. A finite cohort drains as each committed page removes links;
there is no guarantee against continuous concurrent creation of earlier work.
Do not introduce a bounded parent search that silently hides later references.

The production P2028 was recorded inside a phase containing both selection and
update; its exact failed statement and server-versus-client timer attribution
remain unknown. The failed pass's 100 committed roots remain counted. This repair
uses existing indexes, preserves the root-only observed-cost correction and
five-second deadline, and does not authorize production cleanup or satisfy the
remaining feat-554 daily cycle.

## Validation result

91 focused tests and 44 native PostgreSQL tests passed, including the existing
standalone, profile-tail and composition suites. Full Admin typechecking covered
1,680 roots (758 tests) in four shards; full Admin ESLint and formatting passed.
The initial local native run used a nonfresh fixture database and attempted to
delete immutable fixture manifests; the fixture cleanup was corrected and the
owned databases recreated before the passing run. Typechecking also caught and
corrected a test-only mode argument shape. Production verification remains a
separate reviewed release and operational task.
