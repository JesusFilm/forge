---
title: "Remove retired recommendation schema after a compatible runtime release"
date: "2026-10-30"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "recommendation_retention"
severity: "high"
root_cause: "hidden_runtime_and_trigger_dependencies"
resolution_type: "compatibility_release"
tags: [recommendations, postgres, migrations, retirement, testing]
---

# Empty tables still have runtime dependencies

Feat-902 drained the behavioral recommendation rows, but the application still
had profile/co-watch queries in retention, privacy, recent context, dormant
operators and workflow replay. Retained playback and eligibility tables also
had triggers that queried the retired tables. Deleting only the Prisma models
or dropping the empty tables would leave these dependencies broken.

Admin runs migrations before replacement applications start. Use the two
releases in `docs/plans/2026-10-30-001-retired-behavioral-schema-removal-plan.md`:

1. Remove application dependencies while preserving the old schema. Keep
   database-free compatibility responses and registered replay tombstones.
   Verify the actual source of every HTTP and worker replica.
2. Recheck emptiness, detached references, terminal workflows and the live
   catalog, then remove the exact schema set in a forward migration. After
   this point, the preceding compatible runtime is the oldest safe code
   rollback target.

The schema migration uses explicit names and `RESTRICT`. It removes six
co-watch triggers on retained tables and replaces the composition/study
guards before dropping the 19 tables. Historical scalar provenance, retained
integrity checks and the behavioral-retirement receipt ledger survive.

## Bound the whole lock interval

A per-statement timeout alone does not bound how long a transaction holds
locks across multiple admission queries and DDL statements. Migration 0165
caps the whole transaction before acquiring table locks, keeps the shorter
lock timeout, and preserves a stricter existing transaction timer.

On the tested PostgreSQL 18.6 server, changing an already-active positive
`transaction_timeout` did not reschedule its timer. Replacing a looser timer
therefore required disabling it and enabling the five-second timer before
table locks. Do not extend a stricter existing timer.

The local cumulative-stall proof injected two three-second statements after
locks. Each was below the statement timeout, but together they exceeded the
transaction cap. PostgreSQL terminated the transaction with `25P04` at about
five seconds, rolled back and released the waiting retained writer. A warm
121.8 MB dead-page fixture completed the unchanged migration with a final
rollback in 94 ms. Neither observation establishes cold production latency.

Workflow admission also needs a write fence. The migration holds `SHARE`
locks on the durable ledger and existing runtime table through commit before
checking terminal state. These locks do not make old binaries safe: the
external all-replica compatibility check remains necessary.

## Preserve retained regression coverage

Retirement-themed test files can contain tests for behavior that survives.
`migration.lifecycle.db.test.ts` includes raw-data cascades, trace-access
detachment, content actions, immutable playback and eligibility revisions.
The old standalone suite also covered partial commits, budget yields,
precomputed archive ordering and capped backlog health. Preserve those cases
while removing retired profile fixtures.

Native tests found that removing `scoped_sessions` from the recent-context
query left a shared playback CTE referring to it. A current-session-only CTE
keeps that dependency valid without restoring cross-session profiles. Keep
its original authorization start: the shared playback query applies its own
recent-fact window, including recent facts on older episodes.

Prisma relation includes are runtime dependencies too. The playback selection
and evidence handlers included the retired profile relation even though they
only needed the experiment. Audit relation includes as well as model delegates
and raw table names, then regenerate the post-drop client and typecheck.

The retired study-lifecycle suite enrolled profile cohorts and published
behavioral calibration; its preparation entry point already refuses new work.
Remove those obsolete positive tests and co-watch trial-retention fixtures.
Keep retained study source-fence and immutability proofs in the populated
schema-migration suite, and keep current precomputed A/B delivery/click tests
without creating retired consent/profile rows.

Workflow source and its build verifier must change together. Compiling a
tombstone is insufficient if the mandatory generated-manifest verifier still
requires deleted steps. Validate the actual generated workflow and step
entries. Derive future fixture expiries from the fixture clock rather than a
calendar date that will eventually pass.

Keep these evidence boundaries explicit: row deletion, relation allocation
and filesystem headroom are separate observations; a budget yield does not
advance the success watermark; schema retirement does not establish a fix
for an independently observed retention timeout.
