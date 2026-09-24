# feat-533: Shared short-watch feedback verification

Date: 2026-09-23. Baseline: `badb8cc2c` (`origin/main` when work began).
Branch: `codex/feat-533-short-watch-feedback`.

## Contract

- Both recommendation APIs read the same source-neutral playback facts. At least
  3,000 ms of accepted visible-playing intervals in an actual episode makes a
  video recently tried for a 24-hour server-receipt window.
- Fresh eligible choices precede recently tried choices. Homepage ordering is
  fresh profile, fresh curated, tried profile, tried curated. Recent candidates
  remain deterministic reserves when fresh supply is insufficient.
- Short-only evidence does not establish a lasting interest or dislike. Existing
  qualified-view and completion rules remain unchanged. Qualified playback from
  every origin can update profiles without selection/impression attribution.
- Changes affect the next API request, including pending finalization. They do
  not trigger an in-place refresh of an already-rendered row.
- No GraphQL schema, database migration, frontend code or deployment changed.

## Automated Verification

| Check                                                   | Result                                       |
| ------------------------------------------------------- | -------------------------------------------- |
| Full Admin non-database tests                           | 7,324 passed in 451 files; 2 skipped, 1 todo |
| Real PostgreSQL recommendation integration tests        | 61 passed in 7 files                         |
| Web recommendation/player tests                         | 119 passed in 9 files                        |
| Admin typecheck                                         | Passed                                       |
| ESLint for changed Admin TypeScript                     | Passed                                       |
| Admin production build and workflow registration checks | Passed                                       |
| Admin GraphQL schema drift                              | No drift                                     |

Commands run from the worktree root:

```bash
pnpm --filter @forge/admin test -- --exclude '**/*.db.test.ts' --silent
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/web test -- src/components/recommendations --silent
pnpm --filter @forge/admin schema:print
```

The production build used the disposable local database and non-production auth
configuration. Existing Edge Runtime/workspace-root tracing warnings were emitted;
compilation, TypeScript, static generation and workflow verifiers succeeded. An
earlier concurrent test/build run hit unrelated test timeouts; two standalone full
Admin reruns passed without changing those tests.

Database verification used a disposable local PostgreSQL 18 container with
pgvector, not a production database:

```bash
RECOMMENDATION_DB_TEST=1 RECOMMENDATION_PROFILE_DB_FIXTURE=deterministic \
RECOMMENDATION_DELIVERY_DB_FIXTURE=deterministic DATABASE_URL="$LOCAL_TEST_DATABASE_URL" \
  pnpm --filter @forge/admin test -- \
  src/services/recommendations/playback-episode.db.test.ts \
  src/services/recommendations/profile.service.db.test.ts \
  src/services/recommendations/profiles/profile-projection.service.db.test.ts \
  src/services/recommendations/recent-context.db.test.ts \
  src/services/recommendations/delivery-persistence.db.test.ts \
  src/services/recommendations/candidates/profile-candidate.db.test.ts \
  src/services/recommendations/delivery-retriever.db.test.ts \
  --no-file-parallelism --silent
```

The database suites verify all six origins (direct, search, share, acquisition,
editorial and recommendation) through actual episode claim, accepted facts,
history reads, outcome finalization and profile publication. Recommendation
selection deliberately lacks an attributed impression. A 20-second watch affects
both history readers before finalization; a subsequent qualified watch produces
a durable interest and related candidate retrieval.

Coverage also includes 2,999/3,000 ms boundaries, overlapping and contiguous
intervals, start-only and preview-only episodes, exact 24-hour expiry, expired
facts, authorization/link boundaries, privacy reset, foreign sessions, late or
conflicting evidence, canonical duplicates, repeated reads, full fresh supply,
sparse reserve refill and delivery fallbacks. Existing Web tests exercise player
recording and recommendation-client lifecycles; they are not a manual browser
reproduction of the reporting viewer's production session.

## Query Cost

The recent-context database suite ran 25 samples per reader with 10,000 unrelated
episodes and checked both query plans for
`recommendation_episode_session_created_idx`.

| Local history query         | Median   | p95      | EXPLAIN execution |
| --------------------------- | -------- | -------- | ----------------- |
| Below-player recent context | 2.973 ms | 6.452 ms | 1.530 ms          |
| Homepage watch history      | 1.373 ms | 4.522 ms | 0.425 ms          |

These are local query measurements, not production end-to-end delivery latency.
Root work remains bounded to eight authorized sessions and 32 episodes per
session before joining facts. Existing delivery deadline tests remain green.
No new browser initialization, hydration, rendering or media code was introduced.

The release review added a near-bound fixture: eight authorized sessions, 32
selected roots per session and 128 facts per episode, plus an excluded oldest
root. It exposed repeated start/late-evidence probes after fact fanout. Moving
unchanged integrity predicates into `validated_recent_episodes AS MATERIALIZED`
reduced their loops from 32,512 to at most 256. Measured EXPLAIN execution fell
from 3,480.794 ms to approximately 196 ms without changing evidence semantics.

| Near-bound history query | Median     | p95        | EXPLAIN execution |
| ------------------------ | ---------- | ---------- | ----------------- |
| Below-player             | 198.747 ms | 219.643 ms | 196.103 ms        |
| Homepage                 | 190.540 ms | 216.373 ms | 197.514 ms        |

These 25-sample measurements use the real retrieval transaction, including its
existing `force_custom_plan` policy. Direct prepared-query calls switched to
slower generic plans after five calls and were not representative of production.
The regression asserts root limits, indexed access and integrity-probe loop
bounds, not machine-dependent latency. Measurements remain local, not production
load guarantees.

## Review

The release review uses the full Compound Engineering reviewer set and independent
validation of actionable findings. The first round found optional-work deadline
starvation, last-known-good recovery bypassing freshness, lost localized-title
identity in curated reserves, and a missing pending-history timeout regression.
Each received a targeted fix/test. The next round identified the authorization
variant of deadline starvation; seeded authorization now uses the homepage's
existing 450 ms budget, retaining same-session context after authority timeout
without accepting a late authority result. The near-bound database test also
prompted the query-plan fix above. Both full rounds used 12 applicable reviewers;
an independent validator confirmed each actionable review finding. A third,
focused correctness/adversarial pass rechecked the last fixes with no findings.
No implementation findings remain unresolved. GitHub CI and post-deploy checks
remain release gates; review does not provide a numerical correctness guarantee.

## Compound And Refresh

Full Compound Engineering pass, using this task and repository learnings only;
no prior Codex session history was searched. A bounded GitHub issue search for
`recommendation short watch` returned no matches. The roadmap ticket is the
local issue record.

### Applied

- Updated the canonical
  [source-neutral playback learning](../solutions/logic-errors/source-neutral-playback-recent-history-20260915.md)
  instead of duplicating it. High overlap covered the problem, source-neutral
  evidence approach, files and prevention rules. Preserved its authorization,
  buffered-clock and bounded-query lessons while adding the verified short-watch
  contract and all-origin profile contribution rules.
- Refreshed the
  [profile/curated reserve pattern](../solutions/architecture-patterns/source-free-recommendations-profile-first-curated-reserves-20260910.md):
  profile-first remains valid within freshness tiers, not across all candidates.
- Refreshed the affected handoff in the
  [production boundary pattern](../solutions/architecture-patterns/production-recommendation-boundary-hardening-pattern.md)
  to assert actual active playback and `recently_tried`, not a bare start.
- Synchronized the [operations contract](../operations/user-recommendations.md).
  Existing selection-attribution receipt-ordering guidance remains valid for
  click-only evidence and was retained without edits.
- Existing root agent instructions already identify `docs/solutions/`, its
  frontmatter/category organization and when to search it. No instruction-file
  edit, deletion or additional duplicate learning was needed.

### Recommended

No remaining documentation maintenance in this scope. After the normal reviewed
PR-to-main release, run a real-browser smoke: record the homepage API list, watch
20 seconds of a recommended video, return and reload, and inspect both homepage
and below-player API results. Repeat with a non-recommendation entry point.
Verify a fresh alternative or lower placement when supply is constrained.
This production/browser smoke and end-to-end production latency were not run
locally; there was no deployment or change to production activation.

## References

- [Plan](../plans/2026-09-23-001-feat-shared-short-watch-recommendations-plan.md)
- [Roadmap ticket](../roadmap/content-discovery/feat-533-consistent-short-watch-recommendation-feedback.md)
