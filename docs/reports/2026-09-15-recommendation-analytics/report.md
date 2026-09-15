# Live production recommendation performance — September 15, 2026

**Delivery and recorded playback conversion have improved substantially. Recommendations still reach a small observed audience, and selections have not grown with request volume. Personalized cards attract more clicks, but incremental viewing remains unproven.**

Fresh queries against Forge's production Admin PostgreSQL, verified at **2026-09-15 01:54 UTC / 13:54 NZST**. Primary request window: **September 8, 01:35 to September 15, 01:35 UTC**, end exclusive. Comparison: the immediately preceding seven days, freshly queried from production too. Evidence is capped at September 15, 01:35 UTC, providing at least 19 minutes of ingestion buffer at the initial database check.

## Seven-day results

| Measure                                                      |  Previous seven days |        Latest seven days |
| ------------------------------------------------------------ | -------------------: | -----------------------: |
| Recommendation requests                                      |               56,065 |                   69,973 |
| Anonymous session keys requesting recommendations            |               37,155 |                   53,393 |
| Requests returning cards                                     |      39,129 — 69.79% |      56,349 — **80.53%** |
| Retrieval timeouts / requests                                |       5,719 — 10.20% |        2,032 — **2.90%** |
| Cards served                                                 |              195,287 |                  264,640 |
| Cards recorded as rendered / served                          |     150,834 — 77.24% |     119,085 — **45.00%** |
| Visibility-qualified card impressions                        |               12,437 |                   11,941 |
| Sessions with a visible recommendation / requesting sessions |        2,295 — 6.18% |        2,213 — **4.14%** |
| Selections                                                   |                  404 |                      403 |
| Matched click-through rate                                   | 373 / 12,437 — 3.00% | 387 / 11,941 — **3.24%** |
| Claimed target episodes / selections                         |         295 — 73.02% |         379 — **94.04%** |
| Recorded playback starts / selections                        |         133 — 32.92% |         215 — **53.35%** |
| Qualified active views / selections                          |          75 — 18.56% |         110 — **27.30%** |
| Sessions with qualified viewing                              |                   69 |                      102 |
| Observed active viewing, including unqualified episodes      |           3.32 hours |           **4.82 hours** |

Sources: `funnel.sql` / `funnel.json` and `reconciliation.sql` / `reconciliation.json`.

Qualified viewing means **30 seconds of foreground-playing time OR 25% of the video's duration**, using the active playback classifier. It is a behavioral proxy, not proof of satisfaction, attention, or mission impact. All 110 qualified views have a recorded start and a preceding matched impression. There were 32 outcomes carrying completion evidence and one recommendation-linked share receipt.

## What has improved

**The earlier timeout problem has sharply receded.** On September 8, 1,640 / 10,930 requests timed out (15.00%). Across September 10–14, that fell to 157 / 49,760 (0.32%). The seven-day figure still contains September 8's poor performance.

In the **latest 24 hours**, there were **11,140 requests**, **84.69% returned cards**, and only **20 timed out — 0.18%**. Successful retrieval latency was **134 ms median / 717 ms p95**. These measure server retrieval, not page loading or player startup. The database confirms recovery in observed performance; this analysis does not attribute it to a particular deployment or fix.

**More selections become observed playback.** Starts rose from 133 to 215, and qualified views from 75 to 110 (+46.7%). Missing active coverage among classified recommendation episodes fell from 271 / 403 (67.25%) to 181 / 388 (46.65%). Some of the improvement in recorded viewing may therefore reflect improved evidence capture rather than changed viewer behavior.

## What still limits success

1. **Reach and rendering are the largest unresolved discrepancy.** Requests increased 24.8%, while selections stayed at about 400 and visible impressions decreased 4.0%. Recorded rendering fell from 77.24% to 45.00% of served cards. The daily rendering drop starts September 9. The largest current segment, English, recorded 67,623 renders from 193,696 served cards (34.91%); Spanish recorded 86.76% and French 84.69%. These are observations, not a diagnosed UI regression: request duplication, bots, client abandonment, delivery-to-browser failures, and telemetry admission must be distinguished. Only 4.51% of served cards have a qualified impression.
2. **Language/source coverage remains incomplete.** 13,624 requests (19.47%) returned no cards: 11,556 empty and 2,068 unavailable. The leading reasons are `no_candidates` (7,878), `seed_embedding_unavailable` (3,675), and `retrieval_timeout` (2,032). Across 153 locale codes, all 5,985 requests returned no cards. Examples: Telugu `te` 388, Chinese `zh` 329, Swahili `sw` 234, Tamil `ta` 188. These are request-locale codes, not nationalities, and zero recommendation coverage does not establish absent catalog content.
3. **Playback evidence remains incomplete.** Of 403 selections, 24 have no claimed target episode; another 164 have a claim but no start. Missing coverage is not proof of zero viewing. The latest platform-wide proxy evaluation still reports `revise` / `active_coverage_missing`; its 17,839 missing episodes out of 32,657 concern all discovery sources and are not the recommendation denominator. There were also 1,629 `delivery_timestamp_invalid` rejection events, not necessarily unique viewers or lost impressions.

The latest 24 hours recorded 66 selections, 35 starts, and 13 qualified views. Fifteen of those selections had no classified outcome at the cutoff, so that day's viewing rate is less mature. Closing the seven-day request window six hours earlier yields 382 selections, 204 starts, and 108 qualified views (28.27% per selection). This is a request-age check; late selections can still be younger than six hours.

The share of requesting session keys with qualified viewing was **0.186% previously and 0.191% now**. The larger qualified-view total has not yet translated into a substantial increase in this observed reach measure.

## Is personalization better?

| Execution mode             | Requests | Visible cards | Selections | Matched CTR | Qualified views | Qualified / selection |
| -------------------------- | -------: | ------------: | ---------: | ----------: | --------------: | --------------------: |
| Contextual                 |   62,871 |         9,485 |        267 |   **2.73%** |              70 |            **26.22%** |
| Personalized               |    5,382 |         2,198 |        123 |   **5.32%** |              35 |            **28.46%** |
| Semantic fallback          |      896 |            62 |          4 |       6.45% |               1 |                25.00% |
| No recorded execution mode |      824 |           196 |          9 |       3.57% |               4 |                44.44% |

Personalization produced about **1.95 times the matched CTR**, 30.5% of selections, and 31.8% of qualified views from 7.7% of requests. Its 1,043 requesting session keys differ from the contextual audience: eligibility depends on available history, and repeated sessions contribute multiple observations. The groups overlap and their session counts are not additive.

**This remains association, not demonstrated uplift.** Production still has **zero experiment assignments and zero experiment exposures**, despite one active experiment configuration. Ordinary direct-profile delivery can bypass experiments by design. The viewing-after-selection difference is small, the personalized sample has only 35 qualified views, and missing evidence limits interpretation. Another 824 requests have no recorded execution mode and are kept separate rather than inferred from strategy labels.

## Priorities supported by the live evidence

1. **Investigate the September 9 drop in recorded rendering and current English reach** through the existing `feat-373` work. Reconcile browser requests, completed responses, rendered cards, visible cards, and human/internal/machine traffic before interpreting missing impressions as disinterest.
2. **Close language/source coverage gaps** through `feat-471` and embedding coverage work; preserve language-safe playback eligibility.
3. **Finish playback evidence and navigation measurement** in `feat-369` / `feat-370`, then evaluate personalization with the controlled comparison in `feat-472`.
4. Keep the recovered timeout rate under review through `feat-470`; the old September 8 failure rate is no longer a description of the current service. This report does not close the remediation ticket or establish its causal fix.

## Reproducibility and limits

- The supplied Railway project token resolved to project `forge`, environment `production`. Admin's internal database URL was matched to the database service's connection, including database and credentials; its public endpoint was used. Secrets were never written into the repository or exported with results, and temporary credential files were removed afterward.
- PostgreSQL confirmed `transaction_read_only=on`. Queries ran serially with a 25-second statement timeout, two-second lock timeout, and rollback at transaction end. No production configuration, data, schema, or deployment was changed.
- SQL files contain the fixed boundaries and reads only. JSON files are arrays of result sets in SQL statement order. CSVs are aggregate derivatives. The query runner applies read-only mode; run the SQL inside `BEGIN READ ONLY` with equivalent limits.
- Latest outcome revision is selected separately per episode and classifier before aggregation. Item-level render, impression, and selection records are unique. Delivery result counts reconcile with requests containing actual served items; personalization segments sum exactly to the full latest-week funnel.
- Six selections have no recorded impression and ten precede their recorded impression. They remain selections but are excluded from the matched CTR numerator. The 147 legacy-qualified outcomes are a different measure and are not added to the 110 active-qualified outcomes.
- Previous-week evidence is also read through the current cutoff, so it has more maturation time. These are descriptive comparisons with changing audience mix and instrumentation, not a controlled experiment or significance test. Each SQL statement reads live state with fixed event/expiry cutoffs; the exports are not one atomic historical snapshot. Inventory and current catalog labels are current at read time.
- Session keys last 24 hours and are not verified people. These aggregates are not a verified human-only cohort; neither bot exclusion nor signed-in identity segmentation is claimed. No viewer identifiers, IPs, account data, or raw vectors were exported.
- Retained requests begin September 1 at 00:20:48 UTC; earlier/lifetime performance is unknown. The latest observed retention run succeeded September 14 at 10:30 UTC. No satisfaction survey, spiritual impact, incremental viewing, or longer-term retention measurement is established by these data.

## Current ticket mapping

The ticket numbers above refer to local drafts at audit time. On current main, playback ticket 369 is complete, source-free ticket 477 was renumbered to 488 and completed, repetition 478 becomes 503, and the controlled evaluation 472 becomes 505. The owner excluded locale/source-coverage work. See [implementation scope and verification](../../operations/recommendation-quality-validation-2026-09-15.md) for the current mapping and remaining gates. The measurements in this audit are unchanged.
