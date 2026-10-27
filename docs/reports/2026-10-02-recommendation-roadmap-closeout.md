# Recommendation roadmap closeout

Owner authorization: October 2, 2026 (Pacific/Auckland). The reconciled scope is
**11 complete, 25 cancelled and four open** across 40 ticket paths. The October 23
addition is platform feat-756, the directly related fortnightly Watch exposure
retention rollout; it does not replace feat-554. The separate October 27 NZDT
Co-watch follow-up in [#2916](https://github.com/JesusFilm/forge/pull/2916) reopened
feat-573 after fresh preflight-unavailable refusals. The original 38-path scope
now has feat-554 and feat-573 open; coverage acceptance and cancellations are
unchanged.
The newly discovered intermittent HNSW CI failure is tracked separately in
content-discovery feat-609; no feat-554 acceptance was moved to that ticket.
The record and final dependency/index reconciliation
ship in [2541](https://github.com/JesusFilm/forge/pull/2541). The final merged-main
confirmation is retained on that PR after merge.

Baseline: main `b01e0ddca`, including
[2530](https://github.com/JesusFilm/forge/pull/2530),
[2533](https://github.com/JesusFilm/forge/pull/2533) and
[2537](https://github.com/JesusFilm/forge/pull/2537).

## Current scope decision

Retain bounded semantic/profile recommendations, approved co-watch/MMR,
source-free shelves, current controls, evidence integrity and operational
lifecycle. Retire optional learned ranking, randomized exploration, extra
candidate generators, generated playlists and personalized page orchestration.
Broader pool coverage is not selected. Cancellation does not remove working
product behavior or claim the proposed products were implemented. Causal
usefulness remains unmeasured.

The [delivery policy](../analytics-and-recommendation-policy.md) governs health.
[Accepted coverage evidence](2026-10-02-recommendation-coverage-acceptance.md)
does not prove catalogue exhaustion, pre-ledger HTTP reliability or causal lift.
Each cancelled ticket preserves its historical requirements below a dated
supersession note and identifies retained behavior. Historical checklists do
not override these explicit current decisions.

## Ownership and review

Only the coordinating chat delegates and merges. Execution owners use GPT-6 Sol,
except for the retention repair owner explicitly requested on GPT-6 Astra on
October 27. Owners use isolated worktrees without further delegation. The
existing storage task retains daily read-only observation; Astra owns the active
retention repair and coordinated manual cleanup. Production publication uses
reviewed PR-to-main releases. The original dirty checkout is preserved.

| Area             | Owner chat                             |
| ---------------- | -------------------------------------- |
| root             | `01a0f9a4-577b-7332-9fea-7db1660861fa` |
| cowatch          | `01a0f3c7-3cf2-7540-a991-748579724e60` |
| storage          | `01a17a53-3d0b-7b51-806c-78af8d6cfc3c` |
| storage observer | `01a0e490-2d64-7013-8a95-a4f4015e26e0` |
| fixtures         | `01a0f9a9-8860-7982-8c12-d9f495f42c93` |
| watch            | `01a0f9a9-8e25-7fd1-8ec1-7a279f5cf85f` |
| clients          | `01a0f9a9-93e1-7911-8334-9cd812ba9b47` |
| measurement      | `01a0f9a9-99cd-7a90-823c-c709b9687f5c` |
| roadmap          | `01a0f9aa-e1ef-7831-a7d0-973ebc15fcf8` |

Independent documentation review belongs to chat
`01a0f9b3-2420-7013-816d-13a36bd03adc`; fixture/CI and roadmap code review to
`01a0f9b9-ffc4-76e2-b2af-bc569702be04`. Reviews report exact published heads,
not merely branch names. No actionable findings were reported for the reviewed
Watch, measurement, storage, client, fixture/CI or roadmap changes. Co-watch review also found no actionable issue. Root final integration review
identified two evidence-attribution errors (measurement decisions linked to the
historical D1–D9 record, and mobile evidence labelled as Admin fallback proof);
both were corrected. Final published-head review and required checks are retained
on #2541 before merge.

## Path-specific inventory

The original scope contains **37 paths**, initially 35 open and two complete.
The directly required cancelled-status viewer fix adds platform feat-599, for
**38 scoped paths**. The later CI investigation adds content-discovery feat-609,
making 39 tracked paths. IDs alone are unsafe: content-discovery feat-517 is in scope;
unrelated platform feat-517 and RAG feat-575 are not. The dispositions below match the audited integration tree on merged main
`c7e832ae5`, plus the explicit cancellations in #2541.

| Ticket path                                                                                                                                                                              | Owner       | Disposition and remaining work                                                                                                                                                                     | PR and evidence                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/roadmap/content-discovery/feat-055-smart-video-playlists.md](../roadmap/content-discovery/feat-055-smart-video-playlists.md)                                                       | root        | Cancelled: Prompt/vector-generated playlists are a separate product expansion, outside the selected bounded recommendation delivery scope.                                                         | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-063-personalize-discovery-experiences.md](../roadmap/content-discovery/feat-063-personalize-discovery-experiences.md)                               | root        | Cancelled: This broad umbrella is superseded by the implemented, individually audited anonymous-profile, candidate and client-delivery work (feat-378, feat-386, feat-447, feat-487 and feat-517). | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-371-recommendation-subtitle-audio-signals.md](../roadmap/content-discovery/feat-371-recommendation-subtitle-audio-signals.md)                       | measurement | Cancelled: extra subtitle/audio outcome signals are optional; exact delivery language/audio contracts remain required.                                                                             | [2539](https://github.com/JesusFilm/forge/pull/2539). The ticket's dated October 2 scope decision and retained source anchors.                                                                                                                             |
| [docs/roadmap/content-discovery/feat-372-recommendation-mission-value-actions.md](../roadmap/content-discovery/feat-372-recommendation-mission-value-actions.md)                         | measurement | Cancelled: the mission-action measurement programme is retired; working action evidence remains.                                                                                                   | [2539](https://github.com/JesusFilm/forge/pull/2539). The ticket's dated October 2 scope decision and retained source anchors.                                                                                                                             |
| [docs/roadmap/content-discovery/feat-373-watch-surface-impressions-ctr.md](../roadmap/content-discovery/feat-373-watch-surface-impressions-ctr.md)                                       | watch       | Complete: bounded Watch origin-issued V2 manifests and Admin measurement verified; no global CTR or exhaustive surface claim.                                                                      | [2538](https://github.com/JesusFilm/forge/pull/2538). Ticket contains dated scope and 353 focused-test results.                                                                                                                                            |
| [docs/roadmap/content-discovery/feat-374-recommendation-acquisition-share-attribution.md](../roadmap/content-discovery/feat-374-recommendation-acquisition-share-attribution.md)         | measurement | Cancelled: additional acquisition/share attribution is outside the selected recommendation scope.                                                                                                  | [2539](https://github.com/JesusFilm/forge/pull/2539). The ticket's dated October 2 scope decision and retained source anchors.                                                                                                                             |
| [docs/roadmap/content-discovery/feat-375-semantic-search-downstream-outcomes.md](../roadmap/content-discovery/feat-375-semantic-search-downstream-outcomes.md)                           | measurement | Cancelled: search-to-qualified-outcome measurement expansion is retired; current search behavior remains.                                                                                          | [2539](https://github.com/JesusFilm/forge/pull/2539). The ticket's dated October 2 scope decision and retained source anchors.                                                                                                                             |
| [docs/roadmap/content-discovery/feat-377-authenticated-machine-recommendation-parity.md](../roadmap/content-discovery/feat-377-authenticated-machine-recommendation-parity.md)           | root        | Cancelled: A separate recommendation machine-adapter product with artifact-use receipts, purpose quotas and machine-utility dashboards is not part of the chosen viewer recommendation scope.      | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-379-recommendation-intent-profile-controls.md](../roadmap/content-discovery/feat-379-recommendation-intent-profile-controls.md)                     | root        | Cancelled: The proposed purpose prompts and five title-level feedback actions are additional product scope and are retired.                                                                        | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-380-reported-value-surveys.md](../roadmap/content-discovery/feat-380-reported-value-surveys.md)                                                     | measurement | Cancelled: reported-value survey product and satisfaction-study programme are retired.                                                                                                             | [2539](https://github.com/JesusFilm/forge/pull/2539). The ticket's dated October 2 scope decision and retained source anchors.                                                                                                                             |
| [docs/roadmap/content-discovery/feat-381-semantic-control-readiness.md](../roadmap/content-discovery/feat-381-semantic-control-readiness.md)                                             | measurement | Cancelled: semantic-only experiment-readiness gate is obsolete; existing readiness code remains.                                                                                                   | [2539](https://github.com/JesusFilm/forge/pull/2539). The ticket's dated October 2 scope decision and retained source anchors.                                                                                                                             |
| [docs/roadmap/content-discovery/feat-387-profile-conditioned-directional-cowatch.md](../roadmap/content-discovery/feat-387-profile-conditioned-directional-cowatch.md)                   | cowatch     | Complete: directional profile-conditioned co-watch and bounded owner authority are implemented and verified.                                                                                       | [2546](https://github.com/JesusFilm/forge/pull/2546). [Refresh audit](../operations/recommendation-cowatch-refresh-2026-10-01.md#october-2-read-only-refresh-reconciliation).                                                                              |
| [docs/roadmap/content-discovery/feat-388-editorial-recommendation-candidates.md](../roadmap/content-discovery/feat-388-editorial-recommendation-candidates.md)                           | root        | Cancelled: The shadow editorial-candidate adapter and counterfactual experiment programme are retired.                                                                                             | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-389-search-session-intent-candidates.md](../roadmap/content-discovery/feat-389-search-session-intent-candidates.md)                                 | root        | Cancelled: A new search-query/session-intent candidate generator is optional expansion of the current semantic/profile/co-watch system and is retired.                                             | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-390-continuation-recommendation-candidates.md](../roadmap/content-discovery/feat-390-continuation-recommendation-candidates.md)                     | root        | Cancelled: The proposed recommendation-generator integration for resume, course progression and authored next steps is retired as additional product scope.                                        | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-391-qualified-popular-trending-candidates.md](../roadmap/content-discovery/feat-391-qualified-popular-trending-candidates.md)                       | root        | Cancelled: Quality-weighted popular/rising/trending projections and their shadow programme are retired.                                                                                            | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-392-high-satisfaction-cohort-candidates.md](../roadmap/content-discovery/feat-392-high-satisfaction-cohort-candidates.md)                           | root        | Cancelled: The satisfaction-cohort generator depends on the retired survey/popularity programme and is outside the chosen scope.                                                                   | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-393-recommendation-slate-composer.md](../roadmap/content-discovery/feat-393-recommendation-slate-composer.md)                                       | cowatch     | Cancelled: broader slate expansion (editorial pins, series/speaker constraints and calibration/shadow programme) is retired; deployed limited MMR remains.                                         | [2546](https://github.com/JesusFilm/forge/pull/2546). [Refresh audit](../operations/recommendation-cowatch-refresh-2026-10-01.md#october-2-read-only-refresh-reconciliation).                                                                              |
| [docs/roadmap/content-discovery/feat-394-bounded-recommendation-exploration.md](../roadmap/content-discovery/feat-394-bounded-recommendation-exploration.md)                             | root        | Cancelled: Randomized exploration and propensity-based learning are retired from this roadmap.                                                                                                     | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-395-learned-multi-outcome-reranker.md](../roadmap/content-discovery/feat-395-learned-multi-outcome-reranker.md)                                     | root        | Cancelled: The learned challenger, training snapshots and model registry are retired.                                                                                                              | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-396-recommendation-privacy-capacity-graduation.md](../roadmap/content-discovery/feat-396-recommendation-privacy-capacity-graduation.md)             | root        | Cancelled: The umbrella graduation exercise for the retired exploration, learned models and personalized-page programme is cancelled.                                                              | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-447-live-anonymous-profile-personalization-pilot.md](../roadmap/content-discovery/feat-447-live-anonymous-profile-personalization-pilot.md)         | clients     | Complete: bounded live anonymous-profile rollout, controls and isolated real-dependency fallback proof; benefit and natural failure receipt unclaimed.                                             | [2543](https://github.com/JesusFilm/forge/pull/2543). Ticket contains dated production/proxy observations and isolated fallback proof.                                                                                                                     |
| [docs/roadmap/content-discovery/feat-448-learned-sequential-profile-item-representations.md](../roadmap/content-discovery/feat-448-learned-sequential-profile-item-representations.md)   | root        | Cancelled: Learned sequential encoders, training infrastructure and profile/item ANN retrieval are retired.                                                                                        | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-449-personalized-watch-row-page-orchestration.md](../roadmap/content-discovery/feat-449-personalized-watch-row-page-orchestration.md)               | root        | Cancelled: A new personalized row-selection/page-ordering layer is retired.                                                                                                                        | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-497-expand-production-recommendation-pool-coverage.md](../roadmap/content-discovery/feat-497-expand-production-recommendation-pool-coverage.md)     | root        | Cancelled: Broader curated-pool expansion is optional and is not selected for this closeout.                                                                                                       | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                                                                                          |
| [docs/roadmap/content-discovery/feat-505-personalization-controlled-usefulness-evaluation.md](../roadmap/content-discovery/feat-505-personalization-controlled-usefulness-evaluation.md) | measurement | Cancelled: controlled usefulness study is not required for direct co-watch/MMR; causal benefit remains unmeasured.                                                                                 | [2539](https://github.com/JesusFilm/forge/pull/2539). The ticket's dated October 2 scope decision and retained source anchors.                                                                                                                             |
| [docs/roadmap/content-discovery/feat-517-mobile-recommended-for-you-shelf.md](../roadmap/content-discovery/feat-517-mobile-recommended-for-you-shelf.md)                                 | clients     | Complete: implemented mobile shelf and evidence nonce behavior; production binary/audience reach and real mobile Admin writes remain unobserved.                                                   | [2543](https://github.com/JesusFilm/forge/pull/2543). Simulator/fake-proxy, equal 96 ms median first paint and 158 current mobile Jest tests; real Admin mobile acceptance and binary release unobserved.                                                  |
| [docs/roadmap/content-discovery/feat-564-cached-watch-public-navigation-authority.md](../roadmap/content-discovery/feat-564-cached-watch-public-navigation-authority.md)                 | watch       | Cancelled: optional cached public-navigation alias coverage is not selected; ambiguous manifests/denominators remain withheld.                                                                     | [2538](https://github.com/JesusFilm/forge/pull/2538). Ticket contains dated scope and 353 focused-test results.                                                                                                                                            |
| [docs/roadmap/content-discovery/feat-565-implemented-shadow-recommendation-promotion.md](../roadmap/content-discovery/feat-565-implemented-shadow-recommendation-promotion.md)           | cowatch     | Complete: direct co-watch/MMR authority and supported fallback verified independently of any study.                                                                                                | [2546](https://github.com/JesusFilm/forge/pull/2546). [Refresh audit](../operations/recommendation-cowatch-refresh-2026-10-01.md#october-2-read-only-refresh-reconciliation).                                                                              |
| [docs/roadmap/content-discovery/feat-566-recommendation-evidence-gap-remediation.md](../roadmap/content-discovery/feat-566-recommendation-evidence-gap-remediation.md)                   | measurement | Cancelled: nine historical evidence gaps reviewed individually; extra forensic/correlation campaign retired, causes unrecovered and fresh errors still actionable.                                 | [2539](https://github.com/JesusFilm/forge/pull/2539). Ticket-specific D1–D9 dispositions and [historical evidence gaps](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md).                                                           |
| [docs/roadmap/content-discovery/feat-573-sustainable-cowatch-live-refresh.md](../roadmap/content-discovery/feat-573-sustainable-cowatch-live-refresh.md)                                 | cowatch     | Open, in-progress: fresh preflight-unavailable refusals reopened refresh verification in #2916; prior lifecycle acceptance remains historical.                                                     | [2546](https://github.com/JesusFilm/forge/pull/2546). [Refresh audit](../operations/recommendation-cowatch-refresh-2026-10-01.md#october-2-read-only-refresh-reconciliation).                                                                              |
| [docs/roadmap/content-discovery/feat-612-refresh-recommendation-integration-fixtures.md](../roadmap/content-discovery/feat-612-refresh-recommendation-integration-fixtures.md)           | fixtures    | Complete: fixed historical timestamps and current-schema fixture isolation, retaining production constraints and migrations.                                                                       | [2544](https://github.com/JesusFilm/forge/pull/2544). [CI: 4 fixture + 52 co-watch tests](https://github.com/JesusFilm/forge/actions/runs/36940081572/job/110630746009); one separate local PostgreSQL/Redis fallback test (not part of the new CI steps). |
| [docs/roadmap/content-discovery/feat-609-filtered-hnsw-fixture-recall.md](../roadmap/content-discovery/feat-609-filtered-hnsw-fixture-recall.md)                                         | fixtures    | Open, in-progress: intermittent HNSW fixture failure remains unexplained; bounded local passes and failure diagnostics do not establish a fix.                                                     | [2595](https://github.com/JesusFilm/forge/pull/2595). Native PostgreSQL investigation and failure-only plan/settings evidence.                                                                                                                             |
| [docs/roadmap/platform/feat-554-recommendation-storage-rollout-verification.md](../roadmap/platform/feat-554-recommendation-storage-rollout-verification.md)                             | storage     | Open, in-progress: October 23 is one accepted loaded failure-free cycle; October 24–26 failed, and one further qualifying cycle is required.                                                       | [2540](https://github.com/JesusFilm/forge/pull/2540). [storage audit](2026-10-02-recommendation-storage-efficiency-closeout.md)                                                                                                                            |
| [docs/roadmap/platform/feat-555-recommendation-legacy-trace-reclamation.md](../roadmap/platform/feat-555-recommendation-legacy-trace-reclamation.md)                                     | storage     | Complete before this closeout: restrictive legacy-stage retirement and measured physical reclamation retained.                                                                                     | [2537](https://github.com/JesusFilm/forge/pull/2537), [2540](https://github.com/JesusFilm/forge/pull/2540). [storage audit](2026-10-02-recommendation-storage-efficiency-closeout.md)                                                                      |
| [docs/roadmap/platform/feat-574-recommendation-storage-efficiency.md](../roadmap/platform/feat-574-recommendation-storage-efficiency.md)                                                 | storage     | Complete: U1–U3 storage implementation, production representation checks and measured fixture savings verified.                                                                                    | [2540](https://github.com/JesusFilm/forge/pull/2540). [storage audit](2026-10-02-recommendation-storage-efficiency-closeout.md)                                                                                                                            |
| [docs/roadmap/platform/feat-575-early-legacy-recommendation-retirement.md](../roadmap/platform/feat-575-early-legacy-recommendation-retirement.md)                                       | storage     | Complete before this closeout: authorized early legacy-detail retirement and physical disposal verified.                                                                                           | [2537](https://github.com/JesusFilm/forge/pull/2537), [2540](https://github.com/JesusFilm/forge/pull/2540). [storage audit](2026-10-02-recommendation-storage-efficiency-closeout.md)                                                                      |
| [docs/roadmap/platform/feat-591-cowatch-postgresql-regressions-ci.md](../roadmap/platform/feat-591-cowatch-postgresql-regressions-ci.md)                                                 | fixtures    | Complete: four existing native co-watch suites wired into PostgreSQL CI; the exact new CI steps passed.                                                                                            | [2544](https://github.com/JesusFilm/forge/pull/2544). [CI: 4 fixture + 52 co-watch tests](https://github.com/JesusFilm/forge/actions/runs/36940081572/job/110630746009); one separate local PostgreSQL/Redis fallback test (not part of the new CI steps). |
| [docs/roadmap/platform/feat-599-roadmap-cancelled-status.md](../roadmap/platform/feat-599-roadmap-cancelled-status.md)                                                                   | roadmap     | Complete: genuine cancelled terminal status, separate counts, overdue exclusion and conservative dependency handling.                                                                              | [2545](https://github.com/JesusFilm/forge/pull/2545). Fixture tests in three timezones, lint/typecheck/build and browser load comparison; final deployed receipt retained on #2541.                                                                        |

The directly related October 23 addition brings the current inventory to 40 paths:

| Ticket path                                                                                                                                | Owner   | Disposition and remaining work                                                                                                                                            | PR and evidence                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [docs/roadmap/platform/feat-756-watch-exposure-fortnight-retention.md](../roadmap/platform/feat-756-watch-exposure-fortnight-retention.md) | storage | Open, in-progress: new anonymous exposure expiry and reporting are deployed; the old stored-expiry cohort begins October 27 and still needs throughput/capacity evidence. | [October 23 rollout report](2026-10-23-watch-exposure-fortnight-rollout.md), PRs #2859–#2865 and #2876. No old-expiry backfill or physical recovery claimed. |

## Delivery, coverage, usage and lifecycle

- **Reliability:** retained #2527 deployment and dated request evidence support
  bounded delivery claims only. The current isolated PostgreSQL 18/Redis drill
  returned six unique playable semantic fallback cards after a forced candidate
  platform exception, persisted `ISSUED/FALLBACK`, and retained
  `candidate_platform_unavailable` plus incomplete stage evidence. Normal and
  fallback timings were 158 ms and 78 ms in that local run, below the 1.5-second
  test budget. This is not production fault injection, a natural-failure receipt
  or proof that all fleet errors are absent.
- **Coverage:** valid empty/partial rows, absent approved pools and supported
  sparse co-watch fallback are accepted. Generic `zh` remains Simplified;
  explicit Traditional remains exact. Seeded curated fallback is empty-only;
  semantic partial fill stays within eligible bounded reserves. No catalogue
  exhaustion or broader coverage promise is inferred.
- **Usage and usefulness:** a bounded October 1 17:50–18:40 UTC co-watch window
  had 231 issued requests, 1,044 cards, four owner fallbacks, and zero owner
  executions/co-watch cards. Three were sparse-edge fallbacks. Zero contribution
  alone does not establish failure; causal benefit remains unmeasured.
- **Unknown cause:** the fourth fallback was
  `composition_required_input_unavailable` at 18:03:57 UTC: 51 candidates,
  six selected, only three candidates with themes, `missingTheme=true`, other required
  input flags false. Six incumbent cards were issued. Historical selected-theme
  metadata provenance was not retained; coverage versus hydration cause is
  unknown. This is not classified as proven benign coverage or a reproduced
  current defect. Fresh internal errors remain actionable even with fallback.
- **Refresh lifecycle:** automatic replacement G8 was observed October 1 at
  14:57 UTC, then revoked by eligibility supersession at 18:16:52 UTC. Two source
  decisions had matching states/scopes/weights/reasons but changed concentration
  and stored input digests. The exact changed input/producer history is unknown;
  an attempted manual hash reconstruction was inconclusive and supports no
  digest-invalidity claim. The scheduler remained alive with a valid grant and
  a deliberate 12-hour throttle. The next attempt becomes eligible October 2
  at 02:57 UTC; that future production result is unobserved. Native regression
  tests cover revocation, throttled safe fallback and source-current replacement
  while preserving the old revocation. The accepted bounded lifecycle does not
  require continuous co-watch influence.
- **Historical measurement limits:** Watch registry coverage is 2/10; the dated
  hero cohort had 15 served and 15 rendered, not an isolated browser run or global
  Watch CTR. The 195 historical shared Admin loss rejections remain unattributed.
  Feat-566 reviews D1–D9 individually and does not recover missing historical
  joins or reclassify errors as coverage. Fresh failures require bounded review.

## Storage gate and scheduled follow-through

[Storage closeout evidence](2026-10-02-recommendation-storage-efficiency-closeout.md)
separates capacity recovery from retention health. Legacy reclamation recovered
16,431,235,072 relation bytes; net filesystem recovery was 16,144,224,256 bytes.
The October 1 22:51–22:53 UTC snapshot had 25,630,932,992 free bytes, an empty
24,576-byte legacy stage table and no observed locks. Representation samples
verified compact/packed payloads, shared vectors, CUID exposure IDs and typed
first-empty generations. Fixture savings are not a causal production monthly
growth claim.

**Platform feat-554 stays in-progress.** September 30 and October 1 recovered
after failures, so neither counts as one of the two required normal failure-free
loaded daily cycles. The October 1 audit had zero qualifying cycles and
included 78 successful and four failed wrappers, 7,846 committed roots and
27,216 served descendants. Two failures were timeout/closed and two remained
unclassified; no speculative production change was made. The 3,337 newly expired
roots in the snapshot were within the 24-hour acceptance threshold, which does
not establish sustained retention success.

The October 2 cycle also failed before recovering: one timeout followed by 74
successful attempts removed 7,435 request roots and 25,182 served descendants.
[2550](https://github.com/JesusFilm/forge/pull/2550) bounded the profile tail and
generation-reference detachment without widening the five-second deadline.
Both actual Admin roles were verified on its merge `b34844d7` at October 2
20:50 UTC. Recovery still did not qualify that cycle.

The October 3 cycle then failed repeatedly during pre-root standalone playback
episode work. At 19:44 UTC, 124 scheduled wrappers had failed; the later 19:46 UTC
durable-ledger slice still showed zero request-root deletions. At 20:07 UTC,
aggregate probes found 2,179 roots and 687
standalone episodes overdue by more than 24 hours. Overdue retention makes the
serving gate unhealthy by the current code path; no synthetic delivery request
was used to claim an observed client response. Healthy HTTP endpoints did not
establish recommendation availability. The phase diagnosis follows code order,
durable counters and native reproduction; it does not identify one exact failing
SQL statement for every production attempt.

[2551](https://github.com/JesusFilm/forge/pull/2551) caps the pre-root standalone
episode page at ten while preserving each episode's dependency locks, recheck,
atomic deletion and committed counters. The dependency guard, expiry, scheduler
and run deadline remain unchanged. The native loaded fixture reproduced zero
root progress on the old implementation at 5.22 seconds; the fix deleted ten
episodes and twelve expired roots in 1.09 seconds, then drained the remaining
episodes through continuation. A separate native case verifies partial progress
and retry accounting after an individual deletion fails. These are isolated
fixture results, not production throughput estimates.

Independent review approved exact head `842a2c03`, and all required checks passed
in [run 37152721294](https://github.com/JesusFilm/forge/actions/runs/37152721294)
before the normal October 3 20:52 UTC squash merge `e6097773`. Two earlier CI
attempts failed an existing six-card HNSW assertion with zero candidates. The
test-only diagnostic head passed at 437 ms without entering the failure probe;
the earlier cause remains unresolved, not declared fixed. Assertions, eligibility
and retrieval budgets were preserved. Consult the timestamped actual-deployment
and natural-recovery receipts on #2551; its merge alone is not production proof.

Both actual Admin roles converged on `e6097773` at October 3 21:01:55 UTC with
healthy HTTP endpoints, compact traces and the expected runner roles. However,
the first natural attempt at 21:02:12 failed after about 5.05 seconds, deleting
ten standalone episodes and zero request roots. The expired-root backlog rose
from 10,823 at 21:02:14 to 10,829 at 21:02:56; the serving gate remained overdue.
At that snapshot, #2551 had not restored retention. Later old-worker attempts
committed some roots while their wrappers still failed; those deletions are not
attributed to the next release.

[2553](https://github.com/JesusFilm/forge/pull/2553) changes only the request-root
eligibility count to a parameterized, deduplicated query from request parents.
An equivalent old join shape took 329.175 ms in a bounded production read plan,
versus 2.548 ms for the new query on the same cohort. Native tests verify both
decision link types, exact deletion counts and live exclusions. These read-plan
and fixture results do not themselves establish whole-run production recovery.
Independent review and required CI passed before the normal 21:58 UTC merge
`e8e7fb3`; post-merge CI also passed.

Both actual Admin roles converged on `e8e7fb3` at **22:05:59 UTC**, healthy and
compact with the expected runner roles. The natural 22:06:07 attempt failed
after committing 100 roots and 12,746 profile-session links. Four attempts then
succeeded; another failed at 22:07:40 after committing 100 roots and later tail
work. The large link deletion itself committed; exact timed-out SQL is unknown.
A durable-ledger receipt collected around 22:17:02 counted **28 successful and
two failed attempts**: successful entries committed 2,800 roots and failed
entries another 200. No new failure had occurred since 22:07:40. A separate
22:17:23 backlog read found overdue request roots and projection runs clear;
the full serving gate remained overdue on 1,387 standalone episodes and 961
eligibility decisions. At that snapshot, further natural catch-up was required;
partial progress is not a healthy-gate claim. Timestamped deployment and
recovery-attempt receipts are retained on #2553.

**Serving-health recovery was observed at 22:47:11 UTC.** All 21 retained entity
types had zero rows beyond the 24-hour propagation limit, and the latest
success watermark was 22:47:06. The accompanying ledger receipt contained
204 scheduled successes and the same two earlier failures: successful entries
committed 10,080 request roots and failed entries another 200. A separate
22:49:11 health read again found zero overdue rows; the later ledger had 212
successes and no additional failures. This is recovered operational health,
not a failure-free October 3 cycle.

Within-window catch-up continued: the 22:47 health receipt still had 18,169
expired standalone episodes, 12,046 eligibility decisions and one projection
run, none overdue. The persistent scheduler remained running as designed; this
does not mean a purge attempt was incomplete or the daily-only cadence had
resumed. At 22:47:59, direct PGDATA measurement found 24,396,324,864 free bytes on
a 48,891,670,528-byte filesystem, 100,663,296 WAL bytes and no lock waiters or long
transactions. The legacy stage relation remained empty at 24,576 allocated bytes.
These are timestamped capacity observations, not a growth forecast.

By 22:51:26, a bounded read found ten naturally created requests since gate
clearance, all issued: nine served and one fallback, with no unavailable or
issuance-failed result. The cap was not reached. This small observed sample
supports resumed issuance; it is not universal serving proof. A separate
22:51:49 ledger snapshot contained 228 scheduled successes and the same two
earlier failures, with no scheduler error. Three freshly expired request roots
were present inside the propagation window. No synthetic writes or production
mutations were used for this verification.

The October 4 ordinary cycle also failed. The 19:39 UTC audit found six failed
scheduled attempts between 10:30:01 and 11:42:12, interleaved with 438 successful
attempts through 12:12:38. Successes committed 1,672 request roots, 5,390 served
items, 4,090 rendered facts and 4,373 standalone episodes; failed attempts
separately committed 23 roots and other descendants. Three wrapper failures
were classified as transaction-timeout/closed and three as deadline/statement
timeout, all around the unchanged five-second limit. Four committed nine or ten
standalone episodes without roots; two later failures committed roots and
projection cleanup. These counters do not identify the exact failed SQL.

At 19:39:29, all 21 types still had zero overdue rows and the latest success
watermark was 12:12:37. A separate 19:39:30 snapshot found 2,174 newly expired
request roots, with oldest expiry 12:12:41, inside the propagation window.
Both actual Admin roles were observed healthy and compact on `e8e7fb3` at
19:38:53. At 19:38:48, direct PGDATA free space was 23,857,287,168 bytes and WAL
was 134,217,728 bytes. The separate 19:39:30 read found the legacy stage empty
at 24,576 allocated bytes. Bounded read-only evidence and isolated tests informed
the mitigation below; current healthy serving criteria do not turn this into a
qualifying clean cycle. Sanitized receipts are retained
under `outputs/heartbeats/20261004T1938-daily/` in the storage evidence directory.

[PR #2556](https://github.com/JesusFilm/forge/pull/2556) merged normally as
`66eccae12b841be7ea373aefae3b402126a02733` at October 4 20:29:08 UTC after
independent review and all 26 checks passed or were appropriately skipped. Its
only runtime change reduces the standalone episode page from ten to five,
preserving the five-second deadline, expiry, root cap, locks, deletion order,
scheduler and failure accounting. Three owned PostgreSQL tests and 58 focused
tests passed locally; CI also exercised the native retention tests. The negative
slow-tail test proves a real timeout remains failed, earlier committed root work
is retained, and the last successful watermark does not advance.

The paired mixed-work fixture passed at both page sizes: the first attempt fell
from 4,467 to 2,767 ms, while total drain time rose from 8,366 to 8,871 ms (about
6.0%). This is measured deadline headroom, not proof of the exact production
timeout cause or a general cure. A bounded 47-hour-bucket expiry-prefix model
found a minimum conditional margin of 1,377 rows at half the observed October 4
episode deletion cadence; it does not prove future throughput or scheduler
continuity. Created-at counts are not expiry inflow. The scoped
[plan](../plans/2026-10-05-recommendation-retention-episode-margin.md) records
the assumptions and receipts. Actual process deployment and the absence of
post-merge retention attempts are recorded separately on #2556; future loaded
behavior remains to be measured. Merging code alone is not deployment or
clean-cycle evidence.

The October 5 ordinary cycle also failed after #2556. Both actual Admin roles
were observed healthy and compact on `904647329`, a verified descendant of the
repair, with the correct HTTP/worker runner roles. The bounded ledger audit
found four failed scheduled attempts between 10:30 and 12:01 UTC and 3,498
successes through 19:40. Successful attempts committed 9,505 request roots,
33,123 served items and 17,490 request-free episodes; failed attempts separately
committed 100 roots, 390 items and 20 episodes. Both ledgers agree on the
same-window totals, but they have no direct batch reference, so this does not
establish per-attempt linkage. Their read caps were not reached.

All four errors report expired or closed transactions. The reported operations
include request deletion, a raw query and ledger update; these identify where
failure surfaced, not the statement that consumed the budget. At 19:41:50 UTC,
all 21 retained types had zero rows beyond the 24-hour propagation limit and the
latest success watermark was 19:40:56. Newly expired records remained
inside the window, and the scheduler continued bounded catch-up. At the separate
19:41:56 capacity read, PGDATA had 23,093,526,528 bytes available of 48,891,670,528,
WAL was 134,217,728 bytes, the legacy stage was empty at 24,576 allocated bytes,
and no lock waiters were observed. No capacity threshold crossed or new physical
reclamation is claimed. Saved aggregate receipts are under
`outputs/heartbeats/20261005T1937-daily/` in the storage evidence directory.

The repeated failures mean the page-five mitigation has not established a clean
cycle. [PR #2580](https://github.com/JesusFilm/forge/pull/2580) addresses an
avoidable late-phase admission path reproduced on an owned PostgreSQL fixture:
the old code started a 500 ms deletion with only 287 ms remaining, then failed
after preserving earlier committed work. The exact production statement that
consumed the budget remains unproved.

The repair requires more than 750 ms before admitting a nonterminal
phase, checked before connection acquisition and after the advisory lock. A
pre-work yield records durable `SKIPPED` / `budget_yield`, exact committed
counters, unknown backlog and explicit bounded continuation. It does not
advance the successful-completion watermark. Real transaction, oldest-scan and
terminal-write failures remain failures, including failed fallback ledger
persistence. The five-second deadline, 29-day expiry, deletion order, page caps
and scheduling bounds remain unchanged. The threshold does not guarantee that
an admitted phase will finish or that repeated yields cannot delay later work.

Four owned PostgreSQL 18 tests and 68 focused tests passed, including real
timeout accounting and two yields under retained slow triggers before the
deferred contribution completed. Service, scheduler and workflow tests cover
bounded continuation and truthful counters and errors. GitHub's hosted-runner
incident delayed validation without executing the affected jobs. After runner
recovery, an explicit empty retry commit preserved the reviewed source tree;
independent review reconfirmed final head `5d590566c`. All 39 executed PR checks
passed, including native retention regressions, with six expected scope skips
in [run 37386269259](https://github.com/JesusFilm/forge/actions/runs/37386269259)
and the fresh CodeQL scan. Parent inspected underlying job results because the
existing aggregate gate did not reject earlier `abandoned` prerequisites.
Normal squash merge `0cb08416ce3e9a1278997d061fc2f8e12e6b2b66` completed at
October 5 **23:11:49 UTC**. A yield-only sequence cannot qualify as a clean
loaded cycle.

At **23:27:53 UTC**, both actual Admin HTTP and worker processes matched
`0cb08416c`, with successful deployments, health 200, compact traces and HTTP
runner disabled / worker runner enabled. HTTP deployment
`d9c19a1b-7ddf-47d4-9dbc-0ff3c07cc293` and worker deployment
`71e88c7d-8be0-4af2-9f15-01cbb79a311b` are recorded in the
[release receipt](https://github.com/JesusFilm/forge/pull/2580#issuecomment-6005424722).
Web was checked separately at `904647329` with `/watch` returning 200.
Both retention ledgers had **zero natural attempts since merge** at the 23:28
read; no loaded success, yield, lock skip or failure on this release was observed.
All 21 health types had zero rows more than 24 hours overdue at 23:28:06.
The latest success expiry cutoff, 22:04:29.558, predates the release. The healthy
scheduler's next ordinary start is October 6 at 10:30 UTC.

The separate 23:28:08 database read found 117,440,512 WAL bytes, no lock waiters
or long transactions, and the legacy stage empty at 24,576 allocated bytes.
PGDATA had 22,988,713,984 bytes available of 48,891,670,528 at 23:28:11. This
snapshot is not new physical reclamation or a steady growth forecast. Sanitized
receipts are under `outputs/heartbeats/20261005T2326-pr2580-postmerge/` in the
storage evidence directory. Deployment and current health earn no clean-cycle
credit.

The first post-merge CI attempt passed the retention regressions but failed the
previously intermittent six-card HNSW retrieval assertion. Its new diagnostic
returned zero ANN candidates and twelve forced-exact candidates, with the seed,
presentation and exact audio available. This is an executed test failure,
distinct from the resolved runner outage. Retention's separate fixture databases
and unchanged retrieval source give no evidence of a retention regression. The
single failed-job retry passed; all required jobs in
[post-merge run 37387086276](https://github.com/JesusFilm/forge/actions/runs/37387086276)
then passed or were appropriately skipped. This does not establish or repair the
intermittent cause. Eight fresh-schema isolated PostgreSQL 18.6 / pgvector 0.8.7
runs passed. Their actual HNSW plans attached the provenance/audio subplan to
the index filter, with eight loops and 1,197–1,199 rejected rows per loop. Those
passing plans do not explain the failed CI plan. Four later attempts failed at
fixture setup because the local host ran out of disk space, not during ANN
retrieval. The owned disposable database was removed and no speculative source
change was retained. The separate
[feat-609 follow-up](../roadmap/content-discovery/feat-609-filtered-hnsw-fixture-recall.md)
records the missing failed-plan/settings diagnostics and required regression
proof. Production failure is not inferred from this fixture alone; no hard
dependency or retention acceptance was moved from feat-554.

The October 7 investigation on main `1daa80373` added seven complete delivery-file
passes and three targeted HNSW passes on owned PostgreSQL 18.6 / pgvector 0.8.7.
The preceding 19-file recommendation CI batch also passed 121 tests before the
last complete-file run without a database reset. None reproduced ANN zero. PR
[2595](https://github.com/JesusFilm/forge/pull/2595) records failure-only actual
plan/settings diagnostics and a transaction-local scan-memory comparison. Its
same-statement diagnostic rerun is not the original failed execution, and the
original candidates remain the assertion input. Exact head
`b49433f377806332becce811447fef8d264a887c` passed independent review, 19 executed
checks and seven expected scope skips, then merged as `20f55715c` at October 6
20:39:44 UTC. This changes tests and documentation, not delivery behavior.
Feat-609 remains in-progress; the passing checks do not establish a cause or fix.

The October 6 ordinary cycle on actual Admin HTTP/worker revision `0cb08416c`
also failed. The 19:41 UTC bounded ledger snapshot contained 980 successful
purges, ten `SKIPPED` / `budget_yield` attempts and 86 failed attempts. The 990
successful workflow wrappers include those ten handled yields; they are not
990 completed purges. Successful purges committed 5,057 roots, 17,590 served
items and 4,900 standalone episodes. Yields separately committed 651 roots;
failed attempts committed no roots but did retain 420 standalone episode
deletions. Both ledger caps were not reached, and aggregate agreement does not
establish direct per-attempt linkage.

Six initial failures reported expired/closed transactions between 10:30 and
11:29 UTC. Eighty later failures, beginning at 13:51, reported PostgreSQL
`P0001` during `recommendationRequest.deleteMany` with the exact guard text
`published profile projection children are immutable`. A separate 19:44:59
read found 81 later guard failures, confirming continued rejection after the
last successful expiry cutoff, 13:49:56.061. These trigger rejections are distinct
from the earlier timeout failures and the safe budget yields.

Read-only production schema metadata confirms that the contribution's
`source_eligibility_decision_id` foreign key uses `ON DELETE SET NULL`, while a
check requires that ID and its revision to be null together. The published-child
update guard permits source-outcome detachment but rejects eligibility-reference
detachment. An isolated PostgreSQL reproduction hit that exact guard and rolled
back parent deletion. The proposed forward migration then allowed actual FK
cleanup while retaining the contribution evidence. Native checks rejected
direct eligibility unlinking, non-null reassignment, revision-only and mixed
content changes, a nested non-FK trigger attempt and published-interest edits.
Existing outcome-reference cleanup and selection cascades still passed.

The populated-schema purge/lock regression recorded `FAILED`, zero root credit
and an unchanged success watermark before the fix. After migration it recorded
`SUCCEEDED` with exactly one root, item, outcome and eligibility decision deleted,
while preserving the contribution's other fields. Focused regressions and the
five-test native standalone-retention suite passed. Independent review approved
exact head `a9cd1c596764cb5f0483f7310fa0721dcec1a846` on
[2594](https://github.com/JesusFilm/forge/pull/2594#issuecomment-6024710712).
All 19 successful checks and seven expected scope skips were inspected, including
every underlying Forge CI job. The normal squash merge is `2913616a2` at
October 6 20:23:11 UTC. Post-merge Forge CI also passed;
actual migration application and process revisions are recorded below. No production schema or data mutation
was used to investigate. This trigger correction does not by itself explain or
repair the six earlier timeouts. A bounded read of those six stored errors found
rejections in one eligibility-decision count, one request-root deletion, two
request-free episode deletions, one playback-fact count and one unobserved
operation. Wrapper durations were 5,030–8,820 ms. These are rejection locations,
not proof of which statement consumed the budget; no single further source
correction is established by that evidence.

At 19:41:43 UTC, all 21 retention-health types still had zero rows more than
24 hours overdue. HTTP/worker health, compact traces and runner roles were
correct, but the scheduler was continuing bounded catch-up with no successful
purge after 13:49 in the observed window. Separate capacity reads at 19:41:49
and 19:41:56 found 117,440,512 WAL bytes, no lock waiters or long transactions,
an empty 24,576-byte legacy stage, and 22,426,816,512 bytes free of
48,891,670,528 on PGDATA. This does not establish sustained retention health or
new physical reclamation. Aggregate receipts are under
`outputs/heartbeats/20261006T1939-daily/` in the storage evidence directory.

Normal release verification found migration 0129 started at 20:32:40.565 UTC
and completed at 20:32:40.596, with one applied migration record, a matching
checksum, exact guard-body parity and one active update guard. By 20:36:58,
both actual Admin processes ran `2913616a2`: HTTP deployment
`34f97d76-b62a-42c5-b8d6-91c26f6372e4` and worker deployment
`97adfc5e-00d3-42a2-84f6-a22794fe44dd` were successful, health 200, compact,
with HTTP runner disabled and worker runner enabled. Between migration application
and that both-role verification, five successful purges committed 500 roots and
three budget yields committed another 300; no failures were observed in that
bounded interval. Database behavior changed before both process revisions were
verified, so those attempts are not proof of both-role convergence.

After both-role verification, the bounded 20:37:46–20:38:11 natural scheduler
window recorded eight successful attempts in both ledgers, 800 request roots and
2,877 served items deleted, and no failures or budget yields. At 20:38:57, all 21
health types had zero rows more than 24 hours overdue and the success cutoff had
advanced to 20:38:08.969. Capacity reads found 22,393,917,440 bytes free on PGDATA,
117,440,512 WAL bytes, an empty 24,576-byte legacy stage and no lock waiters.
Web was separately healthy with Watch 200, and the 50,000 MB volume was ready.
These bounded recovery observations do not erase the 98 pre-migration failures
in the later release snapshot, including the six unresolved deadline errors.
Sanitized release receipts are under
`outputs/heartbeats/20261006T2024-pr2594-postmerge/` in the storage evidence directory.

There are **zero qualifying cycles** through the failed October 6 cycle. Both
Admin roles must run `2913616a2` or a verified descendant containing the repairs,
and migration 0129 must actually be applied, before attributing future evidence
to the full repair.
Natural catch-up demonstrated request-root deletion, declining overdue backlog
and restoration of the serving-health criteria; recovery cannot qualify the
already failed cycle. Two later ordinary loaded, failure-free daily cycles at the normal
10:30 UTC schedule must provide descendants, throughput, lock skips, backlog,
oldest expired age and headroom evidence. Manual, recovered or empty runs cannot
manufacture this proof. No replacement ticket hides the unfinished work.

The existing `recommendation-storage-daily-check` heartbeat remains with the
storage owner, updated to send meaningful results to the coordinating chat and
prepare the scoped feat-554 evidence PR when proven. Parent owns review, merge
and the final inventory/index update; the monitor ends only after that merges.
The existing `co-watch-24-hour-production-check` retains its requested first
comparison and subsequent weekly reports, with current lifecycle and unknown
cause boundaries. No duplicate automation or production fault was introduced.

### October 23 pre-cycle checkpoint

The earlier October 6 receipts above remain historical. The [October 23 rollout report](2026-10-23-watch-exposure-fortnight-rollout.md#strict-stored-expiry-release) records actual convergence of both Admin roles on `85e97f521` at 09:03:53 after reviewed, green #2878. Both manual entry paths now enforce stored-expiry scope, including old persisted manual workflow inputs. Its 80 focused unit tests, seven native retention-tail tests and five native generation-retention tests passed. The already-running daily 10:30 UTC scheduler was reverified at 09:12:17 with its durable runtime RUNNING and no error; #2877 records 46 workflow/job tests. The daily process runs in production independently of the Codex read-only monitor, with bounded continuation when backlog remains. These receipts establish installed automation, not success of its future daily cycle.

The authorized manual campaign's first 36 windows committed 8,509 request roots and recorded descendants across 250 successful attempts and six budget yields. Window 37 was interrupted, retains partial counts and RUNNING ledgers, and receives no completion credit or replay. The strict-mode release resolves the manual entry-path scope defect, but two earlier profile-erasure completions remain of unknown historical expiry eligibility, with a possible scope breach explicitly retained. No source-confirmed memory leak or provider-confirmed OOM cause is asserted. At 09:05:27 the 26-type expired total was 8,369 with zero more than 24 hours overdue; a separate profile-session-link sample reached its 1,001 cap. This is not a zero-backlog result. Any distinct manual recovery requires fresh safety gates and separate reconciliation, as recorded in the rollout report.

Feat-554 still requires two later ordinary loaded failure-free cycles; the October 22 failures and manual campaign earn zero credit. Feat-756 keeps the separate October 27 old-exposure expiry wave and capacity verification open. The HNSW assertion failed again on #2878's main merge and passed one unchanged failed-job retry. Ten unchanged local full-file passes, bounded fixture experiments and matching observed CI image/version details establish no supported correction: feat-609 remains open, with no proven fix or production retrieval defect. Its ticket records the next discriminating experiment on a naturally failing original-geometry index; no runtime or assertion change resulted from this investigation. The active plan remains active, the daily storage monitor remains active, and the expired temporary outage monitor remains paused. Delivery reliability, accepted coverage limitations and unmeasured usefulness remain separate.

The distinct window 38 admission was held without launch at 09:18:15: worker memory rose above the revised 4 GB admission limit, despite unchanged actual process identity, health 200 and zero OOM kills. No cleanup command or new attempt was issued. The normal daily scheduler remains enabled, the manual backlog remains uncleared, and any later manual recovery needs a fresh separate decision. The rollout report retains the exact readings and separate capacity snapshot.

### October 24 checkpoint

The [October 23 ordinary-cycle receipt](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6363320357)
supersedes the unresolved backlog in the pre-cycle checkpoint above. Independent
review accepted one qualifying loaded, failure-free feat-554 cycle: 85 successful
scheduled passes cleared the fixed 12,129-row cohort, with a final success
watermark at 10:51:19.463 UTC and a return to daily sleep. No manual purge
launched. Each pass averaged 3.61 seconds; catch-up took 20 minutes 4 seconds
including pauses. Newly expired rows after the watermark remained eligible for
later scheduled cleanup; no global-empty or filesystem-recovery claim is made.

October 24 does not supply the second qualifying cycle. The bounded diagnostic
captured nine failed scheduled wrappers by 12:51:53 UTC: five expired/closed
interactive transactions, two explicit batch-deadline errors, one generic
transaction error and one terminated connection. Seven durable failures were
recorded in an earlier snapshot, with one stale RUNNING entry. There is no shared
per-attempt key, so these ledger entries must not be paired by timestamp. The
reported error operation does not prove the budget-consuming statement; runtime
diagnosis continues without a speculative timeout fix.

At the separate 12:50 snapshot, the fixed 10:30 cohort was clear across the 26
monitored families, while 1,196 currently expired rows remained across those
families and none were over 24 hours overdue; 31 expired profile-session links
were counted separately. Both actual Admin roles ran healthy, compact `6360b78ca`,
with no retention code change from `85e97f521`. PGDATA free space was
9,684,131,840 bytes, WAL 201,326,592 bytes, and lock waiters/long transactions zero.
The normal scheduler remained in bounded catch-up. These observations establish
continued cleanup, not a failure-free run. The [feat-554 ticket](../roadmap/platform/feat-554-recommendation-storage-rollout-verification.md#october-24-failure-after-one-qualifying-daily-cycle)
records the dated evidence and acceptance limits. One further qualifying cycle
is required; feat-756 and feat-609 retain their separate unresolved requirements.
The scope stays 12 complete, 25 cancelled and three open. The daily monitor stays
active and the expired temporary outage monitor stays paused.

### October 26 current checkpoint

The independently reviewed [two-cycle receipt](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6425467086)
records genuine scheduled failures on October 25 and 26: 37 and nine failed
wrappers respectively. The durable ledger independently records 37 and eight
failures, with one stale RUNNING entry on October 26. No per-attempt pairing is
inferred. Both cycles deleted loaded data; neither supplies another failure-free
cycle. October 23 remains one accepted cycle, and feat-554 remains in progress.

Each bounded ledger scan returned 940 rows without reaching its 20,001 cap.
October 26 evidence is only as of 19:27:51 UTC despite the query's later 21:00
upper bound. Across all completed scheduled wrappers, including failures,
passes averaged 4.380 seconds on October 25 and 4.005 seconds on October 26;
elapsed first-start-to-last-finish spans were 6h40m33s and 1h46m52s. These spans
and committed counters do not prove current backlog clearance. The scheduler
snapshot retained the daily next wake at October 27 10:30 UTC.

[PR #2900's actual release](https://github.com/JesusFilm/forge/pull/2900#issuecomment-6385131395)
installed phase diagnostics after the October 24 failure. It did not fix a proven
timeout cause. The newly confirmed logging-format/consumer mismatch was corrected in #2915,
with the actual release recorded below; historical Railway request-handler
evidence does not establish missing worker records. A transient worker 503 at 19:19:58 recovered
to 200/ok on two checks of the same deployed revision/ID, but the uncaptured
initial body and absent child identity leave cause and process/container
continuity unverified. No Redis/retention causality is claimed.

The subsequent independently reviewed 19:31-19:33 UTC incident bundle found
both roles healthy/compact with correct runner roles, **26,194 newly expired
rows** across 26 monitored families, and zero over 24 hours overdue. The fixed
October 25/26 daily-start cohorts were clear across those families. Current
backlog remains nonzero; additional proof eligibility was not sampled. PGDATA
free space was 7,503,618,048 bytes, WAL 771,751,936, with no lock waiters or long
transactions. These are separate snapshots, not a growth forecast or physical
reclamation proof. The capped Watch sample found no expired exposure before
the first stored expiry at October 27 01:54:46.228 UTC; the old-wave throughput
and capacity requirement remains open. A service health response is not a
retention-health result, and missing filtered phase logs do not prove no errors.
The [feat-554 checkpoint](../roadmap/platform/feat-554-recommendation-storage-rollout-verification.md#october-26-follow-up-continuing-deletion-with-failures)
retains the probe/cap, acceptance and transport limits. Subsequent #2916 reopened
feat-573, bringing the current scope to **11 complete, 25 cancelled and four
open**. Feat-756 and feat-609 retain their separate requirements. Keep the daily
monitor active and the expired outage monitor paused. No manual cleanup or
direct deployment follows from this receipt.

### October 26 diagnostic-format release

[PR #2915](https://github.com/JesusFilm/forge/pull/2915#issuecomment-6426563731)
merged normally at 20:25:18 UTC as `f27980447bef1bc24c815553698501afb9f6bc2e`.
Its exact reviewed head `5964d4806` passed all 28 PR checks: 20 success and eight
expected scope skips, including executed native PostgreSQL retention steps.
Independent review passed 44 focused unit/CLI tests and a split UTF-8/oversized
line check. The repair makes bounded sanitized failure logs consumable without
changing retention expiry, transaction/pass budgets, ledgers or error semantics.
It does not establish the production timeout cause or earn cycle credit.

The later Co-watch merge `63a1ccc40` preserves the retention service, diagnostic
formatter, parser, scheduler and job byte-for-byte. Its push cancelled two
unfinished `f27980447` main-CI jobs under the existing concurrency rule; those
jobs are not passing validation. Replacement forge-ci `40396568321`, including
the native retention steps, production-image `40396568323`, and all four CodeQL
analyses in `40396566760` passed. No retry or direct deployment was used to force
convergence. Co-watch's
separate graph-statement budget change does not authorize changing retention's
guards.

The [independently accepted actual release](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6427367206)
sampled both Admin roles on `63a1ccc40` at 20:59:48.987-20:59:53.009 UTC, health
200/ok, compact and correct HTTP/worker runner roles. At 21:00:15 both independent
ledgers had zero new attempts from 20:59:53; a future query bound is not future
evidence. The separate log window through 21:01:56 had zero phase events. These
observations do not establish loaded cleanup or execution/transport of the new
error-log path in that window. The
scheduler returned to its ordinary October 27 10:30 UTC wake, with the success
cutoff still predating release.

Current expiry was 32,024 rows across 26 families, zero over 24 hours overdue;
the fixed daily-start cohorts were clear. A separate pending-erasure probe
returned one recent request without a stored-expiry guard, and generation-proof
eligibility remains unmeasured. PGDATA free was 8,080,678,912 bytes and WAL
184,549,376 at separate measurement times; no global-empty or physical-recovery
claim is made. The receipt retains sample caps, source-definition provenance
limits and the upcoming Watch expiry-wave obligation. Keep feat-554 open with
one qualifying cycle and the existing daily monitor active. The expired outage
monitor remains paused; this release grants no new daily-cycle credit.

### October 27 exhausted-budget correction and cleanup handoff

The owner explicitly requested a dedicated GPT-6 Astra task to fix cleanup and
clear the stored-expired backlog. The preceding storage task stopped edits and
manual invocations; its existing daily monitor remains read-only. Parent retains
independent review, normal merges and shared production coordination. These
later cleanup requests authorize bounded expired-only recovery, subject to fresh
admission evidence; the historical one-pass-only restrictions above do not
cancel that authorization.

[PR #2920](https://github.com/JesusFilm/forge/pull/2920) fixes a reproduced
pre-work boundary defect: zero or negative remaining budget previously threw
before the nonterminal safe-yield guard. Yield finalization now uses a separately
bounded ledger-only transaction with RUNNING-state compare-and-set and durable
counter validation. A result is yielded only after commit acknowledgement;
genuine operation, transaction and bookkeeping errors remain failures. An
uncertain acknowledgement cannot overwrite a committed terminal ledger. The
five-second cleanup budget remains unchanged.

The exact [reviewed head](https://github.com/JesusFilm/forge/pull/2920#issuecomment-6429116796)
`da3104825` passed 94 focused tests, nine native PostgreSQL 18 tests, Admin lint,
typecheck, full format and normal hooks. The native regression fails on the
unmodified base. All applicable PR checks passed, including the actual native
retention steps, production image and all four CodeQL analyses; seven unrelated
scope/event jobs were expected skips. Normal squash merge `ce23241a9` completed
October 26 at 22:54:20 UTC with the same reviewed tree. Main forge-ci, production
image and all four CodeQL analyses subsequently passed. The [release receipt](https://github.com/JesusFilm/forge/pull/2920#issuecomment-6429275387)
records actual HTTP verification at 23:15:00.760 UTC and worker verification at
23:08:28.256 UTC, both on exact `ce23241a9` with matching retention source hashes,
health 200/ok, compact mode and the correct runner roles. These are separate
recorded observations, not a simultaneous sample.
This correction does not identify the SQL behind the historical P2028 failures.

Two earlier authorized manual invocations committed 200 request roots in total;
the second yielded safely. The last completed drainage window still had 35,168
rows in its fixed expired cohort and 35,730 currently expired rows at different
measurement times. These counts do not establish whole-backlog clearance or
physical disk recovery. The later read-only release snapshot at 23:15:49 UTC
found 39,404 currently expired rows across all 26 current retention-health
families and zero over 24 hours overdue; its separately measured fixed
23:15:00.760 cohort contained 39,390 rows. Other expiry categories outside these
26 families were not remeasured, including owner-release and old retention-run
ledger cleanup categories, so no global backlog claim is supported.

Both bounded ledgers contained zero attempts in the observed window from the
worker's first verification at 23:04:57.764 through 23:15:41.021866 UTC; caps were
not reached. Most of that window precedes final HTTP verification. There is no
observed post-release deletion behavior. The successful expiry cutoff remained
21:45:44.183, includes manual success and is not execution completion or daily
cycle credit. The existing scheduler ledger and runtime remained RUNNING without
error, with next wake October 27 at 10:30 UTC. Historical unfinished entries
(23 durable and three wrappers) were preserved without replay or rewriting.

At the separate 23:16 capacity readings, PGDATA had 8,025,223,168 free bytes,
WAL 167,772,160 bytes, and lock waiters and long transactions were zero. Watch
exposure had zero expired rows in the backlog snapshot and an 8,300,552,192-byte
relation, with first stored expiry October 27 at 01:54:46.228 UTC. These are
dated observations, not a disk-reclamation or future-capacity forecast.

Admission was held at the 23:08:28 worker reading: 4,573,614,080 bytes
of 8 GB exceeded the then-current 4 GB gate despite health 200/ok and zero OOM kills.
The HTTP rollout was incomplete at that admission snapshot and verified later;
No second admission sample or manual pass followed in that release-verification
window, which made no production mutations. The subsequent user decision below
supersedes this operator-imposed memory gate.

Reconcile each bounded expired-only pass under the current operating policy
below. Do not delete ahead of stored expiry or widen timeouts. The October 27
Watch expiry wave and capacity proof remain separate requirements. October 23
still supplies the only accepted ordinary loaded failure-free cycle; manual
passes add no credit. Keep feat-554 and feat-756 open, the daily monitor active
and the expired outage monitor paused. The scope remains 11 complete,
25 cancelled and four open; accepted coverage and unmeasured usefulness are
unchanged.

### October 27 worker capacity and resumed deletion

The [independently reviewed operating receipt](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6430556334)
records the user's removal of the 4 GB and no-rising-memory admission rules and
authorization of additional worker headroom or a dedicated worker. No arbitrary
replacement reserve applies. Direct container memory and OOM measurements are
sufficient for operational tracking; Datadog and a completed allocation
diagnosis are optional. Earlier holds remain dated history.

The existing production `@forge/admin/worker` limit changed from 8 to 16 GB,
with CPU unchanged at 8 and the plan's 24 GB allowance verified first. Both the
API and actual container confirmed 16,000,000,000 bytes. At 00:13:45.045 UTC,
the worker used 6,014,173,184 bytes with zero OOM kills; PID 1/start time and
deployment were unchanged. No restart, redeploy, new service or heap-setting
change was issued. Actual HTTP and worker remained healthy, compact, on
`ce23241a9` with the expected source hash and correct runner roles.

The first authorized pass started at 00:14:39.167 UTC and committed **50 request
roots**, then returned expected CLI exit 3 with continuation required. Its
durable ledger recorded `SKIPPED/budget_yield`; every deletion counter matched
the CLI. The sole manual wrapper succeeded without an error in 4,510 ms. This
is committed partial deletion, not complete cleanup or a new success watermark.
The fixed October 26 23:15:00.760 cohort fell from 39,390 to 39,299 eligible
rows across the 26 measured families. That inventory differs from deletion
counter coverage. Rolling expired inventory was 41,761 at its later read,
including newly expired arrivals, with zero more than 24 hours overdue.

Ninety direct one-second container samples had a sampled peak of 4,322,250,752
bytes, the same worker process and a 16 GB enforced limit, with no OOM or limit
events. This is sampled whole-container memory, not isolated CLI allocation or
a continuous maximum. Post-pass checks found both roles healthy, no lock waiters
or long transactions, and 8,030,261,248 free PGDATA bytes. No disk-reclamation
claim follows. Immutable evidence is retained under the Astra task's
`outputs/capacity`, `outputs/release/actual-capacity16verified.json` and
`outputs/onepass20261027`; the latter's 34-file manifest was independently
verified by the parent.

Parent authorized continuation in windows of at most five distinct passes or
five minutes, with exclusive attempt recording and both-ledger reconciliation
after each. A matching committed positive-progress yield permits the next
distinct pass. Actual errors, uncertainty, mismatched counts, no progress,
unhealthy service/OOM/limit events, competing cleanup or unsafe database/capacity
conditions stop the window. The removed memory rules do not reappear as gates.

The next window stopped after its first distinct invocation at 00:21 UTC.
Both ledgers record a real failure after **100 further committed request roots**,
plus 100 each of profile projection runs, contributions and interests. The
manual wrapper failed in 5,102 ms. The saved error reports an already expired
transaction: 854 ms allowed versus 870 ms elapsed; it does not retain an explicit
Prisma error code or failing phase. The recorder did not retain failed CLI
stdout/stderr, so the exact statement is unproved. No second pass or replay
followed. The fixed cohort fell from 39,299 to 38,861; rolling current expiry
was 41,548 at its later read, with zero over 24 hours overdue. Both services
remained healthy on the same release/process, worker memory was 4.702 GB of
16 GB with zero OOM kills, and PGDATA had approximately 8.044 GB free. This is
a database transaction failure requiring investigation, not reinstatement of a
removed memory rule. Astra owns the residual transaction-expiry repair; no
further manual invocation is currently authorized until reconciliation and
parent coordination of the correction.

The normal daily scheduler remains enabled at 10:30 UTC; the existing daily
monitor remains read-only. Manual passes earn zero ordinary-cycle credit, so
feat-554 remains in progress and global expired-backlog clearance is unproved.

### October 27 post-configuration admission repair

A [later distinct manual pass](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6430999381)
committed another 100 request roots with matching durable counters and a
successful 4,535 ms wrapper, then yielded. The fixed cohort fell to 38,431 and
rolling current expiry measured 42,068 across 26 families, with zero more than
24 hours overdue. This brought post-resize committed roots to 250 across three
invocations, including the earlier failed partial attempt. Both roles remained
healthy, the worker enforced 16 GB with no OOM/limit events, and PGDATA had
8,030,769,152 bytes free. The successful expiry cutoff did not advance; manual
work earns zero ordinary-cycle credit.

The initial query/index experiment was excluded from release. Its extreme-skew
fixture improved with a composite index, but a catalog-like distribution ran
both query shapes in approximately 3.3 ms using the existing index. One bounded
production `EXPLAIN` without `ANALYZE` confirmed the request-order scan shape,
not actual rows scanned, timing or the cause of the earlier failure. No index
migration, production `ANALYZE` or fault injection followed.

[PR #2923](https://github.com/JesusFilm/forge/pull/2923) instead fixes a separately
reproduced admission boundary: after successful timeout configuration, a
nonterminal phase now rechecks the existing 750 ms floor before starting its
domain operation. The five-second budget and actual-error semantics remain
unchanged. A native PostgreSQL 18/Prisma 6.19.3 regression adds a local 5,100 ms
client acknowledgement delay. Against exact base `054c24b38`, it attempts the
domain read on an expired transaction and fails; with the final code, no domain
read begins, the ledger commits `SKIPPED/budget_yield`, backlog remains unknown
and the success cutoff is unchanged. This proves the missing boundary, not the
cause of the historical production 854/870 ms failure.

Independent review approved exact head `03b9788a` and its five-file scope.
Fifty-seven focused tests, ten native tests, full Admin typecheck, normal hooks
and all applicable PR checks passed, including the actual native retention
steps, production image and all four CodeQL analyses. Normal squash merge
`742f25c2` completed at 01:18:13 UTC with the identical reviewed tree. Actual
HTTP at 01:26:39.874 and worker at 01:26:43.858 both ran that exact revision with
matching runtime and diagnostics source hashes, health 200/ok, compact mode and
correct runner roles. The normal rollout changed process identities; the worker
retained its actual 16 GB limit and had zero OOM kills. Main CI `40431771400`,
image `40431771567` and CodeQL `40431770882` all passed: 17 required jobs
succeeded and eight conditional jobs were expected skips. The actual native
retention and production migration/startup steps succeeded. Fresh actual-role
checks at 01:35:40–44 UTC confirmed the same release before cleanup. The parent
verified the release's 23-artifact manifest. The reviewed local recorder
preserves safe failure diagnostics and stops on incomplete capture without replay.

The subsequent window attempted exactly three distinct expired-only passes.
The first two yielded with matching CLI/durable counters, committing 50 and
100 request roots with successful wrappers in 4,404 and 4,623 ms. The third
failed in 5,087 ms after another **100 committed roots**; its durable counters
remain authoritative despite the absent success payload. Total committed roots
for this window are **250**, bringing the post-resize total to **500 across six
attempts**. The two failed partial attempts remain failures. No fourth pass or
replay followed, and no outcome is unknown. The parent verified all 80 window
artifacts; reconciliation SHA-256 is
`47e7b7475b16ae010bde54528686d7e41d340ad8ccc55b3c7f6f5d59ba078e27`.

The safe phase event records P2028 in `projection_decision_unlink_page`:
796 ms at admission, 808 ms in the incomplete operation, and 3 ms each for
acquisition, advisory lock and configuration. The bounded wrapper classifier
identifies `recommendationPersonalizationDecision.findMany` and an expired
transaction with 802 ms allowed versus 812 ms elapsed. The slowest completed
operation was root deletion at 971 ms. This localizes the new failure to
admitted operation work; it does not establish SQL execution cost, query-plan
cause, database CPU or the historical 854/870 ms failure's cause. The new
configuration guard correctly leaves this genuine failure classified as failed.

The fixed October 26 23:15:00.760 cohort fell from **38,431 to 37,442** eligible
rows. Current expiry fell from **44,345 to 43,474** across 26 health families,
with zero more than 24 hours overdue at those reads. Inventory coverage differs
from deletion-counter coverage. Separate bounded probes found **at least 1,001
expired profile-session links** (cap reached) and **one pending profile erasure**;
the other seven extra categories measured zero. Those extras are outside the
26-family total. Watch exposures had not yet reached their first stored expiry
at the 01:38 UTC observation. Neither inventory establishes global clearance.

Three hundred one-second samples from 01:36:06.951 to 01:41:06.249 UTC kept the
same worker process and 16 GB limit, with a sampled peak of 7,391,711,232 bytes
and zero OOM, memory-limit events or CPU-quota throttled periods/time. Both roles
remained healthy on the exact release, PGDATA had 7,956,422,656 bytes free, and
there were no lock waiters, long transactions or overlapping cleanup. Per-pass
bracketed shared-worker CPU was 3.957, 9.490 and 1.771 CPU-seconds; this includes
other worker activity and is not isolated retention CPU. Row mixes differed and
the last pass failed, so these observations do not prove an efficiency gain.

Astra owns the targeted selection/operation repair with representative work
measurements and preservation of full-drain correctness. Parent coordinates
review, merge and the next manual window after normal deployment. The removed
memory rules remain removed. Keep feat-554 open, the daily observer active and
the temporary outage monitor paused. Manual work supplies zero ordinary-cycle
credit and these yields/failures do not advance the success watermark.

The user clarified that deletion efficiency means reducing CPU and database
work per committed expired row, with useful drain progress. The capacity
increase and admission correction do not prove that outcome. A CPU cap,
additional delay, reduced concurrency, smaller final result limit or increased
timeout alone is not an efficiency improvement. Future claims need comparable
workload measurements of committed rows, elapsed time, attributable CPU and
live-request latency, guided by measured expensive phases. Shared-worker CPU
and health-probe timing remain contextual proxies. Separate profile eligibility
reconciliation failures from retention failures; neither path has been proved
to cause the originally reported CPU spike.

### October 27 projection-decision selection repair

[PR #2926](https://github.com/JesusFilm/forge/pull/2926) changes only the expired
projection-decision selection path, its guarded unlink, native regressions and
the existing CI test invocation. Selection now starts from expired generations
with referenced decisions, using the existing expiry and projection-reference
indexes. Updates match the captured request/reference pair and recheck expiry,
preserving a concurrent repoint or expiry extension. No index migration,
timeout increase, higher admission threshold, sleep or CPU cap was introduced.

A local stale-statistics fixture reproduced the previously observed estimated
request-primary-key/Memoize plan shape. The original query examined 182,895
decision heap rows to return seven late eligible links, taking 1,112.029 ms and
212,194 local buffer accesses. The final helper took 57.553 ms, 2,771 buffer
accesses and seven decision heap rows on that fixture. The previously reported
267 ms result belonged to an intermediate candidate. High-fan-out and live-only
skew fixtures also avoided the unrelated decision scan. This establishes local
work reduction, not the cause of the historical production timeout or CPU spike.

The parent search is not globally work-bounded: retained expired generations
without matching decisions still require existence probes. A 100,000-parent
late-link fixture took about 383 ms; 259,122 parents with late links took
1,093.567 ms. Native tests retain the large empty-prefix case and finite-drain
checks. Exact parameterized SQL under forced custom and generic server plans
retained the tested existing-index paths; this does not certify automatic
Prisma prepared-session reuse for every parameter distribution.

Five matched local select/guarded-unlink trials affected 35 rows in each
variant. PostgreSQL backend CPU measured 497 ticks/4.97 seconds for the original
and 17 ticks/0.17 seconds for the candidate at 100 ticks/second. The benchmark
uses a raw guarded update rather than Prisma's exact OR-pair update, runs the
original trials first and rolls back outside measurement. It is directional
local evidence, not application CPU, committed production throughput or CPU
per committed request root. Live-request-latency effects remain unproved.

Independent review approved exact head `b0c74dc4`, with all four source files
matching the frozen reviewed snapshot. Local checks passed: 80 focused tests,
37 PostgreSQL tests, full Admin typecheck over 1,678 roots/four shards and
normal hooks. An initial composition run timed out at its existing 30-second
test deadline and left two dependent skipped-status failures. A fresh isolated
rerun passed all 14 tests with unchanged code, assertions and deadlines; the
30-pass scenario took 27.789 seconds. The failure and rerun are both retained.

All 29 PR contexts finished: 21 success and eight expected skips, including
actual native retention/precomputed steps, production startup and all four
CodeQL analyses. Normal squash merge `50cb6a3e` at 02:53:42 UTC preserves the
exact reviewed tree. Main forge-ci `40441066194`, production image `40441066146`
and CodeQL `40441065908` completed successfully, including required job and
validation-step inspection. Read-only verification at 03:18–03:19 UTC found both
actual Admin roles on that exact revision with the reviewed service/helper and
diagnostic hashes, compact mode, correct runner roles and health 200/ok. The
worker enforced 16 GB, used about 3.592 GB at that sample and recorded zero OOM
or memory-limit events. Health probes do not establish live-request reliability.

At the 03:18–03:19 UTC release snapshot, no cleanup had run on this repair;
the then-known total was 500 roots across six post-resize attempts, including
two failed partial attempts.
The fixed October 26 cohort remains 37,442. The moving inventory now contains
65,913 expired rows across the 26 health families, including 17,593 Watch
exposures whose stored expiry has passed; none was over 24 hours overdue at
that read. Additional inventory has at least 1,001 expired profile-session
links. The one pending profile erasure is not stored-expired eligible; the
other seven extra categories are zero. PGDATA available space is
7,949,406,208 bytes, with no lock waiters or long transactions. The success
watermark is unchanged. These observations do not prove whole-inventory
clearance, physical reclamation or production CPU efficiency.

Independent review accepted the source and execution-lifecycle evidence for
exactly the 23 historical unfinished durable rows and three wrappers. The old
process generations have ended; the two scheduled wrappers and one direct-CLI
wrapper do not resume those records, and retries create new records. The 301
historical committed roots remain preserved and are not new deletions. The
exception is bound to the reviewed identities and state fingerprints; fresh
per-pass overlap checks still cover new work from the live daily scheduler.
Parent coordinated the first bounded window with the separate Web rollout;
its outcome and the later failure are recorded below.
Keep feat-554 in progress with its ordinary-cycle requirement.

The [normal release receipt](https://github.com/JesusFilm/forge/pull/2926#issuecomment-6433027360)
and [root receipt](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6433027727)
retain the dated release and inventory observations. Parent verified all 106
release artifacts against manifest SHA256
`74c70cd03e2049dcdaf19301bbaa2f4fb9a60e6fecd00b95b52de37cb830e399`.
The subsequent historical execution review is bound to receipt SHA256
`ea8da655385f2969aa10dcff602b95e7802b6086912448fd8b753c6b6d326207`;
it does not mutate old records or grant ordinary-cycle credit.

### October 27 resumed cleanup and root-delete failure

The first window on `50cb6a3e` completed two normal budget yields, committing
200 request roots and 2,000 stored-expired Watch exposures. Both wrapper and
durable ledgers matched every counter with no error or unknown outcome.
Independent review accepted the dated evidence, including the exact fresh
readiness receipt. Peak worker memory was 7.261 GB of its enforced 16 GB, with
zero OOM or limit events. The fixed cohort fell 37,442 to 37,198; the moving
26-family inventory fell 72,167 to 69,963. These inventory changes are not
substitutes for committed deletion counters.

The next window attempted three distinct passes. The first two yielded
normally and committed 50 roots each. The third committed another 50 roots
and 1,000 Watch exposures before an actual `delete_request_roots` failure.
The authoritative window total is **150 roots and 3,000 Watch exposures**;
the early success-only total of 100 roots omits the failed partial commit.
Both ledgers retain the third failure and its committed counters. All later
windows in the finite series were cancelled without invocation or replay.
Today's cumulative known manual request-root count is 850, including three
failed partial attempts across releases. The 301 historical orphan-run roots
remain separate and unchanged. Manual work earns zero ordinary-cycle credit.

Natural diagnostics identify root-delete ordinal 17, operation stage,
`PrismaClientUnknownRequestError`, with 853 ms at admission and 855 ms in the
failed operation; SQLSTATE is unavailable. The previous 50-root chunk took
1,337 ms in its operation, 1,387 ms overall, with 2,247 ms at admission.
This localizes the failure but does not prove its SQL, lock, client or CPU
cause. The 750 ms admission floor does not guarantee an admitted operation
will finish. No timeout or admission-floor increase is established as a fix.

The second window's original postcheck remains false: its final release-probe
helper failed before emitting the actual-health report, so the subsequent
filesystem observation was also absent. This is not evidence of a runtime
revision mismatch. A separately archived 04:06:50 UTC read-only follow-up found
both actual roles healthy on `50cb6a3e` with unchanged process identities and
about 7.926 GB PGDATA available. That later observation does not replace the
original missing postcheck. Peak worker memory was 7.636 GB of 16 GB with no
OOM or CPU-counter reset.

The fixed cohort fell 37,198 to 36,997 and the moving 26-family count fell
71,755 to 69,109; extra expiry categories remain separately recorded. The
backlog is unresolved. Counters from both windows cover early phases and do
not establish execution of the rewritten projection-decision selector or
progress in later phases. Shared-worker CPU and health latency remain proxies;
there is no causal production-efficiency claim.

Astra owns the bounded root-deletion investigation and repair. Further manual
cleanup requires reviewed evidence, normal deployment of any code correction
and a new parent-coordinated window. The daily production scheduler remains
enabled. Preserve the stopped series, partial commits, separate failed
postcheck and truthful feat-554 acceptance.

### October 27 root-chunk cost admission repair

[PR #2930](https://github.com/JesusFilm/forge/pull/2930) merged normally at
04:51:01 UTC as `e25a0a7d92bfbb0ae76ed1ed8a2d10294410f77f`. Its tree matches
the independently reviewed head `a760e359`; all 29 PR checks completed with
21 successes and eight expected skips. The parent inspected the individual
jobs and validation steps, including the PostgreSQL retention suite.

The repair remembers the last acknowledged root chunk's total elapsed time
within the current invocation. At each of the three admission boundaries,
the next root chunk needs more remaining time than the larger of that observed
duration and the existing 750 ms baseline. The first chunk and other phases
retain their existing floor. The five-second deadline, 50-root chunks,
stored-expiry/live-row guards and accounting are unchanged. A pre-work yield
preserves committed counts, unknown backlog and continuation without advancing
the success watermark. A genuinely slower admitted chunk can still fail and
must retain its failure and partial commits.

Local checks passed 94 focused tests, 38 PostgreSQL tests and full Admin
typechecking over 1,678 source roots, 757 test roots and four shards, plus lint,
format and normal hooks. A strengthened native fixture made the old code fail
on its second root deletion after committing 50 roots; the corrected code
yielded before that deletion, preserved the success watermark and live root,
and removed the remaining 50 expired roots in a fresh invocation. The fixture
models post-commit acknowledgement and conditional second-chunk latency. Its
local SQLSTATE is not evidence of the production SQLSTATE.

The investigation did not establish a missing-index or defective-cascade
cause. Read-only dependency discovery took about 9 ms, while a lookup-only FK
analogue measured cold indexed heap reads without timing an actual deletion.
An alternating local comparison rejected bulk leaf predeletion because it was
slower than the existing cascade. This repair avoids work already known to
be underfunded; it does not establish production query or CPU efficiency.

All three main workflows passed: forge-ci `40451994499`, production image
`40451994429` and CodeQL `40451994524`. At 05:10–05:11 UTC both actual Admin
roles were verified on the merged revision and reviewed source hashes, with
compact mode, correct runner roles and healthy responses. Worker memory was
4.242 GB against its enforced 16 GB limit, with zero OOM or limit events;
PGDATA had 7,896,555,520 bytes available. No lock waiter or long transaction
was observed. The separate Web rollout was active on `ac88a7c3` with two
healthy replicas before this verification.

The fixed cohort was still 36,997; the moving 26-family expired inventory was
81,944, with zero more than 24 hours overdue. Nine extra expiry inventory
frames were collected separately, including at least 1,001 expired session
links and one expired co-watch suppression. One pending profile erasure was
not stored-expired eligible. The success watermark remained October 26 at
21:45:44.183 UTC. No cleanup had run on the new release at that snapshot;
the known manual total remained 850 roots, including three failed partial
attempts, with the historical 301 separate.

The [release receipt](https://github.com/JesusFilm/forge/pull/2930#issuecomment-6434391172)
and [root receipt](https://github.com/JesusFilm/forge/pull/2541#issuecomment-6434391507)
record the dated verification. Parent verified all 63 release artifacts against manifest SHA256
`ff1f7a95644f978c955221a7cbde7b35062c0feb50d9690b83aae8b109000853`.
The new source-bound operator bundle preserves the frozen recorder and existing
checks, pins the reviewed merge and main workflow identities, and passed 47
offline checks plus independent review. Fresh individual and full-set hashes
for the 23 durable records and three wrappers matched the preserved historical
set. The independently reviewed new source/process proof found no resumable or
unresolved execution in that exact set; its SHA256 is
`dc60300255e8a099150992ec99e6c607b38b5d9814715764ce40705dbba76fc4`.
It does not mutate the old records or waive fresh live checks. Parent dispatched
one new bounded window, `r2930-w01`; old windows 03–07 remain revoked.
The daily scheduler remains enabled. Feat-554 retains October 23 as its one
accepted ordinary loaded failure-free cycle and requires one further cycle;
today's manual recovery earns no additional credit.

### October 27 first cleanup window after root admission repair

The new `r2930-w01` window was reconciled at 05:22 UTC after three distinct passes, each committing
100 expired request roots and returning a normal budget yield. Both ledgers
matched every counter, with no failed or unknown outcome. The window committed
**300 request roots and 3,000 expired Watch exposures**. The third pass also
deleted 100 expired profile projection runs and 100 expired contributions,
demonstrating some later-phase progress. These per-family counters are not
additive counts of unique rows, and they do not establish that the rewritten
decision-unlink selector did work or that the new guard caused each yield.
Successful phase timings and guard-specific reasons were unavailable in the
unchanged recorder; production CPU/query efficiency remains unproved.

All postchecks passed on the same actual release and process identities.
The 300 memory samples peaked at 6,700,867,584 bytes against the 16 GB limit,
with no OOM/limit events, throttling or CPU-counter reset. The fixed cohort
fell from 36,997 to 36,431; the moving 26-family count fell from 83,096 to
79,905, with zero measured more than 24 hours overdue. Additional expiry
categories remain separately recorded. The success watermark did not advance.
At this window's close, today's known manual total was **1,150 roots**, including the three earlier
failed partial attempts, whose failure statuses remain unchanged. Historical
301 roots are still separate. The first window is useful verified progress;
the backlog and ordinary-cycle acceptance remain open.

Independent review accepted the corrected all-pass assessment, preserving
the third pass's projection progress and the measurement limits above. Parent
verified the final 112-artifact manifest SHA256
`05a6092aef4eef63a0422a135cd97a35af1d7070b357a19da7419d1820a77657`;
the dated review receipt is
`cb73cd59c384c6f5a4d8e185203557a4c405cc1bd5ac3cd1ca0a7334a2a17941`.
Further bounded windows require fresh live checks and separate reconciliation;
this dated receipt does not report their outcome.

### October 27 later projection unlink failure and stopped continuation

The authorized continuation completed `r2930-w02` with three normal yields
and 250 committed roots plus 3,000 Watch exposures. In `r2930-w03`, the first
pass yielded after 50 roots; the second **failed after another 100 committed
roots**. The stopped window therefore retains 150 roots and 2,000 Watch
exposures. Both ledgers preserve the real failure and exact partial counters,
with no unknown outcome. The two-window series added 400 roots, taking the
known manual total to **1,550 at its 05:39 UTC reconciliation**, including four
failed partial attempts today. The historical 301 roots remain separate.
Windows 04–07 were revoked without attempts despite their later authorization
expiry. No retry or replay followed the failure.

The fresh diagnostic identifies `projection_run_unlink_page`, ordinal 29,
operation stage, with Prisma `P2028` and no SQLSTATE: 892 ms remained before
admission, 881 ms was admitted, the incomplete operation used 899 ms and the
phase total was 914 ms. The failed operation contains a SELECT and an UPDATE;
neither the exact failing statement nor server-versus-client timer attribution
is established. Fallback ledger terminalization succeeded in 57 ms. The prior
acknowledged root phase took 791 ms; this later phase is outside PR #2930's
root-only observed-cost guard. Blindly copying that prior root cost would not
have prohibited this admission either.

All original window postchecks passed on the expected release and processes,
with the same historical active set and no overlapping execution. Window 03's
300 memory samples peaked at 5,473,046,528 bytes of 16 GB, with no OOM or limit
event or CPU-counter reset. Its fixed cohort fell 35,722 to 35,203 and the
moving 26-family count fell 78,799 to 76,825, with zero measured more than
24 hours overdue. Additional expiry categories remain separate. The series
also records 300 projection runs and 300 contributions across its passes;
the later failed unlink is distinct from that committed work. Health and
partial deletion do not clear the failed attempt or the remaining backlog.

A bounded read-only SELECT analogue scanned 43,725 projection-run rows and
1,788 generation cache misses to return one eligible row, taking 564.191 ms
with 45,686 shared buffers. A same-cutoff candidate using existing expiry and
reference indexes examined 1,476 expired-parent probes and returned one row
in 12.046 ms with 4,287 shared buffers. These sequential SELECT-only plans
have different ordering and cache states; they are query-work evidence, not
the captured failed SQL or a causal production speedup/CPU comparison. Empty
parent probes remain a work consideration.

Parent verified the 230-artifact stopped-series manifest SHA256
`88679794f694e18cb52354fe4f7446b023ee944a8db6c3ac90b7f0a1f392a95c`.
Independent dated evidence review is sealed at
`439d8a1b9cde2bd35b1cca764a9068dc7e66e5e5eebb707291641a6ba8787b38`.
Astra owns a targeted selector repair with exact captured-reference and current
expiry rechecks, sparse/empty-parent/high-fan-out/live-reference PostgreSQL
regressions and comparable local work measurements. Preserve the 100-row bound,
five-second deadline, live guards and real failure accounting. Manual cleanup
remains stopped until reviewed normal release and fresh verification; the
ordinary daily scheduler and read-only observer remain enabled, and feat-554
still needs one further qualifying cycle after October 23.

### October 27 projection-run selector repair

[PR #2932](https://github.com/JesusFilm/forge/pull/2932) merged normally as
`e2a0658938e14eaec37fc8a521889b874e18fa21` at 06:12:24 UTC. The targeted helper
uses existing expiry-parent/reference indexes to select at most 100 run/reference
pairs, then rechecks the exact captured reference and current parent expiry before
unlinking. It preserves live parents and concurrently reassigned references.
Paging and continuation remain active when a full unlink page is the only work;
the root-only admission guard, five-second deadline and real failure accounting
are unchanged. Selection is not globally oldest-first across parents, and empty
parent probes remain linear rather than having a fixed work bound.

Independent review approved exact head `50738a49` and all 36 sealed local evidence
artifacts. The final validation passed 91 focused tests, 44 PostgreSQL tests,
full Admin typechecking, lint, formatting and normal hooks. The earlier test-mode
argument typecheck error was corrected and the initial failure retained. Native
coverage includes sparse/live references, 100,000 empty parents, high fan-out,
committed paging and concurrent reassignment. CI adds the new native suite to
the existing invocation; no validation is removed. All 29 PR contexts completed
with 21 successes and eight expected skips, and parent inspected the individual
jobs and validation steps before merging.

Across six alternating local SELECT trials per fixture, median elapsed time fell
from 135.099 to 4.855 ms for sparse matches and 139.758 to 6.821 ms for high fan-out.
Run heap visits fell from 50,007 to seven and 50,100 to 100 respectively. The
100,000-empty-parent fixture regressed from 153.544 to 303.414 ms. These are
SELECT-only local comparisons, not UPDATE or full-invocation measurements,
production CPU per committed row, or proof of the exact historical failed SQL.
Large empty-parent populations can still consume the existing deadline.

The final independent review receipt SHA256 is
`1b5866795aa59b733dc319b6f89ccb9bb27d7c52503ac8cad2ffd09eb8d74623`;
the local evidence manifest is
`00e71ad0467412fd8c21e7f6b098caca4888f9e2127079261748f0f9ca80a456`.
Parent verified the merged tree `df1030fbb89a92a698c699dffe30aec2df525d2a`:
the reviewed six-file runtime patch plus only the three parent documents from
preceding PR #2931. The exact reviewed runtime head was retained under the
repository's existing branch rules, with no check bypass.

All main workflows passed: forge-ci `40459720665`, production image
`40459720655` and CodeQL `40459719477`. Parent inspected individual jobs and
validation steps and sealed receipt SHA256
`62244ff4e5426e81a8dc97bab5e6fba2df5e29a4c185bc62778e172d9b312d77`.
The normal rollout reached HTTP deployment
`9c5bd004-252c-421f-9271-a35ba1148472` and worker deployment
`8944e9cc-ad3a-4dc3-8d64-bab9c49cb1b1`. At 06:33 UTC both actual roles matched
the exact merge and all five source hashes, with compact traces, runner
false/true and HTTP 200/body `ok`. Their current processes were verified and
recorded. Worker memory was 6,948,261,888 bytes of its enforced 16 GB limit,
with CPU quota 8 and zero OOM or limit events; HTTP capacity is separate.

The full snapshot found 87,166 stored-expired rows across 26 health families,
fixed cohort 35,203 and zero measured more than 24 hours overdue. Nine extra
expiry inventory frames remain outside that total. The success watermark was
unchanged at October 26 21:45:44.183 UTC. PGDATA available bytes were
7,862,411,264, WAL 117,440,512, and lock waiters/long transactions zero.
These are dated observations, not whole-inventory clearance or physical
reclamation. Parent verified the 69-artifact release manifest SHA256
`5feb7e60a9e9ec8dc83267e81b6d4683fef806fc2660fc663883bcae12c89b85`
and release receipt
`2f441264f7805a92acf96b185e974ebaec3deadb1511868a4cbb273fc105fb57`.

The operator's minimal release-binding amendment passed 49 offline checks and
independent review without changing the frozen recorder/parser, five-pass and
300-second window bounds, or restored memory policy. A new independent proof
bound to this source and process generation adjudicated the same 23 durable and
three wrapper historical records as terminal or nonresumable; all 26 underlying
executions were accounted for, with no resumable or unresolved execution. It
preserves those records and their historical 301 roots, and requires fresh full
set, identity, health and lock checks for each window. The proof SHA256 is
`781f0d45b19aa08089ec103b2d471814bf91bc2255e77d9f4be5a8e86090668b`.

At release verification, the dated manual baseline remained 1,550 request roots
including four failed partial attempts. Parent authorized one fresh bounded
window after verifying the release; previous windows remain revoked. The daily
scheduler and observer remain enabled, and manual work earns no ordinary-cycle
credit. Feat-554 remains in progress with one further qualifying cycle required
after October 23. Production CPU improvement and live-request reliability do
not follow from local benchmarks or health probes.

### October 27 decision-unlink recurrence after projection-run repair

The first new window, `r2932-w01`, stopped after two attempts. Pass one committed
100 request roots and yielded normally. Pass two committed another 100 roots,
then failed in `projection_decision_unlink_page`. Exactly two durable records
and two wrappers reconcile those outcomes; the second wrapper remains failed
with one error. The known manual total is now 1,750 roots, including five failed
partial attempts. Historical 301 roots remain separate, unknown outcome is false,
and no third pass, retry or second window followed. Both passes also committed
1,000 expired Watch exposures each; dependent counters are not added to roots as
distinct top-level deletions.

Pass one committed one projection-run link unlink and 100 decision-link unlinks,
demonstrating positive execution of both selectors. Each pass committed 100
expired projection runs, contributions and interests. In pass two the preceding
run-unlink phase completed in 59 ms, including 30 ms of operation time, with zero
links unlinked. The later decision-unlink operation failed at ordinal 31 with
Prisma `P2028`: 803 ms remaining, 796 ms admitted, 816 ms of incomplete operation
time and 827 ms total. Fallback ledger terminalization succeeded in 117 ms.
The diagnostic encloses both SELECT and guarded UPDATE; it does not establish
which statement failed or the underlying database/client cause. Positive earlier
link work does not establish causal production CPU improvement or erase the
later failure.

All original postchecks passed on the expected release and process identities,
with unchanged historical full sets and no overlap. The 300 direct memory samples
peaked at 6,038,208,512 bytes of 16 GB, with no OOM, limit event, throttling or
process reset. The fixed cohort fell from 35,203 to 34,340, and the current
26-family inventory from 87,910 to 85,529; measured more-than-24-hour expiry
remained zero and nine extra inventories were retained separately. The success
watermark did not advance. Shared-worker CPU measurements include other work and
cannot isolate retention CPU per row.

Parent verified the 91-artifact stopped-window manifest SHA256
`b250ee32a055de16667e864effe411f20669dad511ab8eb7288aa942872b9ea4`,
with closeout receipt
`0c771d6f65bbe1fd9937cf6a315b52bf1053cda89c469b7b4be357b463c37da1`.
Manual cleanup is stopped. Astra owns bounded read-only and local investigation
of the recurring late-phase failure, including transaction budgeting and actual
decision SELECT versus guarded UPDATE work. A further selector rewrite is not
presumed to solve it. Preserve stored expiry, captured references, the five-second
deadline and true failure accounting; do not substitute arbitrary admission or
memory floors, timeout widening or unreviewed production code. The daily scheduler
and observer remain enabled, and no manual cycle earns feat-554 credit.

### October 27 decision-operation diagnostics

PR [#2934](https://github.com/JesusFilm/forge/pull/2934) merged normally as
`b78fa7a6c181546fd9683be8b521e043b69c48cc` at 07:43:29 UTC after independent
review of head `c640d382`. All 31 PR contexts completed with 21 successes and
ten expected skips. The 13-file patch preserves the selector SQL, expiry and
captured-reference guards, page bounds, admission policy and five-second deadline.
It adds diagnostics; it does not establish a timeout repair.

The preceding bounded investigation did not reproduce the 816 ms production
operation. The current failed-cutoff SELECT returned 100 rows in 7.430 ms and
an exact guarded-UPDATE predicate expressed as SELECT took 46.031 ms. The real
helper and UPDATE took 18–28 ms in six local fixture trials. Production UPDATE
was explained without ANALYZE or writes. These observations do not identify
the failed SELECT, UPDATE, client delay or commit as the cause, and do not
justify another speculative selector rewrite or a wider timeout.

The new bounded envelope separates awaited decision selection, guarded update
and helper completion from subsequent counter or commit failure. It observes
heap, process CPU and event-loop timing in the actual executing cleanup process,
with explicit manual CLI, scheduled-job and generic worker-job contexts. Manual
cleanup uses a separate short-lived CLI process inside the worker container;
the long-lived Next process's heap flags and RSS do not describe an exited
cleanup invocation. Measurements cover the helper's process-wide interval,
not isolated database time or demonstrated garbage-collection causality.

Pre-decision failures retain the v1 envelope; decision observations use v2.
Strict parsing retains the 8,192-byte cap and rejects malformed or oversized
input. Await timings are labeled Prisma wall time and operation counts remain
tentative rather than committed deletions. A short synchronous stall can leave
the event-loop histogram unavailable; null does not mean no stall. Observer
failures cannot replace the original retention error. All 113 focused tests,
44 native tests, full Admin typechecking, lint, formatting and normal hooks
passed. Eight alternating local helper pairs measured a median added wall time
of 0.665 ms, ranging from −9.330 to +17.096 ms; the noisy sample neither proves
zero overhead nor guarantees that an operation fits the late-phase budget.

Parent verified the 46-artifact final evidence manifest SHA256
`fd07a33fa9c810d514b90b192599e8c0dab470ee3ef0dc0f003db7350fd3f822`
and independent final review
`9b1aa39eefce95d3b79166b2177aca09b1ea63df9f8a2460a660433f9d538ef2`.
The actual merged tree is `34ff6e9c7bf154463d7ae9ef4ba3e90cb7a9d745`;
the only additions beyond the reviewed runtime tree are the three parent
documents from preceding PR #2933.

All three main workflows passed: forge-ci `40468837966`, production image
`40468837977` and dynamic CodeQL `40468837438`. Parent verified all 25 jobs
and their steps, retaining the eight expected skipped jobs and six conditional
other-app test steps separately. The main verification receipt SHA256 is
`b7d1eddf131990a7d5bd092cb7404e42df4a437964df12cff30a8744c45c3c8c`.
The normal rollout reached HTTP deployment
`50a8b869-fff9-4884-979b-93ffdb72f9a4` and worker deployment
`39051d65-bdc7-4586-8846-2876091dc5f2`. At 08:00:27–08:00:31 UTC both actual
roles matched all 13 source/dependency pins, compact mode and runner false/true,
with HTTP 200/body `ok`. Direct worker cgroup memory was 3,710,930,944 bytes
of 16 GB, CPU quota 8, without OOM, limit events or throttling. These shared
container measurements and health probes do not prove cleanup efficiency.

The operator/parser update independently passed 62 offline guards, four actual
service-emitted fixture cases and 14 recorder/parser cases. It pins the local
parser's four-file dependency closure and 13 source/dependency files in both
deployed roles. The immutable offline review is
`6bd6bbd92d396566a295b0f0594deffc78ad1a41503788f77da8efef14e0ec1a`;
the exact merge/run identity amendment review is
`748c4ee37fe76d3afeff28b63c22ca84d541a04a14a39ce8298c86d4b2c2d702`.
A fresh independent historical-execution review binds the actual current source
and process generations to the same 23 durable records and three wrappers,
with zero unresolved or resumable records. The changed job source adds five
diagnostic context lines; it is not byte-identical to the prior release.
The corrected immutable review receipt is
`9d133c29f599676c754849bbc93724300f1ced99e0d6c80887e89a5f753a2d02`.
The 26 records do not establish 26 distinct process invocations: wrapper and
durable records can describe the same invocation. This clarification also applies
to earlier historical-review descriptions in this report. Fresh full-set and
process checks remain required; the historical proof grants no cleanup authority.
Full release readiness passed at 08:10 UTC, including a fresh both-role source,
process and health observation. The worker then used 4,654,411,776 bytes of
16 GB without OOM, limit events or throttling; the removed no-rising-memory
rule is not reinstated. The snapshot found 104,646 stored-expired rows across
26 health families, fixed cohort 34,340 and zero measured more than 24 hours
overdue. Nine extra inventory frames remain separate. The success watermark
was unchanged at October 26 21:45:44.183 UTC; PGDATA available bytes were
7,722,225,664, WAL 117,440,512 and lock waiters/long transactions zero.

Parent verified all 82 final release artifacts against manifest SHA256
`6ee58dcb9bda33492909bce40a8b7d00a2f2c49fdd174c5a9272c404063029aa`
and receipt
`6057449ef0220605566d1fbf79a5807082a545049740fa5ae58a4dff31bb8405`.
All 42 final operator artifacts match manifest
`57e196de3da9e08f1b1a8b624af87fc91cadf9e6cc31fc4fa148fc9559ef688c`;
all 22 operator code files remain byte-identical to the approved identity bundle.
The pre-correction proof and seals remain preserved as superseded evidence.
Parent then issued one fresh ordinary diagnostic cleanup window, bounded to
five passes and 300 seconds with fresh per-pass checks and stop-on-failure
accounting. At dispatch the manual baseline remains 1,750 roots, with five failed
partial attempts, historical 301 separate and zero manual ordinary-cycle credit.

### October 27 diagnostic window stopped before cleanup

Window `r2934-w01` stopped at 08:12:51 UTC when its initial read-only
fixed-cohort helper failed after the 26-family backlog query succeeded. No cleanup
invocation or pass directory was created, and the window ledgers contain zero
durable and zero wrapper records. The manual baseline remains 1,750 roots and
five failed partial attempts; this preflight failure is not a failed cleanup
attempt or a new partial commit. No replay or second window followed.

Original postchecks passed, including the identical fixed-cohort SQL, which
still counted 34,340 expired rows. That query also matched the successful release
snapshot. The failed helper interval was at most 4.245 seconds, below its existing
ten-second statement limit; this does not exclude a lock, transport, parser or
other failure. The approved wrapper discarded the failed helper's stdout,
stderr and exit code, and the nested read-only probe suppressed remote stderr.
The exact original error is unavailable. A bounded existing PostgreSQL log read
returned no matching error, which does not establish the absence of a database
failure. No retention runtime defect or transport cause is established.

All 300 original memory samples passed, peaking at 4,375,871,488 bytes of
16 GB without OOM or limit events. Current 26-family expiry changed from 105,815
to 105,820 during the window; measured more-than-24-hour expiry remained zero.
The fixed-cohort prelaunch value is unavailable, not zero; postcheck value is
34,340. The local reconciliation explicitly retains that missing value and
does not infer deletion progress from unrelated inventory changes.
Parent verified the 92-artifact stopped-window manifest SHA256
`4d27462b3c776f737b3b91f46d50a348fa90563275c050d656e7e1ca76654d12`
and closeout receipt
`8155f7bc06a034aa89fffebde51d6ac053bb8191c3c42bbd8ddd62e0d6ff25aa`.

Astra owns a narrow local operator amendment to preserve safe bounded failure
classification before another independently reviewed, parent-coordinated window.
It must retain nonzero failures, original postchecks, expiry and identity checks,
existing bounds and no uncertain replay. The amendment does not change production
cleanup code or query timeouts. The daily scheduler and observer remain enabled;
feat-554 retains one further qualifying ordinary-cycle requirement.

### October 27 successful diagnostic passes and collection stop

The independently reviewed local helper-reporting amendment preserved cleanup
queries, timeouts, bounds and admission checks. Its 25 controlled telemetry tests
and 62 existing guards passed. Failure receipts contain fixed classifications,
captured-output byte counts and hashes, without raw output. Parent then issued
the distinct window `r2934-w02` with a fresh release and readiness binding.

Two cleanup invocations succeeded and reconciled every counter against both
ledgers, committing 200 additional request roots. The known manual total is
1,950 roots, with five earlier failed partial attempts unchanged and historical
301 separate. Additional durable categories include 9,321 expired profile-session
links, 2,000 Watch exposures, 200 decision-link unlinks, and 200 each of expired
projection runs, contributions, interests and generations. These dependent and
unlink categories are not summed as unique top-level deletions.

The fixed cohort fell from 34,340 to 33,201; current expiry across 26 health
families fell from 109,380 to 106,832, with measured more-than-24-hour expiry zero
and nine extra inventory frames separate. Original postchecks and all 300 memory
samples passed, peaking at 3,654,791,168 bytes of 16 GB without OOM, limit events
or process changes. The shared cgroup CPU and wrapper-duration measurements are
not controlled evidence of retention efficiency.
The original 08:34:47 UTC backlog postcheck records a success expiry cutoff
of October 27 08:34:16.965 UTC, advanced by successful work. It does not establish
whole-inventory clearance or ordinary-cycle credit for these manual invocations.

Before a third cleanup invocation, the release-probe collector failed on a
nested Railway command returning nonzero. The helper receipt contains exit 1,
zero stdout bytes and 51 stderr bytes; the stderr hash exactly matches the
source's fixed nonzero-command message. No original pass-three role frame or
verifier result survived. This establishes the collection boundary, not which
status/HTTP/worker command failed or whether the cause was network or remote
process behavior. A later healthy postcheck does not replace the missing
original observation. There was no third cleanup, replay or unknown durable
outcome. Both successful invocations emitted no v2 failure frame, so the
historical timeout stage remains unproved.

Parent verified all 201 final artifacts against manifest SHA256
`4f4a0725c2a7bd6a34f2498b0962321e0a486d4ba4a53999ada5ce4cbe2762d4`
and closeout receipt
`f716b68bae47efb02b3d92df51987ee7049410edcebcc8c0c3e144d25d1bafa0`.
Independent stopped-window review accepted the original checks and accounting:
`2ed371974231c555ad4073484432910e5bc7baceb1177193765a6ad0f5370d62`.
Authority from this window has ended. Astra owns a local collector-stage
reporting amendment and at most one read-only collection retry within the
existing deadline. Original failures must remain recorded. Cleanup, mutations,
malformed completed output, negative health/source/identity observations and
verifier rejections must never be retried. Independent review and a new parent
dispatch precede production use. Daily cleanup and observation remain enabled;
manual work earns no feat-554 cycle credit and backlog remains.

The collector amendment then passed 38 collection checks, 25 existing telemetry
checks and 62 guards, plus independent review
`53dcf90ca9225d71b4bca08ef40b376f3924c0e94c73941bbcafdbac7749a53b`.
It permits one extra read-only command across an entire role collection only
after retaining the original failure and finding zero captured stdout with
remaining explicit admission time. The 25-second command and 65-second caller
caps remain, with a 60-second internal deadline. Completed negative/malformed
observations, verifier rejection, SQL and cleanup cannot be retried. The driver
only forwards its existing deadline and readiness file; original remote code,
queries, cleanup and postchecks remain unchanged.

The distinct `r2934-w03` completed three successful 100-root passes, with every
counter and both ledgers matching. It ended normally when insufficient admission
reserve remained for a fourth pass; `BOUNDED_WINDOW_COMPLETE` does not mean the
backlog is clear. The known manual total is 2,250 roots, against the separately
verified 1,950-root starting baseline. Five earlier failed partial attempts and
historical 301 remain separate. Seven complete role collections used 21 commands,
all first attempts, with no collection failure or recovery. The successful passes
emitted no v2 failure frames, leaving historical timeout attribution unproved.

Original postchecks and all 300 memory samples passed, peaking at 3,736,748,032
bytes of 16 GB without OOM, limit events or process changes. Fixed expiry fell
33,201 to 31,770 and current 26-family expiry 111,366 to 107,285; measured overdue
expiry stayed zero. The success cutoff advanced to October 27 08:58:53.688 UTC.
These manual successes do not earn ordinary-cycle credit. Parent verified the
241-artifact manifest
`4798107a3fd6835aeee98412c53f6eae85c7a7cb0a1bb978c7881ae7fc8bb9ac`
and closeout
`9aaab78636a55f9797d2e93bd26b4b5b55872ecd5d5f61bd483243b119fe10b0`.
The unchanged reconciler's older 1,750-root historical reference is not used as
the current baseline; fresh cumulative ledgers and the dispatch establish 2,250.
Independent review accepted the complete window evidence in receipt
`13e8645eaec275bc967fa73ca4d3256d36e235c1cec2f59db928a781d5914810`.
Parent then issued a finite continuation of at most ten distinct windows,
`r2934-w04` through `r2934-w13`, following independent plan review
`8fd37b07c5f30bb5b3360f84a92712cdac9d44b8f076adb3c0467dff32c93908`.
Each retains the existing five-pass/300-second maximum and all fresh checks.
Prior original postchecks, memory evidence and committed counters must reconcile
before the next window. Any real failure, unknown outcome or lack of progress
stops the whole sequence. No new readiness may start after 10:05 UTC, and all
dispatches expire at 10:15 UTC, before ordinary daily cleanup at 10:30 UTC.
This is a dated parent dispatch, not continuing authority supplied by this report.

### October 27 finite cleanup continuation

The first three windows of that continuation completed successfully on deployed
revision `b78fa7a6c181546fd9683be8b521e043b69c48cc`. Every original postcheck,
300-sample memory observation and committed counter reconciled. Fresh cumulative
ledgers establish the 2,250-root starting baseline and these additional roots:

| Window      | Successful passes | Added request roots | Cumulative manual roots | Fixed expired cohort after | Current 26-family expiry after |
| ----------- | ----------------- | ------------------- | ----------------------- | -------------------------- | ------------------------------ |
| `r2934-w04` | 3                 | 300                 | 2,550                   | 30,389                     | 105,994                        |
| `r2934-w05` | 2                 | 200                 | 2,750                   | 29,467                     | 104,565                        |
| `r2934-w06` | 3                 | 300                 | 3,050                   | 28,086                     | 101,863                        |

The fixed cohort fell from 31,770 to 28,086 over these windows. Current expiry is
measured at each window's postcheck and can grow between windows as more rows
expire. Nine additional inventory frames remain outside the 26-family total.
Measured more-than-24-hour expiry was zero; this is not whole-inventory clearance.
The success cutoff advanced to October 27 09:27:57.896 UTC. The highest observed
memory use across these windows was 6,037,544,960 bytes of 16 GB, with no OOM,
hard-limit event or process change. There were 19 complete role collections and
57 commands, all first attempts, with no collection recovery. Shared worker CPU
and wrapper timing remain proxy measurements, not controlled efficiency proof.

`r2934-w07` then stopped on a read-only helper failure before any cleanup
invocation. That stopped the entire sequence and revoked all unstarted windows
`r2934-w08` through `r2934-w13`; no replay is authorized. All seven original SQL
postchecks failed. The original health collection also failed at its status
command, including its one permitted read-only retry. Original post-ledger,
expiry, capacity and actual-role observations are unavailable. All 300 original
memory samples passed, peaking at 3,273,777,152 bytes, but they do not replace
those missing checks. Zero cleanup invocations establish zero window mutation;
the unavailable post-ledgers are not represented as observed empty ledgers.
Later diagnostic controls cannot replace the failed original observations.

Parent verified the 149-artifact stopped-window manifest
`d2fd45712b99e8d95ad4a52f6896a8aee74d2de0e983a5ea26744597395cc25b`
and final series receipt
`e45abce05b3ddcf27a37e2d478931227a9543563d0034bdcfd74deddee252245`.
Independent review of the three completed windows is recorded in
`5a4a474482aaf595d227e79fbc19c9a918b75d8d460df3e3ccaf5b946b5df63c`.
The review also preserves a w05 preflight observation of one retention advisory
lock: the holder is unknown, and the mandatory gates before both cleanup passes
and the postcheck observed zero. No cleanup overlap was evidenced. The w04
receipt's no-replay wording applies to that individual window; later windows
used their distinct pre-issued authorizations, now all terminated.

The acknowledged manual total remains
3,050 roots, five prior failed partial cleanup attempts and historical 301
separate. Manual work earns no daily-cycle credit. The ordinary daily scheduler
remains enabled at 10:30 UTC, and one further loaded failure-free ordinary cycle
is still required for feat-554.

A separately authorized account API control at 09:41:16 UTC returned HTTP 429
with `Retry-After: 850`. This directly establishes Railway management-API rate
limiting at the control time. Parent verified all six diagnosis artifacts against
manifest `ae1c2e5f072f06231406f42f1bf2f6f1855dc78f98bbe8f9b9f2de66f875ed2a`
and receipt `5ccd73612de127e635eca32a9436c585eb3e2ef6952015a8ca40599585d0f119`.
The planned project-status control was skipped after that response; there was
no retry, cleanup or other mutation. The conservative API not-before time is
09:55:27 UTC, following the provider's
[documented rate-limit behavior](https://docs.railway.com/integrations/api).
Future management-API access needs a coordinated request budget. This later
control does not identify the exact cause of the original 09:32 command failures,
replace missing postchecks or renew manual cleanup authority. The daily worker
scheduler code is unchanged; its execution does not use this local Railway
management-API collector.

## Dependencies, indexes and older PRs

The 25 tickets cancelled in this closeout have no active dependency edges. References to their IDs are
removed from both `depends_on` and `blocks`; historical prose remains as audit
context. The separate platform feat-064 analytics ticket keeps its original
status and scope, with its personalization prerequisite rewired from cancelled
feat-063 to delivered feat-447 and the reverse edge recorded. This does not
reintroduce the retired studies. Existing unrelated ID collisions are not
renumbered; scoped dependencies are audited by path and intended lane.

The canonical architecture plan, root agent guidance and policy point to this
record so future work does not revive old acceptance gates. The roadmap viewer
preserves cancellation as distinct from completion; cancellation alone does not
satisfy a live dependency. The generated README was refreshed from current tickets using the updated
parser with `TZ=UTC`, preserving the excluded AI Chat/RAG lanes. All 39 tracked
paths appear with the correct status, including in-progress feat-554 and feat-609. Unrelated historical redirects omitted by
the existing parser are unchanged.

Stale PRs [2150](https://github.com/JesusFilm/forge/pull/2150) and
[2226](https://github.com/JesusFilm/forge/pull/2226) were audited independently and
closed, with branches preserved. #2150's playback direction is superseded by
merged #2155/#2165 and completed feat-369; its old parallel migration is not
needed. #2226's standalone coverage diagnostic was never shipped; request-owned
#2527 diagnostics are the retained delivery path, and the optional standalone
product was not selected. This does not claim #2226 was implemented or prove
catalogue exhaustion. Other unrelated open PRs remain outside this scope.

## Integration and final audit

Merged and green: [2538](https://github.com/JesusFilm/forge/pull/2538) Watch,
[2539](https://github.com/JesusFilm/forge/pull/2539) measurement,
[2540](https://github.com/JesusFilm/forge/pull/2540) storage,
[2544](https://github.com/JesusFilm/forge/pull/2544) fixtures/CI,
[2543](https://github.com/JesusFilm/forge/pull/2543) client evidence, and
[2545](https://github.com/JesusFilm/forge/pull/2545) roadmap status, and
[2546](https://github.com/JesusFilm/forge/pull/2546) co-watch. Root #2541 finalizes
this record and the dependency/index reconciliation. All seven preceding PRs
passed required checks on independently reviewed heads. Root required checks and
merged-main confirmation are recorded on #2541. The final normal Roadmap
deployment receipt on #2541 identifies the actual Railway revision, deployment
ID/time and bounded public endpoint/browser observations; consult it before
claiming the new status model is live.
The initial October 2 closeout changed test/CI and the roadmap status viewer,
without recommendation runtime or production SQL changes. Subsequent retention
repairs #2550, #2551, #2553, #2556, #2580 and #2594 change runtime or database behavior; their separate release and recovery
evidence is required as described above.

The PostgreSQL CI job passed all 56 relevant native tests: one historical
playback-upgrade, three viewing-mode, 13 refresh, six measurement-reuse,
32 trial-authority and one source-query test. The isolated deterministic
fallback drill is additional local evidence, not a new CI step. Existing
wrong-database guards remain fail-closed.

The roadmap status fixture passed in Pacific/Auckland, UTC and
America/Los_Angeles. Lint, typecheck and production build passed. Three fresh
browser runs with identical ticket data showed unchanged script/resource counts;
transfers increased 383 bytes on `/contributions` and 377 bytes on
`/lane/content-discovery`. Median loads were 479 → 445 ms and 337 → 343 ms.
These small local samples support no material loading regression; they are not
production latency estimates. Raw samples and the measurement script are retained
under `/home/nisal/Documents/Codex/2026-10-02/recommendation-roadmap-cancelled-status/work/`
and summarized in #2545. Normal deployed verification is recorded separately.

The direct path/frontmatter audit of merged main `20f55715c` found **12 complete,
25 cancelled and two in-progress** across 39 tracked paths: platform feat-554 and
content-discovery feat-609 remain open. The original 38-path scope still has only
feat-554 open; no retention acceptance has moved to the HNSW investigation.
Final closure must repeat this audit on merged main, with the merge SHA
and result retained on #2541. The dependency audit
checked all 25 retired IDs and 43 affected ticket paths, finding no residual
retired edge or missing reverse edge; ambiguous legacy IDs resolve by their
intended same-lane paths for this audit. A title/tag audit found no additional open recommendation scope:
media-generation feat-060 is a separate on-demand video-generation product, and
platform feat-064 retains separate analytics scope.
