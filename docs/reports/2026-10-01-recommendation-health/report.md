# Production recommendation health — October 1, 2026

> Historical assessment of the window and deployment below. Subsequent repairs
> landed in [PR #2527](https://github.com/JesusFilm/forge/pull/2527) and
> [PR #2529](https://github.com/JesusFilm/forge/pull/2529). Apply the owner's
> [October 2 coverage disposition](../2026-10-02-recommendation-coverage-acceptance.md)
> when assessing readiness: accepted empty/partial rows and sparse co-watch
> fallback are not delivery bugs or blockers. Check fresh authority/error
> evidence before treating the historical findings below as current incidents.

Core semantic/profile recommendations and source-neutral learning are functioning. Co-watch is not currently serving, and the available evidence does not support an all-standards sign-off. Delivery coverage and attribution remain concerns; latency and the inspected structural safeguards look healthy.

## Scope and provenance

- Verified Forge Railway production and matched the Admin database connection to its PostgreSQL service before querying. All production queries used serial read-only transactions, a 25-second statement timeout and a two-second lock timeout.
- Latest 24-hour request window: **2026-09-29 18:42 UTC through 2026-09-30 18:42 UTC**, end exclusive: **September 30 07:42 through October 1 07:42 NZDT**. Previous window is the immediately preceding 24 hours. Initial trailing buffer was 15 minutes.
- Live serving authority was read at **2026-09-30 19:01:21 UTC / October 1 08:01:21 NZDT**. Successive state checks are not one atomic snapshot.
- Railway's successful Admin deployment was `f6f2a1cd-95a7-425e-b049-b44e55e7d5c0`, commit `99554c8b0759ca4d88d02a0d63bf518e0a89b4cf`. Deployed code, rather than this older working branch, was used for policy interpretation.
- Both database and client timestamp parsing were forced to UTC, including PostgreSQL timestamp-without-time-zone columns. Aggregate results contain no viewer identifiers, credentials, vectors or individual viewing histories.
- Primary surface is `watch-below-player-v1`. For you is reported separately. Counts are retained recorded requests/events, not verified unique humans. The latest-24-hour aggregate is not filtered into a randomized human experiment.

## Co-watch: configured, but not executing

The promotion pointer says `owner_approved`, generation 6, 100% exposure ceiling, kill switch off, with manifest `hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1`. That configuration alone does not establish live execution.

Generation 6 was approved **September 30 at 13:56:38 NZDT**, then its release was revoked and graph invalidated **September 30 at 16:07:39 NZDT**, both with reason `eligibility_changed`. Its publication deadline had not yet expired at the state read. Generations 4 and 5 had also been revoked for eligibility changes. The precise eligibility transition that revoked generation 6 was not established by this bounded audit.

The deployed `apps/admin/src/services/recommendations/promotion/owner-authority.ts` rejects a revoked release or invalid graph. Production evidence agrees:

- **Zero of 5,979 requests** across both surfaces recorded exact owner-release execution in the 24-hour window.
- **Zero served cards recorded co-watch contribution**; recorded contributors were semantic, profile, and curated sources.
- **59 requests recorded co-watch fallback to the existing hybrid implementation**: 53 `composition_required_input_unavailable`, six `cowatch_supported_edges_sparse`.
- Of the 53 missing-input fallbacks, 37 contain detailed diagnostics. All 37 flag `missingTheme`; none flag missing source, interest or history. The remaining 16 have no detailed input diagnostics. This diagnoses the recorded composition refusal, not the separate release revocation.
- The graph contains 9,000 edges from 6,680 qualified sources and 2,461 distinct recorded viewers; only 613 edges are marked eligible. A built graph is not evidence of successful serving.

Fallback requests do not retain an exact owner-release generation, so their shared fallback marker cannot assign them to generation 6 specifically. The shadow graph's `no_promotion` / `controlled_evaluation_required_feat_505` result is also not the reason owner-approved execution is currently unavailable: the owner explicitly authorized a direct no-study release under feat-565. The actual live blocker is revocation/invalidation. This assessment does not restore an experimental gate the owner waived.

On current origin/main, **feat-573 is not started** and owns bounded sustainable co-watch refresh. The existing owner operator permits explicit replacement; an enabled pointer does not provide automatic continuity after invalidation or the publication deadline. No graph rebuild, release replacement, toggle or deployment was performed.

## Delivery and performance

| Below-player measure                          |    Latest 24 hours |  Previous 24 hours |
| --------------------------------------------- | -----------------: | -----------------: |
| Requests                                      |              5,958 |              7,215 |
| Requests with any cards                       |     5,028 / 84.39% |     5,945 / 82.40% |
| Full six-card requests                        |     4,633 / 77.76% |     5,383 / 74.61% |
| Requests with no cards                        |       930 / 15.61% |     1,270 / 17.60% |
| Result recorded as fallback                   |        590 / 9.90% |        517 / 7.17% |
| Retrieval p50 / p95 / p99                     | 138 / 340 / 516 ms | 142 / 373 / 522 ms |
| Retrieval timeout                             |                  1 |                  0 |
| Duplicate video-ID rows / current-video cards |              0 / 0 |              0 / 0 |

Of the 930 requests without cards, 811 reported no candidates, 118 missing source embeddings, and one a timeout. Another 395 requests returned partial rows: 383 insufficient candidates, 12 exhausted eligibility. These are coverage/supply concerns, not predominantly slow database requests.

Locale aggregates across both surfaces show **te 0/74, zh 0/35, and ckb 0/34** requests receiving cards. English returned cards for 2,759/3,005 requests; Spanish 1,168/1,168 and French 333/333. These are observations for this window, not claims that those locales can never return recommendations. The SQL locale output is limited to the 15 busiest locales.

All **29,048 stored cards** across both surfaces had a playback ID, image and title. This checks stored presentation completeness, not actual playback success, frontend rendering, or canonical-content equivalence. There were **721 below-player candidate runs marked evidence-incomplete**; this is candidate trace completeness, not an impression measurement or proof of a UI defect.

For you delivered six cards on all 21 requests: 12 cold-start curated rows, five returning curated rows, four returning profile-generated rows. Its p95 was 521 ms. Traffic is too small for a usefulness conclusion.

## Profile learning and recommendation influence

There were **1,509 hybrid-personalized requests across 262 anonymous profiles**. Every inspected hybrid request referenced an existing, nonexpired, nonfuture profile generation with at least one interest. **1,335 requests actually included profile-contributed cards**; merely labeling a request hybrid is not sufficient proof of profile influence.

The pipeline published 3,274 retained profile generations across 2,236 profiles in the window, with 366 profiles having durable interests. Generation and job counts are not unique viewing events. The retained job cohort contained completed or fenced runs, with no failed/pending state; short job retention limits that observation.

**Source-neutral learning is working as intended.** Among episodes whose latest in-window `active-watch-proxy-v1` revision was recorded during the window and that have no recommendation request:

- 1,398 had qualified outcomes; 1,091 were finalized at inspection.
- 978 were currently profile-eligible.
- **857 distinct outcome revisions were retained as contributions to profiles published before the cutoff.**

These views can support future recommendations without any recommendation card impression or click. Recommendation-linked episodes separately had 34 qualified outcomes, nine finalized, and nine retained profile contributions in that revision cohort. Those counts use outcome-revision time and must not be substituted for request-cohort CTR or qualified-card counts.

Among 14,320 contribution rows in profile generations published in the window, none lacked an eligibility receipt, referenced an unqualified outcome, or carried machine/internal/test eligibility receipts. These bounded checks support the inspected learning invariants; they are not a complete privacy/security audit.

## Engagement: card CTR and general viewing remain separate

| Below-player cohort             | Recorded impressions | Recorded selections | Matched selections | Matched CTR |
| ------------------------------- | -------------------: | ------------------: | -----------------: | ----------: |
| All modes, latest 24h           |                  513 |                 104 |                 13 |   **2.53%** |
| All modes, previous 24h         |                  733 |                 112 |                 23 |       3.14% |
| Hybrid personalized, latest 24h |                  103 |                  35 |                  3 |       2.91% |
| Semantic contextual, latest 24h |                  345 |                  60 |                  8 |       2.32% |

CTR here is **distinct served-card selections with a recorded preceding impression for the same item, divided by recorded card impressions**, with both facts received before the common cutoff. Rendered cards alone are not the denominator. General page visits and source-neutral viewing are not counted as card clicks. This audit reads the selection table; it does not independently certify every deployed event producer's semantics.

**91 of 104 selections lack a matching preceding impression.** This does not establish that the cards were invisible or visibility instrumentation is broken. Causes may include clicking before the impression threshold, timing/order, missing evidence, or event semantics; distinguishing those requires a targeted producer/matcher audit. Source-neutral views without a recommendation request are a separate legitimate learning path and are not these unmatched selections.

There were 29 recommendation-linked qualified card outcomes in the request cohort, versus 38 previously; qualified outcomes do not require membership in the matched-CTR numerator. Actual profile-contributed cards had only 31 impressions and three matched selections, too few to infer an uplift. For you had eight impressions, three unmatched selections, and zero matched selections or qualified card outcomes. There were zero experiment assignments across all 5,979 latest requests. Observational mode differences and unequal event maturation do not demonstrate effectiveness changes.

## Standards assessment

The latest stored semantic-control readiness evaluation ran **October 1 at 00:05 NZDT**, over a **separate seven-day window ending September 30 at 18:00 NZDT**. It reports `data_unhealthy`:

| Dimension                                         | Evidence and assessment                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery                                          | **Fail:** stored eligible issued/served delivery rate 80.91%, below the deployed policy's 95% minimum. Stored fallback 4.94% is below its 5% maximum. |
| Attribution                                       | **Unhealthy under current policy:** `selection_without_eligible_impression`. This is an evidence-policy result, not a diagnosis of broken visibility. |
| Retrieval                                         | **Pass in stored evaluation; encouraging current evidence:** latest below-player p95 340 ms versus policy maximum 1,500 ms.                           |
| Outcome maturity / qualified-outcome guardrail    | **Pass in stored evaluation**, limited to that policy's eligible mature cohort; not proof of broad product uplift.                                    |
| Structural card checks                            | **Pass for inspected invariants:** no exact-video duplicates/current-video cards; required stored presentation fields present.                        |
| Source-neutral learning                           | **Observed working**, including 857 retained outcome contributions without a recommendation request.                                                  |
| Co-watch live execution                           | **Not working as a live serving path:** revoked authority and no contributed cards in this window.                                                    |
| Relevance / diversity / repeated viewing          | **Not fully assessed:** no human relevance review; repeat diagnostic below merits investigation.                                                      |
| Storage capacity / full operational certification | **Not certified by this audit:** logical database size is not free disk/WAL/peak refresh headroom; no new browser or load test.                       |

The formal delivery metric uses eligible issued requests and `result=served`; it is not the same denominator or success definition as the 84.39% any-card rate above. Thresholds come from deployed `apps/admin/src/services/recommendations/control-readiness/policy.ts`. This is a semantic-control readiness policy, not a universal deployment veto. The accepted historical telemetry disposition under feat-545/feat-566 and owner-approved no-study path remain in place.

**Repeat diagnostic:** 988/4,145 (23.84%) profile-contributed hybrid cards were videos already represented in the served profile, including 615 (14.84%) learned in the preceding 24 hours. Qualified viewing is not completion. The deployed recent-playback reader already admits source-neutral evidence, and the composer allows refill after fresh candidates are exhausted; this does not establish that the older reader bug persists or that every repeat is a defect.

Retention's latest recorded successful run cleared its then-expired request backlog. At inspection, the oldest currently expired request was September 30 10:40 UTC, around eight hours behind, within the documented 24-hour propagation allowance. This narrow request-retention check is not proof that every retention domain or future graph overlap is within capacity.

## Priorities and existing ownership

1. **Restore and verify actual co-watch serving:** diagnose generation 6 eligibility invalidation and missing theme inputs; verify served provenance after any authorized remediation. Bounded ongoing refresh is already scoped by feat-573. Do not treat the pointer or a built graph as success.
2. **Reduce empty rows:** investigate candidate and exact-locale supply through feat-471; preserve eligibility and language constraints rather than forcing fill.
3. **Tighten engagement semantics:** follow feat-373/feat-369 to distinguish actual card selections, eligible impressions, timing mismatches and source-neutral viewing. Preserve source-neutral learning. Reassess the readiness interpretation if the existing attribution policy misclassifies an intended path.
4. **Review repeated viewing with context:** use feat-478 for suppression versus continuation/refill evidence under deployed code; avoid treating all qualified-video repeats as failures.

## Reproduction and limits

Each adjacent SQL file has a same-name JSON result containing its result sets in statement order: `cowatch-status`, `pulse-ctr`, `pulse-delivery`, `pulse-learning`, `pulse-quality`, `pulse-final-checks`, and `pulse-diagnostic-summary`. Run only with verified read-only production access, UTC parsing and bounded statement/lock timeouts; credentials are intentionally absent. `metadata.json` records deployment, times and scope. Retention, later revisions and current-state changes can alter rerun results.

No production mutation, deployment, rollout, recommendation repair, or settings change was made. This report establishes observed functionality and specific gaps; it cannot certify every product standard or demonstrate personalization uplift.
