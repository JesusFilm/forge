# Watch profile audit — September 21, 2026

## Fresh current-pointer invariant

At **2026-09-20 21:52:32.710 UTC**, a complete read-only production audit checked
**167,029 live current pointers and found zero ineligible pointers**. It used one
repeatable-read snapshot, not independent pages or a sample. The production
Admin revision was `2fe115f075064669df9ece2f84022acc73ae9351`.

The predicate is the complete `profileLineageEligibleSql` expression in
`apps/admin/src/services/recommendations/profiles/profile-lineage.ts`, including
`profileContributionInvalidPredicateSql`. It retains version, contribution-count,
interest-support, current eligibility revision, scope, expiry, source watermark,
episode/selection attribution and conflict checks. Source SHA-256:
`2bdb3a2e4cdec3c878ebcea1207f1fc3d4b452c3a5f12c2b13dcd379882e7be3`.
Only pointers to published, unexpired generations enter the audit, matching the
Admin overview. All time predicates use the transaction snapshot timestamp.

The earlier aggregate audit exceeded its five-second statement guard. This audit
kept that guard and used a `NO SCROLL` cursor returning only one eligibility
boolean per pointer, fetched in batches of 2,000. There were 85 fetches, maximum
fetch time 320 ms, and 5,063 ms total execution. No profile, scope, generation,
source identifier or vector was returned.

Connection guards: read-only default, `statement_timeout=5000`, `lock_timeout=500`,
`idle_in_transaction_session_timeout=10000`, plus a 120-second overall client
deadline. The transaction used `SET LOCAL jit=off`, then explicitly rolled back
and closed its connection. No persistent setting changed. This method proves the
invariant; it does not establish why the earlier aggregate timed out, because
both execution strategy and JIT changed without a matched control.

For a repeat audit, bind the snapshot's `CURRENT_TIMESTAMP` into the canonical
Prisma SQL helpers, declare a cursor over that unchanged expression and the
published/unexpired pointer population, fetch through exhaustion, and report
`complete=true` only after the final empty fetch. Roll back and close on every
exit. Never substitute a limited sample, omit a lineage condition, or count a
cancelled partial scan as a passing invariant.

## Proven Admin hybrid-count defect

The overview's `cleanHybridRequests` subquery used `decision.lane = 'hybrid'`.
That value is absent from the database's allowed lane values. Current hybrid
deliveries have lane `profile_challenger` and execution mode
`hybrid_personalized`. Historic challenger assignments deliberately retain a
null execution mode, and viewing-mode personalization uses the same lane with a
different execution mode. Counting only the lane would misclassify those rows.

A bounded read-only query at **2026-09-20 22:02:47.178 UTC**, for the same
September 18 04:15–September 20 20:50 corpus window, found **3,508** unexpired
`hybrid_personalized` decisions with null reason. The old predicate counts zero.
These are request decisions, not unique viewers or proof of helpfulness.

The correction filters `execution_mode = 'hybrid_personalized'` and the valid
`profile_challenger` lane, retaining null reason, expiry and exact time-window
bounds. The lane filter retains access to the existing lane/time index. One
bounded production `EXPLAIN ANALYZE` sample completed the corrected count in
2.095 ms; this is an aggregate-query sample, not selection latency evidence.
It changes only the authorized
aggregate Admin evidence query. No lineage, privacy suppression, serving,
experiment assignment, ranking or learning rule changes.

A real PostgreSQL regression failed with zero before the fix and returns three
after it. It excludes a legacy challenger, a viewing-mode decision, an expired
decision and both out-of-window boundaries. The test uses the production
PrismaPg adapter and migration constraints in a disposable owned schema, and is
registered in the existing CI PostgreSQL job. Four existing overview tests pass,
including privacy suppression and invariant reporting. The full Admin suite
passed 7,279 tests (293 skipped, one todo); lint and typecheck passed. The final
lane/execution predicate passed the focused PostgreSQL and overview tests again.
Automatic deployment verification is pending.

## Closure limits

The fresh zero-pointer count clears the missing invariant evidence in the
September 21 review. It does not alone close feat-459 or feat-464. Their transport,
installed-alert and Admin/browser lifecycle gates remain separate. Datadog access
is read-only: the required alert definitions can be reviewed but cannot be
installed through that connection. No new notification destination was selected.

feat-447 still needs its complete browser lifecycle proof. The hybrid-count repair
does not provide that proof or authorize rollout. feat-496 still needs a causal
reproduction of the remaining selection latency and complete delivery outcomes.
