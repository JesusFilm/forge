# Feat-370 production verification — September 24, 2026

## Deployment boundary

The expanded Admin and Web readers and Admin worker/bootstrap reached active
Railway `SUCCESS` on reader merge `e7630a12629c3f4fa1507658bd5d290837fd7061`
before the v2 emitter merged. The Web emitter reached active `SUCCESS` on
`1bfdc279518bda308047992a227cdcd0d09f81f8` at approximately 01:39 UTC.
The startup-timeout guard was separately merged in
`a7be679b4c5bc48fbb837af87f8cf895c4283fce`. A direct Railway read at
`2026-09-24T02:14:45.369Z` found Web deployment
`1213d004-5d5f-4583-9274-0eea5e936f93` active `SUCCESS` on that exact
commit, with Admin and worker still active `SUCCESS` on the reader commit.
A fresh reload of the Day 29 Watch page displayed its heading and **Watch
now** control. No local worktree was deployed directly.

## Authorized Admin evidence

The Recommendations overview displayed independent navigation and QoE
observed / partial / missing counts, a coarse device/network cohort, and
separate persisted readiness decisions. The daily 29-day snapshot was
computed at `2026-09-24T01:10:01.551Z` for the exact interval
`2026-08-26T01:10:01.551Z` to `2026-09-24T01:10:01.551Z`. It contained
155,002 episodes. Navigation reconciled as 13,373 observed + 447 partial +
141,182 missing = 155,002; QoE reconciled as 13,476 observed + 344 partial +
141,182 missing = 155,002. The dated 24-hour and seven-day snapshots also
reconciled both families exactly: 1,971 / 68 / 4,515 and 1,978 / 61 / 4,515
of 6,554 episodes; 11,670 / 380 / 25,655 and 11,742 / 308 / 25,655 of
37,705 episodes, respectively.

These snapshots were computed before the emitter reached production and
correctly reported zero v2 summaries. They are not evidence of post-emitter
v2 coverage. The independent navigation and QoE mature-window decisions
remained `inconclusive` with health `unknown` and reason
`insufficient_v2_sample`; their September 16–23 input window preceded the
emitter. No family was promoted or allowed to influence ranking. The overview
labels its latest-20 episodes as a bounded diagnostic sample, not a
full-window rate.

## Normal Watch journey joined to an Admin episode

In an authorized Chrome session, a recommendation opened
`/watch/day-28-zacchaeus.html`. Before interacting with its player, Admin
episode `72055598-3246-4031-86c0-f2046366c84f` showed the matching
recommendation source/media, a claimed episode and six preview viewing-mode
facts. The visible **Watch now** control started decoded playback
(`readyState=4`, time advancing beyond 5 seconds). The visible Hero chrome
**Pause** control stopped playback at exactly `12.54782` seconds. The
**Day 29: Triumphal Entry** chapter link then navigated to that episode; this
is the chapter-intent callsite for `manual_skip`.

After that transition, the **same episode ID** was finalized with 27
append-only facts, no replay or integrity conflicts, and a v2 observation
summary at fact #26. Fact #23 was a navigation fact at the exact
`12.54782`-second position observed in the browser at pause; fact #25 was a
navigation fact at that same position after chapter selection. Its
`playback-observations-v2` projection reported navigation
`observed / inconclusive`, one pause with **user** cause, one manual skip,
QoE `observed / inconclusive`, one closed 31-ms buffering interval, and
coarse `desktop / 4g` context. The fact watermark was 27. The independent
families remained diagnostic and had no ranking influence.

The pre-action Admin ID, exact position match, and fact increments corroborate
the browser-to-Admin episode join. The browser-control interface did not expose
the claim response body, and its console logs did not contain an episode ID, so
a response-level join was unavailable. A separate recent v2 episode inspected
earlier was not this controlled journey and is not evidence of its pause.

The chapter destination started playing automatically and was paused through
the visible player control during cleanup. Its retained automatic-transition
fact was not independently verified in this check.

## Performance and limits

The paired local recorder fixture in `recorder-load-results.json` found
similar mount/load timings and four initial resources for reader and emitter.
In a separate warm-cache Chrome check on the full
`/watch/jesus.html/english.html` page, three reader-baseline reloads had
median visible controls at 1,499 ms and populated recommendations at 2,360
ms. Three later warmed post-emitter reloads had medians of 1,696 ms and
3,265 ms. The first three post-deploy reloads were noisier: medians of 1,820
ms and 3,999 ms. These are wall-clock times around browser automation, not
Navigation Timing or LCP. The recommendation measurement also required
three to five accessibility observations after deployment versus two in the
baseline. Browser automation reached those observed readiness states later in
these samples, but the differing observation protocol cannot establish an
actual page-loading regression or attribute one to the emitter.
Navigation Timing and LCP were unavailable through the browser-control
interface. The emitter does not add a new initial request or render state on
an unplayed Watch page, but a production performance conclusion needs
dedicated RUM or equivalent timing evidence.
