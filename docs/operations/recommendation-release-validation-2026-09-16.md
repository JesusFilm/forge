# Recommendation release validation — September 16, 2026

## Scope and conclusion

Release branch `codex/recommendation-quality-feedback`, reviewed against main
`fcf5b869dcf1beacb1b297bdc6f21568279616e2`, includes source-neutral recent playback
(feat-503), unknown-preference exit observations (feat-504), shadow composition
preparation (feat-393), and the offline usefulness evaluator (feat-505).

The regression demonstrates that recent direct/search plays lose priority when
six fresh candidates exist, while sparse rows can still refill. Immediate exits
retain diagnostic evidence with unknown preference and no ranking influence.
It does not establish a causal improvement in viewer usefulness. Feat-370, 393
and 505 retain their documented outstanding gates; locale coverage feat-471 is
excluded.

## Regression evidence

| Check                                                                             | Result                                                           |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Full Admin suite after migration fix                                              | 7,201 passed; 277 skipped; one todo                              |
| Full Web suite                                                                    | 4,370 passed; eight skipped; one todo                            |
| Recommendation services with real PostgreSQL and deterministic retrieval fixtures | 557 passed; two Redis cases skipped                              |
| Additional review regressions                                                     | Web route 29, offline evaluator 10, real-DB episode eight passed |
| Admin and Web production builds                                                   | Passed                                                           |
| Admin and Web full type checks and lint                                           | Passed                                                           |
| Admin SDL and generated typed-client drift                                        | No drift                                                         |
| Fresh Prisma migration chain and repeat deploy                                    | 97 migrations applied; second run had no pending migrations      |
| Migration safety guard                                                            | Five passed                                                      |

Database cases use isolated schemas in a task-owned disposable PostgreSQL 18
instance. New direct/search integration cases bridge stored authorized episodes,
the real recent-context reader and the actual candidate pipeline. They check
fresh-first ordering, permitted refill and current-video exclusion. Existing
cases exercise reset, revoked/expired links, client clock skew, late/conflicted
facts, source attribution and count bounds.

The review added exact route forwarding coverage for all three optional event
families, a 21-episode test proving the newest-20 Admin sample cap, and a failed
operational guardrail overriding an otherwise improving offline result.

## Browser and loading regression

`ce-test-browser` used an isolated agent-browser Chromium session with the actual
React recorder and native HTML video events. The HTTP episode service and media
were synthetic. Five fresh loads per revision compared the reviewed main base
with this branch:

| Measure                   |         Main |      Release |
| ------------------------- | -----------: | -----------: |
| Median DOM content loaded |      29.4 ms |      27.4 ms |
| Maximum initial long task |         0 ms |         0 ms |
| Gzip fixture bundle       | 64,611 bytes | 65,297 bytes |

The fixture passed pre-start route exit, short native playback followed by route
exit, zero terminal events after a duration update, and real back/forward-cache
suspension without a terminal event. Terminal transport may replay an identical
fact; server idempotency is separately covered by real-DB tests. These small local
measurements detect obvious loading regressions, not production speed changes.

See [browser results](../validation/recommendation-release-2026-09-16/browser-results.json)
and the existing [Admin desktop/mobile evidence](../validation/feat-504-playback-observations/README.md).

## Compound Engineering review

Completed lenses: correctness, testing, maintainability, project standards,
learnings, security, performance, API contracts, migrations, deployment,
reliability, adversarial, TypeScript, frontend races and agent access.

Fixed before release:

1. Full-suite migration safety failure: replace forbidden concurrent index DDL
   with the repository's transaction-compatible migration shape.
2. Three missing regression scenarios described above.
3. Roadmap index dates lost when generated under Pacific/Auckland: regenerate
   with `TZ=UTC`, restoring dates and overdue counts.

No actionable findings remain. One advisory remains: structured agent access to
new diagnostic fields would complement their existing protected Admin HTML
surface. It does not affect playback, delivery or the JSON offline evaluator.

## Index rollout and recovery

The production snapshot had approximately 111,148 live episode rows and a 43.4 MiB
heap, with no table locks or transactions older than 30 seconds at inspection.
A larger local fixture (150,000 rows, 68.9 MiB heap) built the new index in
354/387/348 ms. A held writer lock caused the corrected migration to fail with
`55P03` after 2,002 ms; it succeeded after the lock was released. See
[index measurements](../validation/recommendation-release-2026-09-16/index-benchmark.json).

The ordinary index build briefly blocks writes. Migration 0096 limits lock wait
to two seconds and the statement to fifteen seconds. A local benchmark cannot
guarantee production duration. The normal Admin pre-deploy migration runs before
its new application instance is promoted.

After normal PR-to-main deployment, require:

- Web and Admin active deployments at the merged revision with successful health
  checks; no direct worktree deployment or manual Railway redeploy.
- `_prisma_migrations` has a completed, non-rolled-back
  `0096_recommendation_recent_episode_index` row.
- The index is ready and valid, with exact keys
  `(session_digest, created_at DESC, id DESC)`.
- Playback acceptance, recommendation fill/timeouts, and error rates remain
  comparable to the baseline. Observe actual optional facts and run the For you
  playback journey in an isolated anonymous browser session.

If migration 0096 fails, deployment is blocked. The migration wrapper does not
recover this migration automatically. Inspect migration logs and the index
catalog, clear the lock/resource cause, then explicitly resolve that failed
migration as rolled back before retrying via the normal release flow:

```sh
pnpm --filter @forge/admin exec prisma migrate resolve --rolled-back 0096_recommendation_recent_episode_index
```

This is a recovery instruction, not a command executed during validation. Verify
catalog state before resolution; an unexpected same-named index must be inspected
rather than assumed equivalent. Application rollback uses a normal revert PR;
the additive index can remain.

## Production baseline and interpretation

Fixed September 15, 20:00–21:00 UTC: 7,462 requests to the exact recommendation
endpoints, one selection HTTP 503 (0.0134%), and zero playback 5xx across 2,610
playback requests. Matching Web/Admin logs reported 1,561 accepted facts.

A bounded latest-200 personalized request sample in the preceding daily window
contained 109 profile repeat cards across 76 requests and three semantic repeat
cards across three requests. All matched qualified viewing learned outside
recommendations. Only five records were actual recency rejections; 85 were refill
or position movement. These categories cannot be treated as equivalent, and
request groups can overlap.

The durable request table omits failed deliveries. Five source-free delivery
timeouts occurred in the daily baseline on older revisions, so 45 stored For you
requests cannot be reported as 45/45 delivery availability. Post-release checks
must reconcile HTTP failures with durable evidence and distinguish this release
from concurrent deployments. A short smoke window proves behavior and initial
health; a mature controlled evaluation is still required to claim usefulness.
