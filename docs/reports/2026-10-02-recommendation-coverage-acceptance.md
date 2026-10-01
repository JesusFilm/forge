# Recommendation delivery: accepted coverage limitations

Owner disposition: October 2, 2026 (Pacific/Auckland). The owner clarified that
the observed empty/partial results are acceptable coverage limitations, not
delivery bugs, and the product can proceed. Server errors and timeouts remain
issues. The durable classification rule is in
[the recommendation policy](../analytics-and-recommendation-policy.md#delivery-health-and-accepted-coverage).

## Deployed repair and evidence

[PR #2527](https://github.com/JesusFilm/forge/pull/2527) repaired exact-audio
filtering, Chinese presentation identity and request diagnostics. Both Admin
and Web deployed merge `58cf00928a083156414618988f42c02545b4b1e6` on October 1.
The [post-deployment verification](https://github.com/JesusFilm/forge/pull/2527#issuecomment-5923920742)
records successful migrations, six visible recommendation cards, normal video
playback and no browser errors. The semantic partial-row policy already works
within the existing bounded pool and is protected by regression tests.

On October 2 at 10:13:43 NZDT (`2026-10-01T21:13:43.795Z`), a bounded read-only
production query rechecked the exact October 1 audit window, 15:58–16:13:31.980
NZDT (`2026-10-01T02:58:00Z` inclusive to `03:13:31.980Z` exclusive). It reproduced
55 issued requests, 46 with cards, 271 cards and nine empty results. None recorded
an unavailable/server-failure result, issuance failure or timeout.

| Empty requests                                               | Observed cause                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 2 Nepali                                                     | Missing seed transcript, translated display text and approved fallback context.                                                     |
| 4: Afrikaans, Northern Ndebele, Amharic, Kannada             | Missing translated display text and approved fallback contexts.                                                                     |
| 3: English display with Kusaal Western, Sheko or Ruund audio | Bounded retrieval returned no eligible matches; no approved fallback context. This does not establish exhaustive catalogue absence. |

The separate co-watch audit of that same window recorded four
`cowatch_supported_edges_sparse` fallbacks. All four still returned ordinary
recommendations. A bounded retained-graph check found no supported edge from
their seeds or retained profile medoids; zero co-watch contribution in that
sample is consistent with sparse coverage, not a failed overall delivery.

The same October 2 read checked the preceding hour, 09:13:43–10:13:43 NZDT:
328 recorded seeded requests, 299 with cards and 29 empty. Of the empty results,
20 lacked published display text while seed material was available, four lacked
both display text and the seed transcript, and five returned no eligible matches
despite display/audio availability. All 29 lacked an approved fallback context.
All 328 requests were issued and had
diagnostics; none recorded an unavailable result or timeout. Of the 299 with
cards, 45 used curated fallback for unavailable seed material.

## Interpretation and limits

These observations establish accepted coverage shortfalls in the sampled
recorded deliveries. They do not establish a global fill-rate improvement,
complete catalogue exhaustion, full-service fleet latency or the absence of
HTTP failures before ledger persistence. A nonempty row is not required for
every language/audio context, and positive co-watch contribution is not required
to accept an otherwise healthy delivery path.

Queries used verified production database identity, `BEGIN READ ONLY`, five-second
statement and one-second lock limits, UTC parsing, and at most 1,001 historical
or 10,001 recent request roots. Output was grouped by result, context and stage
facts; no viewer, request or item identifiers were exported. Recorded counts
are request counts, not unique humans. No runtime, inventory, language fallback,
release authority or production configuration changed during this disposition.
