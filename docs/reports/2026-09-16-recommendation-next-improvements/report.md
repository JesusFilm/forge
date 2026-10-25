# Fresh production analytics: next recommendation improvements

Queried production read-only at **September 15, 2026, 22:35–22:39 UTC**
(September 16, 10:35–10:39 NZST). No application, production data, flag or
deployment changes were made. Analysis uses the existing isolated worktree on
`codex/recommendation-analytics-followup`.

## Assessment

Prioritize the selected-video handoff and missing playback evidence, row exposure,
and useful fallbacks for cold profiles. The recent-play repair is functioning;
profile learning has valid inputs. The current data supports investigating these
gaps, not claiming a causal benefit from personalization or from the new release.

## Owner decisions after this audit

Recommendation Visibility (feat-373) and locale expansion (feat-471) are excluded
from the follow-through. Keep preview first. The existing manual-play collector
does not measure sustained muted preview viewing, so a claimed episode with no
manual-play facts can still be real viewing. Add an independent visible-playing
mode signal and use qualified sound-off behavior in the profile and ranking;
never reinterpret that missingness as dislike or proof of no watching.

## Fresh measurements

Delivery window: **September 14 at 22:30 to September 15 at 22:30 UTC**.
The window spans older deployments. A separate **22:10–22:30 UTC** sample uses
the fully deployed release. That twenty-minute sample includes the two disclosed
synthetic playback probes from release verification.

| Measure                                       | Fresh result                | Interpretation                                                                                            |
| --------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Stored below-player requests                  | 10,052                      | Issued-request population, not all HTTP attempts or verified people                                       |
| Requests returning no cards                   | 1,521 / 10,052 = **15.1%**  | 922 no candidates, 590 seed embedding unavailable, nine retrieval timeout                                 |
| Cold-profile decision                         | 8,785 / 10,052 = **87.4%**  | Most requests rely on contextual recommendation quality                                                   |
| Personalized execution                        | 956 / 10,052 = **9.5%**     | 191 profiles; not a distinct-person adoption rate                                                         |
| Retrieval latency                             | p50 91 ms / p95 358 ms      | Retrieval component only, not complete page/delivery time                                                 |
| Usable current profiles                       | 1,336 / 124,899 = **1.07%** | Automatically created profiles are not verified people; sparse histories are expected                     |
| Median contributions among populated profiles | **One**                     | Most usable profiles are shallow                                                                          |
| Current qualified profile contributions       | 4,777 across 1,299 profiles | Zero inspected missing/unqualified/wrong-classifier/unfinished/media/privacy-generation/expiry violations |

Current profile pointers and state were read at query time; validity comparisons
use the 22:30 cutoff. This is not reconstruction of a historical atomic profile
snapshot. The contribution checks cover named invariants, not a complete privacy
or eligibility audit.

### Selection, playback and exposure

Request cohort: **September 14 at 21:30 to September 15 at 21:30 UTC**.
Evidence cutoff: **September 15 at 22:30 UTC**, allowing every request at least
one hour of follow-up. This does not make every playback episode finalized or
satisfy the controlled evaluation's maturity rules. Five of 80 selections still
lack an active outcome revision at this cutoff.

| Observed below-player funnel                    | Contextual | Personalized |
| ----------------------------------------------- | ---------: | -----------: |
| Requests with cards                             |      7,679 |          984 |
| Rendered cards                                  |     12,079 |        5,292 |
| Recorded eligible card impressions              |      1,709 |          384 |
| Selections after a recorded impression          |         51 |           27 |
| Matched card CTR                                |  **2.98%** |    **7.03%** |
| All selections                                  |         52 |           28 |
| Claimed episodes                                |         50 |           28 |
| Recorded playback starts                        |         33 |           13 |
| Claimed episodes with no nonlate playback facts |     **17** |       **15** |
| Recorded qualified active-watch outcomes        |         17 |            9 |

The 32 claimed episodes without facts explain the recorded start gap more
precisely than “users abandoned playback.” Two additional selections were not
claimed. There were no attempt-without-start facts or recorded player errors in
the no-start group. This absence cannot distinguish telemetry loss, player
activation behavior, navigation, automation or a playback problem. It must not
be learned as dislike.

Across contextual, personalized and fallback delivery, **508 / 8,675 nonempty
rows (5.86%)** had any recorded eligible impression. For personalized cards,
**384 / 5,292 rendered cards (7.26%)** reached that threshold. The current
instrumentation cannot prove every missing impression means below-fold content;
admission/automation, visibility, dwell and transport need reconciliation.

Personalized impression-bearing traffic covers 50 sessions versus 365 contextual
sessions. Prior history, position and audience differences confound the CTR
comparison. These are matched recorded-event rates, not experiment results or
human-only measures. Do not optimize clicks alone or equate qualification with
satisfaction.

### Recent-release behavior

The 22:10–22:30 window has 105 below-player requests, 499 cards, ten empty
requests and no duplicate slates. In 21 requests containing profile-generated
cards, 23 actual rejected entries carry `recent_playback_start`. Three served
cards across two requests repeat recently qualified content; all three have
both actual suppression and refill/movement provenance. Composed movement
entries are not counted as rejections.

This supports the repaired mechanism. The short, differently composed sample
does not establish a reduction in population repeat rate or increased usefulness.

The public For you availability endpoint was rechecked at 22:38:50 UTC:
HTTP 200, `enabled=false`. Its stored requests from the day include earlier
activity/diagnostics and cannot establish a current visible homepage journey.

## Ranked next work

1. **Explain and repair the selection-to-playback evidence gap.** Trace selected
   navigation through destination hydration, player activation, episode claim,
   first fact and finalization on representative devices. Separate “never
   activated,” “failed to play,” and “facts failed to arrive.” Finish the bounded
   retry/status repair in feat-509 and use feat-370 for startup/QoE and missingness
   reconciliation. The one known serialization failure from release monitoring
   cannot by itself explain these 32 episodes. Success means a reconciled
   selection-to-start funnel, reliable facts, and preserved navigation/playback.
2. **Measure why delivered recommendations are rarely seen, then test placement.**
   Prioritize feat-373's surface/position/visibility reconciliation, including
   desktop/mobile, below-fold rows and carousel movement. Once the denominator
   is trustworthy, test a more discoverable row or an end-of-play recommendation
   prompt while measuring player startup and page load. Success means more
   qualified recommendation viewing, not inflated impressions or clicks.
3. **Improve cold-start delivery and avoid recoverable empty rows.** Most traffic
   lacks a learned profile; investigate a bounded, reviewed fallback using
   existing approved inventory when semantic candidates are absent. Even English
   has 285 missing-seed and 167 no-candidate requests in this window. Reusing
   feat-487's pools for seeded/below-player delivery would be a new serving policy
   requiring design and validation; feat-487 is not an open ticket for this work.
   Recheck exact audio, publication, playback, current-video exclusion and recent
   history. The full 15.1% is an opportunity bound, not a proven recoverable share.
   Do not reopen excluded feat-471 or expand locale coverage implicitly.
4. **Evaluate a better mix of familiar and fresh content.** Continue feat-393's
   shadow composer, resolve its missing inputs and terminal decision, and test
   diversity without displacing editorial constraints or breaking sparse fill.
   Repeats with valid refill provenance need better fresh supply or an explicitly
   evaluated composition policy, not blanket removal that leaves empty rows.
5. **Use a controlled comparison to decide whether ranking changes help.** Finish
   feat-505's readiness/assignment/exposure work and run the planned A/A before
   an authorized A/B. The primary outcome remains qualified recommendation views
   per assigned eligible unit, with nonexposed units retained. Use active minutes,
   starts and CTR as secondary measures and preserve operational guardrails.

Start with **feat-373 plus the feat-370/509 handoff and evidence work**. Develop
the supported-context fallback proposal alongside them, then use feat-505 to
judge composition changes. Keep immediate exits as unknown-preference evidence;
the available data does not justify a dislike weight. For you activation remains
an explicit separate owner decision.

## Evidence and limits

- [Production aggregates](results.json) and [queries](queries.json).
- [Position, missingness and recent-repeat checks](followup-results.json) and
  [queries](followup-queries.json).
- [Current For you availability](availability.json).
- [Release production verification](../../operations/recommendation-production-verification-2026-09-16.md).

Reads enforced connection-default and transaction-level read-only mode, a
25-second statement timeout and a two-second lock timeout. All final queries
succeeded; the slowest aggregate completed in approximately 2.15 seconds including
network overhead. Exported artifacts contain aggregate counts, no viewer/profile/
session/episode identifiers, capabilities or vectors. Independent statements are
not one atomic snapshot. The locale breakdown is limited to the 35 largest groups
and is not a complete language-coverage report. The core traffic windows mostly
predate the new release, and production includes nonhuman/synthetic activity.
