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

| Check                                                                 | Result                 |
| --------------------------------------------------------------------- | ---------------------- |
| Admin recommendation unit tests                                       | 552 passed in 66 files |
| Real PostgreSQL episode, profile, projection and recent-context tests | 46 passed in 4 files   |
| Web recommendation/player tests                                       | 119 passed in 9 files  |
| Admin typecheck                                                       | Passed                 |
| ESLint for changed Admin TypeScript                                   | Passed                 |

Commands run from the worktree root:

```bash
pnpm --filter @forge/admin test -- src/services/recommendations --exclude '**/*.db.test.ts' --silent
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/web test -- src/components/recommendations --silent
```

Database verification used a disposable local PostgreSQL 18 container with
pgvector, not a production database:

```bash
RECOMMENDATION_DB_TEST=1 DATABASE_URL="$LOCAL_TEST_DATABASE_URL" \
  pnpm --filter @forge/admin test -- \
  src/services/recommendations/playback-episode.db.test.ts \
  src/services/recommendations/profile.service.db.test.ts \
  src/services/recommendations/profiles/profile-projection.service.db.test.ts \
  src/services/recommendations/recent-context.db.test.ts --silent
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

## Review

Sequential review covered correctness, API compatibility, authorization/reset
boundaries, query bounds, fallback reliability and test coverage. Optional
curated retrieval now preserves a complete eligible profile reserve on failure.
History-read failure remains explicit rather than silently discarding feedback.
No unresolved findings remain in the implementation scope.

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
