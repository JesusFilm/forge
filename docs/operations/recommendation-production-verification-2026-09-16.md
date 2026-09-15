# Recommendation production verification — September 16, 2026

Release: [PR #2309](https://github.com/JesusFilm/forge/pull/2309), squash commit
`1981f1c5f77d57fabe720d76154b9c19238d6331`, merged September 15 at 21:46:46 UTC.
All PR checks, including `ci-gate` and CodeQL, passed. The merged commit's
`forge-ci` run also passed.

## Deployment

The release followed normal Railway autodeployment. No direct worktree deployment,
manual redeploy, flag changes, or content publication was performed.

At 22:09:05 UTC, Web, Admin and the Admin worker were each successful and the
sole active deployment of the exact merged revision.
[Deployment evidence](../validation/recommendation-release-2026-09-16/production/deployments.json)
records the three deployment IDs. The main-branch CodeQL run also passed; Web
built and promoted after that gate completed.
The [final deployment check](../validation/recommendation-release-2026-09-16/production/release-final-status.json)
at 22:22:06 UTC confirmed all three remained successful and solely active on the
same revision.

Migration 0096 completed at 21:53:34.713 UTC with one applied step and no rollback.
Read-only production inspection confirmed the index is ready and valid, with
exact keys `(session_digest, created_at DESC, id DESC)`.

## Settled production health window

The fixed window is **22:10–22:20 UTC**, after all three services were live.
Railway's primary Web HTTP logs cover all 1,072 recommendation-related requests,
with complete bounded paging: 621 HTTP 200 responses, 451 HTTP 4xx responses,
and **zero HTTP 5xx**. The denominator includes the isolated synthetic browser.
This is a ten-minute release check, not feat-464's two-hour acceptance canary.

Playback accounts for 426 requests: 334 HTTP 200, 90 HTTP 403, one HTTP 401,
and one HTTP 400. Across all routes there were 444 HTTP 403 responses and five
GET-evidence method rejections (405). Admission/authentication rejections remain
in the denominator; the HTTP 400 serialization failure is discussed separately
below and must not be hidden by the zero-5xx result.

Web and Admin agree on 278 accepted fact batches and one replay. Five facts
transaction-busy observations and one finalization transaction-busy observation
were first-attempt retries. The worker heartbeat was fresh; the bounded workflow
ledger contained 20 successful finalizations, 27 scheduled/running runs and no
recorded errors.

The 48 stored below-player requests produced 237 cards: 43 served requests,
three empty requests with `no_candidates`, and two with
`seed_embedding_unavailable`. There were no duplicate slates. Retrieval p95 was
315.45 ms (daily pre-release reference: 374.2 ms); the different cohorts and small
sample do not establish a performance improvement.

The 14 personalized requests contained 116 actual rejected candidate entries,
including 16 with `recent_playback_start` and 113 with `repeatedly_served`;
reason counts overlap. Eighty composed refill/movement entries are reported
separately. Three served recently qualified cards across two requests had both
actual suppression and refill/movement provenance. The policy permits refill;
the repair is not a blanket promise to eliminate all repeats.

For the 28 episodes created in the window, the read at 22:20:57 UTC found 296
facts, 14 starts, eight observation summaries, 44 navigation observations and 31
QoE observations, with no late facts or episode conflicts. Eight completed
active-watch outcomes had complete coverage; three qualified. The other episodes
were still immature, so this is not a completion or qualification rate.

See [complete primary HTTP accounting](../validation/recommendation-release-2026-09-16/production/http-settled.json)
and [bounded database aggregates](../validation/recommendation-release-2026-09-16/production/db-settled-health.json).

The [health summary](../validation/recommendation-release-2026-09-16/production/release-health-summary.json)
also preserves startup caveats. The active worker emitted the same embedding
prewarm warning seen before this release. A separate worker-tagged process
emitted 16 instrumentation-startup error logs during 21:59:17–21:59:49 UTC.
Those messages are absent from the exact active Railway worker's runtime log,
there was no second worker deployment, and the active heartbeat remained healthy.
The secondary process's provenance is unresolved; this report does not label
those messages harmless or claim every startup log was clean. No error-level
logs were observed in the settled window, but the serialization failure below
was logged at info level, so log severity alone is not the acceptance test.

## Recent direct playback is suppressed in live traffic

The first bounded new-Admin window, 21:54:57–22:00:00 UTC, contained eight
personalized requests and 48 composed cards. None of those served cards repeated
a recently qualified title under the existing diagnostic. There were 41 actual
rejected candidate entries: five for recent playback, three for recent selection,
and 33 for repeated serving. Separately, 39 composed entries recorded refill or
position movement; they are not counted as rejections.

All five `recent_playback_start` rejections matched retained, nonlate accepted
starts from **direct-origin episodes** in the same current session. None matched
recommendation-origin episodes, and none were unmatched. This verifies the newly
repaired source-neutral path in real production traffic. Queries bound request
roots and the latest 32 episodes per session and completed in approximately
430–458 ms including network overhead.

See [initial sample](../validation/recommendation-release-2026-09-16/production/recent-suppression-initial.json)
and [origin reconciliation](../validation/recommendation-release-2026-09-16/production/rejected-start-origins.json).
The eight-request sample is operational evidence of the mechanism, not a causal
usefulness or engagement estimate.

## Real production browser and profile checks

An isolated synthetic browser used the public Watch UI, the visible Watch now
control, and an ordinary in-app home link. Read-only verification used the actual
release's recent-context reader and observation projector against retained
production facts. Identifiers and credentials were kept out of these artifacts.
Both episodes finalized with one current authorized profile link, no conflicts or
late facts, complete active-time coverage, and a retained `recent_playback_start`
recognized in the profile's current-session recent context.

| Check                                 | Production result                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Longer foreground playback            | 42.436 seconds of active viewing; qualified outcome; one published durable profile contribution                                  |
| Pause/resume through visible controls | One pause and one resume retained; observation remains inconclusive about preference                                             |
| Immediate route exit                  | 1.143 seconds elapsed / 1.106 seconds active; `rapid_post_start_departure`; unknown cause and preference; no ranking influence   |
| Quick-exit profile effect             | Active-watch outcome unqualified; zero contributions from that episode; zero negative evidence in the current profile projection |
| Playback transport                    | All captured playback responses returned HTTP 200, including the quick-exit terminal delivery                                    |

The quick-exit case revisited the same video and resumed near media position
42 seconds. The legacy position-based diagnostic called it qualified, while the
active-watch classifier correctly rejected qualification based on 1.106 seconds
of actual viewing. The durable profile retained only the earlier long-watch
contribution. This is a useful regression check against confusing resumed media
position with new engagement; it does not claim a new preference interpretation.

See [long-watch evidence](../validation/recommendation-release-2026-09-16/production/own-long-watch.json)
and [quick-exit evidence](../validation/recommendation-release-2026-09-16/production/own-quick-exit.json).
The quick-exit destination was checked again after asynchronous navigation
settled at `/watch`; the immediate post-click URL alone was too early.
One seeded recommendation fetch failed at transport level during the immediate
navigation; no HTTP status was observed. Its cancellation cause was not captured,
so this is not counted as a successful fetch or inferred to be a server failure.

The synthetic browser's later requests did not nominate the watched title, so
those requests cannot prove rejection. The separate real-traffic reconciliation
above supplies that evidence. Two synthetic episodes validate mechanics, not
population-wide recommendation quality.

## For you remains intentionally disabled

The production availability endpoint returns HTTP 200 with `enabled=false` and
private/no-store caching. The English `watch-home` published experience contains
thirteen blocks and no `homepageRecommendations` block. Spanish
`ver-inicio`, served at `/watch/spanish-castilian.html`, contains that block in
position three, but the same availability gate keeps it disabled.

This matches the existing owner instruction in
[feat-496](../roadmap/platform/feat-496-watch-rollout-runtime-recovery.md):

> The authored English Homepage Recommendations Block stays removed per owner
> instruction. `forge.watch.homepageRecommendations` stays default off. Production
> targeting requires an LD server SDK key and authored block; do not substitute
> blanket enablement. Activation/curation ownership remains feat-487/feat-488.

These settings were preserved. A successful source-free API diagnostic or stored
request count does not prove a visible For you journey. The live For you playback
journey remains unverified while it is intentionally disabled. This release must
not be described as enabling the homepage row or proving its user usefulness.

## Pre-existing playback transport follow-up

At 22:15:51 UTC, one facts request encountered PostgreSQL SQLSTATE `40001`.
Admin logged a retryable failure, but Web returned terminal HTTP 400
`invalid_request`. The successful synthetic quick-exit test was a separate
request, already finalized at 22:15:15 UTC. Accepted production facts continued
the following second.

The fixed pre-release comparison, September 14 at 21:00 through September 15 at
21:00 UTC, contains 112 serialization-conflict log messages across ten older
Admin revisions, including 31 on the immediately previous Admin revision. It
also contains 25 terminal facts-400 observations across six older Web revisions.
These are log counts, not distinct incidents or a lost-view estimate. The
release did not change the retry classifier, which recognizes `P2034`; the
observed raw-query SQLSTATE `40001` failure escaped it. The exact Prisma wrapper,
including whether it uses `P2010`, must be reproduced before implementing the
follow-up classifier.

[Feat-509](../roadmap/content-discovery/feat-509-playback-sqlstate-serialization-retry.md)
records the bounded retry and response-mapping repair within the existing
feat-464 transport scope. It remains open; this release is not an error-free
transport claim. See the
[baseline aggregate](../validation/recommendation-release-2026-09-16/production/fact-serialization-baseline.json).

## Interpretation

The [release regression](recommendation-release-validation-2026-09-16.md)
proves stored direct/search playback reaches recent-history composition and
preserves sparse-row refill. Quick exits are unknown-preference diagnostic
observations; they must not create a new preference weight.

Feat-503 and feat-504 cover the implemented repair and observation mechanism.
Feat-370, feat-393 and feat-505 retain their remaining telemetry, shadow evaluation
and controlled usefulness gates. Feat-471 remains excluded. A short synthetic
journey and initial health window cannot establish causal engagement uplift.
