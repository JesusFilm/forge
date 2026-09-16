---
id: "feat-517"
title: "Reproduce the intermittent Watch HTML hydration mismatch"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-09-16"
duration: 1
depends_on: []
blocks: []
tags: [web, watch, hydration, verification]
---

## Observed behavior

The 04:05:13–04:06:03 UTC browser batch in the September 16 Admin recovery
observation emitted one React #418 with `args[]=HTML`. All six selections
returned valid acknowledgment bodies and all twelve deliveries served six cards;
all six destinations matched. The batch's overall browser assertion failed
because it also requires no JavaScript errors. Preserve that failure separately
from recommendation HTTP failures and semantic timeout fallbacks.

A 04:07:14–04:07:40 revisit of the source and six destination pages did not repeat
the error. Datadog RUM matched the observation to `/watch/sermon-on-the-mount-2.html` at
04:05:52, issue `8513bab6-8960-11f1-a33c-da7ad0900002`. The same HTML variant
predates both Admin fixes: 01:34:24 on `/watch/the-four-collection.html/luganda.html`,
00:53:42 on a Vietnamese New Believer episode, and September 15 at 23:37:57 on
a Spanish JESUS episode. This establishes a pre-existing error class, not an
identical initiating cause on every page. No cause has yet been reproduced.
Web ran `469edc6f996db1c6bd729b9a1b9f0e2732a0cd58`; Admin ran `9533506f`.

## Reproduction and entry points

Start with `/watch/chosen-witness.html` and follow ordinary recommendation
cards. The affected batch visited `magdalena-director-cut`,
`4-jesus-our-powerful-deliverer`,
`rivka-home-disciples-chosen-and-women-followers`, `day-5-jesus-suffered-for-me`,
`sermon-on-the-mount-2`, and `jesus-is-brought-to-herod` `.html` routes. The
original harness retained the error text; RUM supplied the exact page and a
minified stack. Subsequent captures must retain the complete stack and HTML
difference without persisting identity credentials.

- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/recommendations/WatchSemanticRecommendations.tsx`
- `docs/solutions/ui-bugs/watch-subtitle-discoverability-hydration.md`
- `docs/solutions/performance-issues/per-visit-randomness-on-a-statically-cached-route-20260827.md`
- `docs/operations/watch-admin-duration-recovery-2026-09-16.md`

Capture the exact server/client HTML difference with matched build, locale,
cache and browser state. Correlate source-mapped errors before selecting the
responsible component. A successful repeat is not a fix. React's diagnostic is
[documented here](https://react.dev/errors/418).

## Verification and constraints

Add a failing regression only after reproducing the mismatch. Verify hydration,
real navigation, recommendation acknowledgment and page-loading performance.
Do not suppress hydration warnings, disable telemetry, change recommendation
budgets or claim success from HTTP 200 alone. Keep the authored English homepage
recommendations block removed and its feature flag default off. This is separate
from feat-515's cold-paint investigation and the proven Admin catalog fixes.
