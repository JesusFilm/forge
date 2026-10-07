# Keep request retention inside its existing deadline

## Evidence and limit

The first natural attempt on PR #2551's deployed ten-episode page committed ten
standalone episodes and nineteen direct actions, then failed at the unchanged
five-second deadline before deleting expired request roots. The exact failing
SQL statement was not captured. A bounded read-only production plan for the
request-root eligibility count's generated Prisma `LEFT JOIN ... OR` shape
scanned about 225,000 eligibility decisions and 336,000 outcomes in 329 ms.
The equivalent request-parent-driven `UNION` count took 2.55 ms for the same
oldest fifty expired roots. These reads do not measure locks or DELETE cost.

At the time of measurement, 222,421 decisions were outcome-linked, 3,349 were
selection-linked and none were content-action-linked. A missing
`content_action_id` index is a future FK/query concern, but adding an online
index is not required by this observed cohort. The request backlog and serving
health still need natural-release proof.

## Change

- Replace only the expensive eligibility child count with parameterized SQL
  starting from request-indexed outcomes and actions, combining distinct
  decision IDs with `UNION`. Keep the remaining counts and deletion order.
- Preserve the ten-episode page, five-second whole-run deadline, 29-day
  expiry, advisory lock, 50,000-dependency cap and all eligibility checks.
- Do not change grouping, scheduler cadence, index DDL or production data on
  this evidence alone. Reassess if a native loaded test or release shows root
  deletion still starved.

## Proof and release

Use an owned loopback PostgreSQL fixture to prove both outcome and action
branches, unrelated selection decisions, durable child counts and request-root
deletion under a loaded standalone backlog. Compare old and new plans and
run native, unit, type, lint and format checks. Publish via a reviewed PR to
main. After actual Admin HTTP/worker convergence, inspect natural scheduled
attempts for request-root and descendant deletion, declining overdue backlog,
serving-gate restoration, WAL and headroom. Two later normal failure-free loaded
daily cycles remain necessary to close feat-554.
