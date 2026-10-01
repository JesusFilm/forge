# Recommendation roadmap closeout

Owner authorization: October 2, 2026 (Pacific/Auckland). **Integration in progress:**
this record has one necessary future retention gate, and the PRs below must be
merged before the final inventory is claimed. Baseline: main `b01e0ddca`, including
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

Only the coordinating chat delegates and merges. All execution owners use
GPT-6 Sol and isolated worktrees without further delegation. Existing co-watch
and storage owners retain shared-operation responsibility. Production publication
uses reviewed PR-to-main releases. The original dirty checkout is preserved.

| Area        | Owner chat                             |
| ----------- | -------------------------------------- |
| root        | `01a0f9a4-577b-7332-9fea-7db1660861fa` |
| cowatch     | `01a0f3c7-3cf2-7540-a991-748579724e60` |
| storage     | `01a0e490-2d64-7013-8a95-a4f4015e26e0` |
| fixtures    | `01a0f9a9-8860-7982-8c12-d9f495f42c93` |
| watch       | `01a0f9a9-8e25-7fd1-8ec1-7a279f5cf85f` |
| clients     | `01a0f9a9-93e1-7911-8334-9cd812ba9b47` |
| measurement | `01a0f9a9-99cd-7a90-823c-c709b9687f5c` |
| roadmap     | `01a0f9aa-e1ef-7831-a7d0-973ebc15fcf8` |

Independent documentation review belongs to chat
`01a0f9b3-2420-7013-816d-13a36bd03adc`; fixture/CI and roadmap code review to
`01a0f9b9-ffc4-76e2-b2af-bc569702be04`. Reviews report exact published heads,
not merely branch names. No actionable findings were reported for the reviewed
Watch, measurement, storage, client, fixture/CI or roadmap changes. Root final
integration and co-watch review remain pending here.

## Path-specific inventory

The original scope contains **37 paths**, initially 35 open and two complete.
The directly required cancelled-status viewer fix adds platform feat-599, for
**38 scoped paths**. IDs alone are unsafe: content-discovery feat-517 is in scope;
unrelated platform feat-517 and RAG feat-575 are not. Target dispositions below
are not a claim that pending PRs have already merged.

| Ticket path                                                                                                                                                                              | Owner       | Disposition and remaining work                                                                                                                                                                     | PR and evidence                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/roadmap/content-discovery/feat-055-smart-video-playlists.md](../roadmap/content-discovery/feat-055-smart-video-playlists.md)                                                       | root        | Cancelled: Prompt/vector-generated playlists are a separate product expansion, outside the selected bounded recommendation delivery scope.                                                         | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-063-personalize-discovery-experiences.md](../roadmap/content-discovery/feat-063-personalize-discovery-experiences.md)                               | root        | Cancelled: This broad umbrella is superseded by the implemented, individually audited anonymous-profile, candidate and client-delivery work (feat-378, feat-386, feat-447, feat-487 and feat-517). | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-371-recommendation-subtitle-audio-signals.md](../roadmap/content-discovery/feat-371-recommendation-subtitle-audio-signals.md)                       | measurement | Cancelled: extra subtitle/audio outcome signals are optional; exact delivery language/audio contracts remain required.                                                                             | [2539](https://github.com/JesusFilm/forge/pull/2539). [individual scope decisions](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)                            |
| [docs/roadmap/content-discovery/feat-372-recommendation-mission-value-actions.md](../roadmap/content-discovery/feat-372-recommendation-mission-value-actions.md)                         | measurement | Cancelled: the mission-action measurement programme is retired; working action evidence remains.                                                                                                   | [2539](https://github.com/JesusFilm/forge/pull/2539). [individual scope decisions](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)                            |
| [docs/roadmap/content-discovery/feat-373-watch-surface-impressions-ctr.md](../roadmap/content-discovery/feat-373-watch-surface-impressions-ctr.md)                                       | watch       | Complete: bounded Watch origin-issued V2 manifests and Admin measurement verified; no global CTR or exhaustive surface claim.                                                                      | [2538](https://github.com/JesusFilm/forge/pull/2538). Ticket contains dated scope and 353 focused-test results.                                                                       |
| [docs/roadmap/content-discovery/feat-374-recommendation-acquisition-share-attribution.md](../roadmap/content-discovery/feat-374-recommendation-acquisition-share-attribution.md)         | measurement | Cancelled: additional acquisition/share attribution is outside the selected recommendation scope.                                                                                                  | [2539](https://github.com/JesusFilm/forge/pull/2539). [individual scope decisions](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)                            |
| [docs/roadmap/content-discovery/feat-375-semantic-search-downstream-outcomes.md](../roadmap/content-discovery/feat-375-semantic-search-downstream-outcomes.md)                           | measurement | Cancelled: search-to-qualified-outcome measurement expansion is retired; current search behavior remains.                                                                                          | [2539](https://github.com/JesusFilm/forge/pull/2539). [individual scope decisions](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)                            |
| [docs/roadmap/content-discovery/feat-377-authenticated-machine-recommendation-parity.md](../roadmap/content-discovery/feat-377-authenticated-machine-recommendation-parity.md)           | root        | Cancelled: A separate recommendation machine-adapter product with artifact-use receipts, purpose quotas and machine-utility dashboards is not part of the chosen viewer recommendation scope.      | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-379-recommendation-intent-profile-controls.md](../roadmap/content-discovery/feat-379-recommendation-intent-profile-controls.md)                     | root        | Cancelled: The proposed purpose prompts and five title-level feedback actions are additional product scope and are retired.                                                                        | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-380-reported-value-surveys.md](../roadmap/content-discovery/feat-380-reported-value-surveys.md)                                                     | measurement | Cancelled: reported-value survey product and satisfaction-study programme are retired.                                                                                                             | [2539](https://github.com/JesusFilm/forge/pull/2539). [individual scope decisions](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)                            |
| [docs/roadmap/content-discovery/feat-381-semantic-control-readiness.md](../roadmap/content-discovery/feat-381-semantic-control-readiness.md)                                             | measurement | Cancelled: semantic-only experiment-readiness gate is obsolete; existing readiness code remains.                                                                                                   | [2539](https://github.com/JesusFilm/forge/pull/2539). [individual scope decisions](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)                            |
| [docs/roadmap/content-discovery/feat-387-profile-conditioned-directional-cowatch.md](../roadmap/content-discovery/feat-387-profile-conditioned-directional-cowatch.md)                   | cowatch     | Complete: directional profile-conditioned co-watch and bounded owner authority are implemented and verified.                                                                                       | Scoped co-watch closeout PR and final evidence pending.                                                                                                                               |
| [docs/roadmap/content-discovery/feat-388-editorial-recommendation-candidates.md](../roadmap/content-discovery/feat-388-editorial-recommendation-candidates.md)                           | root        | Cancelled: The shadow editorial-candidate adapter and counterfactual experiment programme are retired.                                                                                             | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-389-search-session-intent-candidates.md](../roadmap/content-discovery/feat-389-search-session-intent-candidates.md)                                 | root        | Cancelled: A new search-query/session-intent candidate generator is optional expansion of the current semantic/profile/co-watch system and is retired.                                             | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-390-continuation-recommendation-candidates.md](../roadmap/content-discovery/feat-390-continuation-recommendation-candidates.md)                     | root        | Cancelled: The proposed recommendation-generator integration for resume, course progression and authored next steps is retired as additional product scope.                                        | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-391-qualified-popular-trending-candidates.md](../roadmap/content-discovery/feat-391-qualified-popular-trending-candidates.md)                       | root        | Cancelled: Quality-weighted popular/rising/trending projections and their shadow programme are retired.                                                                                            | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-392-high-satisfaction-cohort-candidates.md](../roadmap/content-discovery/feat-392-high-satisfaction-cohort-candidates.md)                           | root        | Cancelled: The satisfaction-cohort generator depends on the retired survey/popularity programme and is outside the chosen scope.                                                                   | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-393-recommendation-slate-composer.md](../roadmap/content-discovery/feat-393-recommendation-slate-composer.md)                                       | cowatch     | Cancelled: broader slate expansion (editorial pins, series/speaker constraints and calibration/shadow programme) is retired; deployed limited MMR remains.                                         | Scoped co-watch closeout PR and final evidence pending.                                                                                                                               |
| [docs/roadmap/content-discovery/feat-394-bounded-recommendation-exploration.md](../roadmap/content-discovery/feat-394-bounded-recommendation-exploration.md)                             | root        | Cancelled: Randomized exploration and propensity-based learning are retired from this roadmap.                                                                                                     | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-395-learned-multi-outcome-reranker.md](../roadmap/content-discovery/feat-395-learned-multi-outcome-reranker.md)                                     | root        | Cancelled: The learned challenger, training snapshots and model registry are retired.                                                                                                              | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-396-recommendation-privacy-capacity-graduation.md](../roadmap/content-discovery/feat-396-recommendation-privacy-capacity-graduation.md)             | root        | Cancelled: The umbrella graduation exercise for the retired exploration, learned models and personalized-page programme is cancelled.                                                              | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-447-live-anonymous-profile-personalization-pilot.md](../roadmap/content-discovery/feat-447-live-anonymous-profile-personalization-pilot.md)         | clients     | Complete: bounded live anonymous-profile rollout, controls and isolated real-dependency fallback proof; benefit and natural failure receipt unclaimed.                                             | [2543](https://github.com/JesusFilm/forge/pull/2543). Ticket contains dated production/proxy observations and isolated fallback proof.                                                |
| [docs/roadmap/content-discovery/feat-448-learned-sequential-profile-item-representations.md](../roadmap/content-discovery/feat-448-learned-sequential-profile-item-representations.md)   | root        | Cancelled: Learned sequential encoders, training infrastructure and profile/item ANN retrieval are retired.                                                                                        | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-449-personalized-watch-row-page-orchestration.md](../roadmap/content-discovery/feat-449-personalized-watch-row-page-orchestration.md)               | root        | Cancelled: A new personalized row-selection/page-ordering layer is retired.                                                                                                                        | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-497-expand-production-recommendation-pool-coverage.md](../roadmap/content-discovery/feat-497-expand-production-recommendation-pool-coverage.md)     | root        | Cancelled: Broader curated-pool expansion is optional and is not selected for this closeout.                                                                                                       | [2541](https://github.com/JesusFilm/forge/pull/2541). Dated disposition and current source anchors in the ticket.                                                                     |
| [docs/roadmap/content-discovery/feat-505-personalization-controlled-usefulness-evaluation.md](../roadmap/content-discovery/feat-505-personalization-controlled-usefulness-evaluation.md) | measurement | Cancelled: controlled usefulness study is not required for direct co-watch/MMR; causal benefit remains unmeasured.                                                                                 | [2539](https://github.com/JesusFilm/forge/pull/2539). [individual scope decisions](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)                            |
| [docs/roadmap/content-discovery/feat-517-mobile-recommended-for-you-shelf.md](../roadmap/content-discovery/feat-517-mobile-recommended-for-you-shelf.md)                                 | clients     | Complete: implemented mobile shelf and evidence nonce behavior; production binary/audience reach and real mobile Admin writes remain unobserved.                                                   | [2543](https://github.com/JesusFilm/forge/pull/2543). Ticket contains dated production/proxy observations and isolated fallback proof.                                                |
| [docs/roadmap/content-discovery/feat-564-cached-watch-public-navigation-authority.md](../roadmap/content-discovery/feat-564-cached-watch-public-navigation-authority.md)                 | watch       | Cancelled: optional cached public-navigation alias coverage is not selected; ambiguous manifests/denominators remain withheld.                                                                     | [2538](https://github.com/JesusFilm/forge/pull/2538). Ticket contains dated scope and 353 focused-test results.                                                                       |
| [docs/roadmap/content-discovery/feat-565-implemented-shadow-recommendation-promotion.md](../roadmap/content-discovery/feat-565-implemented-shadow-recommendation-promotion.md)           | cowatch     | Complete: direct co-watch/MMR authority and supported fallback verified independently of any study.                                                                                                | Scoped co-watch closeout PR and final evidence pending.                                                                                                                               |
| [docs/roadmap/content-discovery/feat-566-recommendation-evidence-gap-remediation.md](../roadmap/content-discovery/feat-566-recommendation-evidence-gap-remediation.md)                   | measurement | Cancelled: nine historical evidence gaps reviewed individually; extra forensic/correlation campaign retired, causes unrecovered and fresh errors still actionable.                                 | [2539](https://github.com/JesusFilm/forge/pull/2539). [individual scope decisions](../operations/recommendation-evidence-closeout-decisions-2026-09-29.md)                            |
| [docs/roadmap/content-discovery/feat-573-sustainable-cowatch-live-refresh.md](../roadmap/content-discovery/feat-573-sustainable-cowatch-live-refresh.md)                                 | cowatch     | Complete: bounded refresh/revocation/throttle lifecycle verified; next natural post-revocation replacement remains unobserved.                                                                     | Scoped co-watch closeout PR and final evidence pending.                                                                                                                               |
| [docs/roadmap/content-discovery/feat-590-refresh-recommendation-integration-fixtures.md](../roadmap/content-discovery/feat-590-refresh-recommendation-integration-fixtures.md)           | fixtures    | Complete: fixed historical timestamps and current-schema fixture isolation, retaining production constraints and migrations.                                                                       | [2544](https://github.com/JesusFilm/forge/pull/2544). 4 fixture tests, 52 native co-watch tests and isolated PostgreSQL/Redis fallback proof.                                         |
| [docs/roadmap/platform/feat-554-recommendation-storage-rollout-verification.md](../roadmap/platform/feat-554-recommendation-storage-rollout-verification.md)                             | storage     | Open, in-progress: two real failure-free loaded daily retention cycles still required; zero qualifying cycles in the latest audit.                                                                 | [2540](https://github.com/JesusFilm/forge/pull/2540). [storage audit](2026-10-02-recommendation-storage-efficiency-closeout.md)                                                       |
| [docs/roadmap/platform/feat-555-recommendation-legacy-trace-reclamation.md](../roadmap/platform/feat-555-recommendation-legacy-trace-reclamation.md)                                     | storage     | Complete before this closeout: restrictive legacy-stage retirement and measured physical reclamation retained.                                                                                     | [2537](https://github.com/JesusFilm/forge/pull/2537), [2540](https://github.com/JesusFilm/forge/pull/2540). [storage audit](2026-10-02-recommendation-storage-efficiency-closeout.md) |
| [docs/roadmap/platform/feat-574-recommendation-storage-efficiency.md](../roadmap/platform/feat-574-recommendation-storage-efficiency.md)                                                 | storage     | Complete: U1–U3 storage implementation, production representation checks and measured fixture savings verified.                                                                                    | [2540](https://github.com/JesusFilm/forge/pull/2540). [storage audit](2026-10-02-recommendation-storage-efficiency-closeout.md)                                                       |
| [docs/roadmap/platform/feat-575-early-legacy-recommendation-retirement.md](../roadmap/platform/feat-575-early-legacy-recommendation-retirement.md)                                       | storage     | Complete before this closeout: authorized early legacy-detail retirement and physical disposal verified.                                                                                           | [2537](https://github.com/JesusFilm/forge/pull/2537), [2540](https://github.com/JesusFilm/forge/pull/2540). [storage audit](2026-10-02-recommendation-storage-efficiency-closeout.md) |
| [docs/roadmap/platform/feat-591-cowatch-postgresql-regressions-ci.md](../roadmap/platform/feat-591-cowatch-postgresql-regressions-ci.md)                                                 | fixtures    | Complete after CI passes and merge: four existing native co-watch suites wired into PostgreSQL CI.                                                                                                 | [2544](https://github.com/JesusFilm/forge/pull/2544). 4 fixture tests, 52 native co-watch tests and isolated PostgreSQL/Redis fallback proof.                                         |
| [docs/roadmap/platform/feat-599-roadmap-cancelled-status.md](../roadmap/platform/feat-599-roadmap-cancelled-status.md)                                                                   | roadmap     | Complete after merge/release: genuine cancelled terminal status, separate counts, overdue exclusion and conservative dependency handling.                                                          | [2545](https://github.com/JesusFilm/forge/pull/2545). Fixture tests in three timezones, lint/typecheck/build and browser load comparison; deployed verification pending.              |

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
  six selected, three theme IDs available, `missingTheme=true`, other required
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
loaded daily cycles. The latest audit had zero qualifying cycles; October 1
included 78 successful and four failed wrappers, 7,846 committed roots and
27,216 served descendants. Two failures were timeout/closed and two remained
unclassified; no speculative production change was made. The 3,337 newly expired
roots in the snapshot were within the 24-hour acceptance threshold, which does
not establish sustained retention success.

Next normal opportunities are **October 2 and 3 at 10:30 UTC (23:30 NZDT)**.
Both must produce actual loaded, failure-free evidence with throughput, lock
skips, backlog, oldest expired age and headroom. Manual, recovered or empty runs
cannot manufacture this proof. No replacement ticket hides the unfinished work.

The existing `recommendation-storage-daily-check` heartbeat remains with the
storage owner, updated to send meaningful results to the coordinating chat and
prepare the scoped feat-554 evidence PR when proven. Parent owns review, merge
and the final inventory/index update; the monitor ends only after that merges.
The existing `co-watch-24-hour-production-check` retains its requested first
comparison and subsequent weekly reports, with current lifecycle and unknown
cause boundaries. No duplicate automation or production fault was introduced.

## Dependencies, indexes and older PRs

Cancelled tickets have no active dependency edges. References to their IDs are
removed from both `depends_on` and `blocks`; historical prose remains as audit
context. The separate platform feat-064 analytics ticket keeps its original
status and scope, with its personalization prerequisite rewired from cancelled
feat-063 to delivered feat-447 and the reverse edge recorded. This does not
reintroduce the retired studies. Existing unrelated ID collisions are not
renumbered; scoped dependencies are audited by path and intended lane.

The canonical architecture plan, root agent guidance and policy point to this
record so future work does not revive old acceptance gates. The roadmap viewer
preserves cancellation as distinct from completion; cancellation alone does not
satisfy a live dependency. The generated README will be refreshed after all
scoped ticket merges with the updated parser.

Stale PRs [2150](https://github.com/JesusFilm/forge/pull/2150) and
[2226](https://github.com/JesusFilm/forge/pull/2226) were audited independently and
closed, with branches preserved. #2150's playback direction is superseded by
merged #2155/#2165 and completed feat-369; its old parallel migration is not
needed. #2226's standalone coverage diagnostic was never shipped; request-owned
#2527 diagnostics are the retained delivery path, and the optional standalone
product was not selected. This does not claim #2226 was implemented or prove
catalogue exhaustion. Other unrelated open PRs remain outside this scope.

## Integration and final audit

Merged so far: [2538](https://github.com/JesusFilm/forge/pull/2538) Watch,
[2539](https://github.com/JesusFilm/forge/pull/2539) measurement,
[2540](https://github.com/JesusFilm/forge/pull/2540) storage. Pending: fixture/CI
2544, client 2543 (after 2544), roadmap 2545 with normal deployed verification,
co-watch closeout and root 2541. Required checks must pass on reviewed heads.
The closeout changes no recommendation production runtime or production SQL;
test/CI and the roadmap status viewer are the only new executable changes.

After those merges, expected inventory is **12 complete, 25 cancelled and one
open (feat-554)** across 38 paths, including the new viewer ticket. This expected
count must be replaced by a direct merged-main audit before final reporting.
