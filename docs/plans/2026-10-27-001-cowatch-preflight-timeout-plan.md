# Co-watch preflight timeout follow-up

## Problem and evidence

The October 7 G9 owner release was revoked after one of its captured source
eligibility decisions changed. During October 19–26 UTC, automatic refresh
recorded 13 `refresh_preflight_unavailable` refusals and one explicit source
overflow, with no replacement publication. The unavailable attempts took roughly
five to six seconds, consistent with (but not proof of) the current five-second
SQL statement limit. No Co-watch cards were served in that week. The generic
failure code hides the exact preflight exception.

## Change

Remove the five-second per-statement limit from both graph preflight and
publication. Publication repeats the source read, so changing preflight alone
would likely move the same failure to publication. Both remain inside existing
30-second transactions; preflight remains read-only. Keep the one-second lock
limit, exact seven-day source scope, 50,000 raw-source limit, pair/work bounds,
capacity admission and retry throttle. Do not change live request deadlines,
eligibility invalidation or owner authorization. The same bounded graph helpers
also serve the manual operator, so update its documented execution budget.

## Verification

Run focused native PostgreSQL Co-watch preflight/refresh tests, lint, typecheck
and format checks. Verify the 30-second transaction deadline and one-second
lock bound remain in code. Review the diff for privacy, retention and source
bounds. Open a scoped PR. After normal merge/deployment, compare fresh refresh
attempts and actual served provenance; a green local test alone does not prove
the production preflight now succeeds. Source overflow is a separate refusal
and is not expected to be fixed by this change.
