# Recommendation quality release — September 16, 2026

## Outcome and scope

Visible muted preview watching now updates a separate viewing-mode profile facet.
Preview remains first. The new ranking policy can favor relevant videos with
independent evidence of successful sound-off viewing. Empty seeded rows can use
existing approved inventory for the exact locale/audio context.

The production journey and retained evidence establish implementation behavior,
not improved recommendation usefulness. No candidate had the required 20 other
profiles in the initial live capture. No controlled experiment was activated or
approval fabricated. For you remains held off; feat-373 and feat-471 are excluded.

## Releases and verification

| Change                              | PR                                                   | Main revision                              | Result                                                         |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Recommendation follow-through       | [2317](https://github.com/JesusFilm/forge/pull/2317) | `3028f3305c1b01c2e4671ec9686ee51280dd1115` | Merged 01:27:22 UTC; all three services successful by 01:48:02 |
| Existing-tab enum compatibility     | [2318](https://github.com/JesusFilm/forge/pull/2318) | `ea07cad7da833dc5c2ddf69331715ed39d481c34` | Merged 01:50:58; Web successful 02:12:50                       |
| Canonical recommendation seed slugs | [2320](https://github.com/JesusFilm/forge/pull/2320) | `469edc6f996db1c6bd729b9a1b9f0e2732a0cd58` | Merged 02:08:34; Web successful 02:30:18                       |

PR checks passed: 22 applicable checks for 2317, 18 each for 2318/2320.
Feature CI passed 7,258 Admin and 4,398 Web tests, builds, types, lint, format,
existing integration suites and CodeQL. New native PostgreSQL suites also passed
locally. The workflow definition was retained because the configured GitHub
credential cannot edit workflow files; skipped ordinary-unit invocations of the
new native files are not counted as database coverage.

The independent Admin duration-hydration fix [2319](https://github.com/JesusFilm/forge/pull/2319)
merged as `8070374f6a6e3e892926112d5a6ca8f5f7480fa1`. Admin and worker deployed it
at 02:13:26 and 02:13:30. It contains the feature revision and is preserved.
Later reliability/performance observations therefore include that change; they
cannot isolate the recommendation release's effect. All releases used normal
PR/main/Railway flow. No worktree deployment, curated publication or flag change
was used. Migrations 0097 and 0098 finished at 01:33:50 UTC.

## Actual browser and database proof

The real Watch/Mux journey used a fresh owned synthetic browser profile:

- On Simple Gospel, 41,237ms of visible muted preview qualified as sound-off
  viewing. Watch now switched to sound-on playback within the same episode;
  15,094ms of sound-on evidence remained below that video's 30-second threshold.
- Scrolling the body over the sticky hero paused the preview. During the seven
  second covered check, position and mode-fact count stopped advancing.
- Selecting a recommendation opened its muted preview. The selected episode had
  a durable recommendation attribution and 50,519ms of qualified sound-off
  viewing without a manual playback start.
- Both episodes used the current profile generation, a profile/session link that
  preceded the episode, and matching retention; no replay or conflict occurred.
- Deleting only this synthetic profile returned HTTP 200/session-only with
  asynchronous erasure pending. The next read-only query confirmed both viewing
  facets were absent while immutable playback facts remained. No production
  viewer's profile was reset or deleted.
- Life of Jesus, previously empty for a missing seed embedding, displayed six
  curated cards with the correct “Selected videos to explore” explanation.
  Requests succeeded and no JavaScript errors occurred in that journey.

The selected destination exposed a separate existing bug: repeated hyphens in
`origins-of-christmas--episode-1` were accepted by canonical Watch routes but
rejected by recommendation input validation. Two regression tests failed before
2320; 57 focused route/component tests, types, lint and format passed afterward.
The fix uses the canonical slug parser while retaining the length and invalid
path/query fences. The production recheck is recorded below.

At 02:01 UTC there were 37 viewing-mode episodes across 16 profiles, including
owned synthetic observations. Three sound-off and 15 sound-on episodes qualified;
17 episodes included preview. Identity, conflict and retention checks found zero
invalid rows. Six videos had at least one observable sound-off viewer, but none
met the independent-profile threshold. These counts are profiles/episodes, not
verified people or organic-only traffic.

## Fixed-window analytics

Primary Railway HTTP logs are complete for each stated deployment/window. The
retained delivery ledger is a different population: admission failures and
unpersisted requests do not share its denominator. Synthetic probes are included.
Each SQL query uses its own read-only repeatable-read transaction; the bundle is
not one simultaneous snapshot.

| Measure                          | Baseline 00:58–01:13 |   Feature 01:49–02:04 |
| -------------------------------- | -------------------: | --------------------: |
| Recommendation API requests      |                2,161 |                 2,613 |
| HTTP 5xx                         |                    0 |             9 (0.34%) |
| Retained delivery requests       |                  112 |                   131 |
| Returned cards                   |                  490 |                   595 |
| Zero-card requests               |           11 (9.82%) |           15 (11.45%) |
| Duplicate slates                 |                    0 |                     0 |
| Retrieval p50 / p95              |       98.5 / 402.7ms |         238 / 761.5ms |
| Requests with profile candidates |                    6 |                    22 |
| Curated recoveries               |                    0 | 5 requests / 30 cards |

The five curated recoveries demonstrate the new fallback. The total empty-row
rate and retrieval latency did not improve in this short, unmatched cohort.
Do not attribute those differences causally or call overall quality improved.
Five feature-window empty responses were retrieval timeouts, eight had no
candidates, one lacked a seed embedding and one had a stale candidate pool.

All nine HTTP 503s reconcile to bounded Web diagnostic events: six facts writes
and three selections exceeded the upstream deadline. Admin logged 38 retryable
contention observations and no exhausted retry event in this window. Datadog's
service-filtered counts matched the primary events; requiring an env tag missed
these logs. No request-level trace establishes that contention caused the nine
timeouts. One separate facts request was rejected with terminal HTTP 400; it
was not a serialization-exhaustion observation. Two finalization run records had
stored errors (one succeeded after contention, one running record with a finished
timestamp and unclassified error); the broader workflow/integrity gates remain
open. No assertion of zero errors is made for this window.

## Final rollout and loading checks

The 02:14–02:24 recovery window, after the independent Admin fix and Web
compatibility deployment, has 152 retained deliveries, 752 cards, eight empty
requests (5.26%), no duplicate slates and eight curated recoveries supplying 48
cards. Retrieval p50/p95 was 170/594.9ms. No retained request in that window had a
retrieval-timeout result. The sampled 48 personalized requests had no match in
the specific qualified-history repeat diagnostic. This is not a proof of zero
repeats across all history or identities. Finalizer records had zero stored
errors; 21 had succeeded and 118 remained running when captured. Worker heartbeat
was fresh. Primary HTTP logs contain 2,345 recommendation API requests with zero 5xx in
that same ten-minute window. Admission 403s and seven terminal 400s are retained
in the artifact, not counted as successes. The final slug deployment follows below.

Whole-page production observations preserve the slow samples:

- Baseline cold LCP 1,512ms, warm 556/672ms; cold longest task 126ms.
- Initial after-run cold LCP 9,940ms, warm 688/776ms; cold longest task 208ms.
- Three fresh-browser diagnostic LCP values: 1,304/900/1,108ms; longest tasks
  204/214/206ms. Later diagnostic cold runs reported 9,984/9,992ms and longest
  tasks 229/119ms. The last run found a visible heading in the DOM at 1.98s but
  no paint entries yet; its late LCP named that heading.
- Preview played muted and Watch now was available in every measured journey.
  Each synthetic measurement profile was deleted through the normal API.
- The existing eight-second desktop preview delay is unchanged from the deployed
  baseline. A controlled production-recorder fixture added 857 compressed bytes,
  with median DOMContentLoaded 29.4 → 32.8ms. This component result cannot explain
  or dismiss whole-page cold-paint variation.

A matched follow-up independently built pre-release `0a1c58599` and current
`469edc6f9` with identical CI configuration and the same catalog backend. Six
fresh-browser runs alternated baseline/current/current/baseline/baseline/current.
Baseline LCP was 4,920/9,988/9,972ms; current was 4,788/324/9,988ms. Initial server
cache misses had 4.5–4.7s TTFB in both builds. Maximum long tasks were
124/111/113ms before and 127/126/125ms after. All six journeys rendered the
correct Watch page, muted preview and Watch now. Local mutation requests remained
behind the canonical-origin fence, so these runs did not create production
profiles.

The roughly ten-second paint behavior demonstrably predates this release. The
comparison does not establish a change in its frequency or field percentiles.
[Feat-515](../roadmap/content-discovery/feat-515-watch-cold-paint-preview-verification.md)
retains investigation of that existing behavior's cause and real-device impact.
The source and component checks found no new playback-start dependency on the
profile/telemetry path; the release does not claim overall loading improvement.

Web revision `469edc6f9` became successful at 02:30:18 UTC. At 02:32:52 the
exact repeated-hyphen destination returned HTTP 200, displayed six semantic
cards and produced no JavaScript errors or unhandled rejections. All ten
observed recommendation API requests were HTTP 200. For you availability was
still HTTP 200 / `enabled: false` with private/no-store caching. The final 02:31–02:36 window on that Web revision contained 862 recommendation
API requests: 714 HTTP 200, 148 admission 403s and zero other errors. The retained
ledger had 56 deliveries, 274 cards, five empty requests (8.93%), zero duplicate
slates, two curated recoveries/12 cards and no retrieval-timeout result. Retrieval
p50/p95 was 199.5/618.5ms. The worker heartbeat was 5.65 seconds old; 16 finalizer
runs succeeded, 46 remained running and none stored errors in that cohort.
This bounded recovery is encouraging; it does not erase the earlier failures or
satisfy the separate longer-running reliability/controlled-quality gates.

## Interpretation and remaining work

Qualification uses equal sound-on/off requirements, visible page/player geometry,
actual progress and bounded elapsed time. These are behavioral proxies; they do
not establish attention or satisfaction. Brief exits remain unknown preference.
Missing historical manual-play facts cannot be backfilled as muted viewing.

Candidate suitability is a smoothed sound-off qualification rate with at least
20 independent other profiles and a bounded contribution within relevant eligible
candidates. Sparse evidence preserves ordinary ranking. Caption settings and
observation locale are not separate dimensions in this first policy; serving
still enforces exact locale/audio eligibility.

- Feat-509/511/512/514 are complete for their implemented and verified scope.
- Feat-515 retains the pre-existing cold-paint investigation.
- Feat-370 retains broader playback/QoE work.
- Feat-393 retains editorial/series/speaker adapters, weight calibration and the
  terminal composer decision. Live MMR remains unpromoted.
- Feat-505 retains a real approved profile A/A, external operational guardrails,
  complete 24-hour follow-up and a mature comparison including zero-exposure units.
- Feat-464 retains its broader two-hour integrity and monitoring gates. The
  separate feat-513 workflow follow-up remains owned by the Admin performance task.

The narrow rollback is `RECOMMENDATION_VIEWING_MODE_ENABLED=false` through normal
configuration deployment. It disables mode projection/ranking while preserving
playback, raw facts, erasure and ordinary recommendations.

See [validation evidence](../validation/recommendation-quality-followup/verification.md)
and [Compound review](../validation/recommendation-quality-followup/compound-review.md).

## Latest profile health capture

At 02:27:32 UTC, after owned-profile cleanup, 92 mode-evidence episodes belonged
to 40 current profiles. One sound-off and 39 sound-on episodes qualified; 43
included preview. The checks still found zero invalid identity generations,
conflicts or retention mismatches, and zero late mode facts. Fifteen videos had
observable sound-off viewers, at most three profiles each; none met the 20-other-
profile requirement. The preceding 30-minute capture recovered 13 curated rows
with 78 cards, with zero duplicate/current-video items, invalid profile claims
or item-count mismatches. These windows overlap earlier captures and must not
be summed.
