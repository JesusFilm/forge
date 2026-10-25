# Do existing production profiles produce useful recommendations?

**The profile learning and delivery pipeline is operating, and profile candidates contribute to real viewing. Most profiles have little or no usable history, however, and repeat recommendations are a material quality concern. The new For you feed has too little personalized traffic to establish success.**

Production database verified **September 15, 2026 at 02:03:52 UTC / 14:03:52 NZST**, with read-only mode enforced. Behavioral window: **September 8, 01:45 through September 15, 01:45 UTC**, end exclusive. Profile inventory is current at query time, using the verification timestamp for active/expiry checks. No application code, production data, configuration, or deployment was changed.

## Existing profiles

| Measure                                                        |          Live result |
| -------------------------------------------------------------- | -------------------: |
| Active profiles at the verification cutoff                     |              119,096 |
| Profiles with a usable learned or short-lived interest         |    **1,208 — 1.01%** |
| Profiles with durable interests derived from qualified viewing |            **1,171** |
| Profiles with only short-lived selection intent                |                   37 |
| Published profiles with no contributions                       | **117,093 — 98.32%** |
| Active profiles without a published projection                 |                  795 |
| Median contributions among populated profiles                  |                **1** |
| 95th percentile contributions among populated profiles         |                   13 |

Creating a profile does not establish that a viewer watched enough to learn a preference. These counts include automatically created anonymous profiles and are not verified people or a consent acceptance measure. They do not establish that 98% of viewers have a broken profile.

715 populated profiles have one durable interest, 178 have two, 73 have three, and 205 have four; 37 have only session intent. The typical populated profile is still shallow. All 1,208 populated current profiles have advanced beyond their first generation. The initial inventory and subsequent health query can differ by a few rows because production remained live between statements.

## Is learning actually happening?

**Yes, in the observed eligible cohort.**

- The current populated profiles contain **4,442 qualified-outcome contributions**. All inspected contributions point to a qualified active-proxy outcome on a finalized/timed-out episode with matching media and privacy-generation fields. None had a missing outcome, wrong classifier, unqualified outcome, unfinished episode, wrong media, or expired contribution. This is a check of these invariants, not a complete privacy audit.
- Across the latest week, **4,412 qualified outcomes across 1,094 profiles** appeared in published projections. Median time from outcome classification to first publication was **0.588 seconds**, p95 **1.842 seconds**. This measures publication after classification, not time from pressing Play.
- Of 1,127 profiles with a learned generation published during the week, **673 subsequently supplied a generation used by 4,813 personalized requests**. This verifies persisted learning-to-later-delivery links; it does not replace a browser lifecycle test.
- In the more tightly checkable cohort with still-valid session links, **all 764 profile-eligible qualified outcomes with compatible English embeddings had reached a published profile**. Another **45 eligible outcomes lacked those embeddings and were not learned**. The projection loader currently represents watched videos using compatible English transcript embeddings, even when viewing happens in another language. This is a content coverage dependency, not evidence of a stalled worker.
- Eleven of the 764 were absent from the current projection despite appearing in an earlier published generation. The store is bounded to 64 contributions and recomputes eligibility; this aggregate alone cannot distinguish cap eviction from later eligibility/revision changes.
- The retained workflow inventory had 16,683 completed runs, nine failed runs, and 47 fenced runs, with no pending/claimed backlog at that read. These short-lived run rows are not a seven-day execution denominator. Fencing can be normal concurrency handling; failed runs were not individually diagnosed here.

## Are profiles influencing recommendations below a video?

**Yes.** The `watch-below-player-v1` surface recorded **5,380 hybrid personalized requests across 855 stored profiles** during the window.

- **All 5,380 returned cards**, and **5,249 / 5,380 (97.57%) returned six**. There were no same-video duplicates within a row and no recommendation of the current source video.
- Every recorded personalized decision linked to a projection; none linked to a projection that was expired at request time, published after the request, or recorded as containing zero interests. This applies to successful personalized decisions, not failed attempts that fell back before entering that mode.
- Profile candidate retrieval measured **114 ms median / 271 ms p95**, excluding other delivery work and fallback attempts.
- **4,917 / 5,380 rows (91.39%) contained a profile-contributed card**, averaging **2.87 such cards per row**. The other 463 rows had a personalized execution decision but their final cards had only semantic contributions. Thus the execution label alone overstates item-level profile influence.
- Of 31,966 served cards, **15,465 had a profile contribution**: 7,270 were nominated only by the profile source and 8,195 by both profile and semantic sources. The other 16,501 were semantic-only.

| Below-player card group within personalized requests | Visible cards | Selections | Recorded starts | Qualified views |
| ---------------------------------------------------- | ------------: | ---------: | --------------: | --------------: |
| Profile-contributed                                  |         1,131 |     **63** |              39 |          **22** |
| Semantic-only                                        |         1,067 |         60 |              33 |              13 |

Profile-contributed cards generated 22 / 35 qualified views in personalized rows. Their qualified-view rate per selection was 34.92% versus 21.67% for semantic-only cards in those rows, but these small, position-dependent groups are not randomized comparisons.

Across whole rows, personalized matched CTR was **5.32%**, versus **2.72%** for contextual delivery. Personalized rows produced 123 selections, 72 starts, and 35 qualified views. Qualified viewing means 30 seconds of foreground-playing time OR 25% of duration; it does not establish satisfaction or completion. Existing history selects a different audience, so these figures do not prove causal uplift.

## Quality concern: recommending videos already used to learn the profile

Of the 15,465 profile-contributed cards, **4,843 (31.32%) pointed to a video already present as qualified viewing in the exact projection used to serve that request**. Across the entire hybrid row, 5,279 / 31,966 cards repeated learned videos; 4,564 / 31,966 (14.28%) matched an outcome classified within the preceding 24 hours.

This is meaningful prior viewing, not necessarily completion; returning to a partially watched video can be useful. It nevertheless means high vector similarity can reflect recommending the very same watched content rather than useful discovery.

A diagnostic of the **latest 200 personalized requests** found 91 cards matching recently learned videos:

- 90 matched viewing learned outside the recommendation flow. Only **one** had a recorded recent-history suppression.
- One matched recommendation-origin viewing, and it had a suppression record.

The current checkout's `recent-context.service.ts` builds recent playback context by joining playback facts through prior recommendation requests and served items. Direct/search/share playback episodes without a recommendation request cannot enter that path, although the profile learner accepts those source-neutral episodes. This supports a reader coverage gap. Verify the deployed revision and its exact history bounds before attributing every repeated card to that gap.

Recent-history suppression is intentionally a preference in `slate.ts`: suppressed videos may refill a short row after fresh candidates are exhausted. A `refill_after_suppression` composition reason also covers position movement, so that string alone does not prove a card was suppressed; the diagnostic uses the rejected-stage history reason separately. The follow-up is tracked in `feat-478`.

## The separate live For you feed

The production ledger also contains `watch-for-you-v1` / `profile-first-curated-fill-v1`, beginning **September 14 at 00:16 UTC** in this extraction. It has no `recommendation_personalization_decision` rows; its recorded cohort and projection reference live in item provenance. An execution-mode-only report would misclassify it as unknown.

| For you cohort                                 |                    Requests | Composition                            |
| ---------------------------------------------- | --------------------------: | -------------------------------------- |
| Recorded cold start                            |                         809 | Six curated cards                      |
| Recorded returning, profile candidates used    | **13 across nine profiles** | **Six profile cards, no curated fill** |
| Recorded returning, no profile candidates used |                           2 | Six curated cards                      |

All 824 requests returned six distinct video cards. All 13 linked personalized projections were published before use and unexpired when used; their median contribution count was three. Profile-based delivery measured 438 ms median / 806 ms p95 for this small sample.

The 78 profile cards produced **72 render receipts, 29 visible impressions, two selections, and zero recorded starts or qualified views** by the cutoff. The curated cards produced seven selections, four starts, and four qualified views. This is too little personalized exposure to establish either effectiveness or a systematic playback failure.

Fourteen of the 78 profile cards matched prior qualified viewing in the served projection; eight matched prior completion evidence across three requests/profiles. Of those eight, four were classified complete within seven days, none within 24 hours; ages ranged from 28.21 to 168.13 hours. The intended completion exclusion window must be checked against the deployed implementation before calling these violations. The local feat-477 plan leaves that bound unresolved, so it is not evidence of the live policy.

## Assessment and next steps

1. **The core learning loop is working for existing profiles with eligible, embeddable history.** It learns promptly, publishes valid state, and reuses that state in later recommendations.
2. **The population is mostly cold or shallow.** Improve the conversion from useful viewing into available profile evidence, including the English-embedding coverage gaps already owned by `feat-471` / `feat-199`. Do not treat total profile count as personalization adoption.
3. **Investigate repeat handling before describing recommendation quality as strong.** Address the source-neutral history-reader gap for below-player rows, and separately verify For you's completion window. Preserve legitimate partial-watch continuation and language-safe fill rules.
4. **For you needs more measured returning-profile traffic and verified playback handoffs.** Its nine-profile sample cannot support an effectiveness conclusion. Keep it separate from the much larger below-player population, and retain the controlled usefulness evaluation in `feat-472`.

## Evidence and limitations

SQL and JSON files beside this report contain reproducible aggregate queries and outputs. JSON stores result sets in SQL statement order; CSVs are derivatives. No raw profile/session identifiers, viewing histories attached to identities, tokens, or vectors were exported. The supplied Railway credential was reused only to resolve the verified Forge production database; temporary database credentials were removed after reads.

Transactions enforced read-only mode, a 25-second statement timeout, and two-second lock timeout. Two broader repeat-stage diagnostics exceeded their timeout; the final evidence check was narrowed to the latest 200 personalized requests. Other profile, delivery, and repeat-card totals are full aggregates of their stated cohorts. Live statements do not form one historical atomic snapshot. Latest outcome revisions are selected per episode/classifier for behavioral totals; persisted projection contributions are inspected as the historical inputs actually used. Short-lived profile/session/run retention limits reconstruction, and the still-linkable learning cohort is not the entire seven-day audience.

This is a production data assessment, not a browser test, an evaluation by viewers, a human-only cohort, or a controlled experiment. Recommendation content was not manually rated against private individual histories. The report establishes functioning data flow, observed engagement, and concrete quality risks within those limits.

## Current ticket mapping

The ticket numbers above refer to local drafts at audit time. On current main, playback ticket 369 is complete, source-free ticket 477 was renumbered to 488 and completed, repetition 478 becomes 503, and the controlled evaluation 472 becomes 505. The owner excluded locale/source-coverage work. See [implementation scope and verification](../../operations/recommendation-quality-validation-2026-09-15.md) for the current mapping and remaining gates. The measurements in this audit are unchanged.
