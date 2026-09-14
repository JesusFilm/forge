# Homepage recommendations restoration — 14 September 2026

Owner: `feat-488`. Runtime recovery: `feat-496`. Curation: `feat-487`.

## Scope

Restore the Web portion of #2249 after the #2250 rollback, applying its focused
patch to current main so subsequent homepage and analytics changes remain.
The Admin API, migrations, native viewer operations, block schema and curation
artifacts were already merged and are not reintroduced by this change.

The top-level **Homepage Recommendations Block** renders **Recommended for You**
below Browse by category. Web requests six videos, keeps the row stable while
browsing, opens full videos through Watch, and refreshes when returning home.
The shared API retains its bounded count and independent anonymous identities
for native consumers. Curated pools fill only a shortfall in profile results.

`WATCH_FOR_YOU_ENABLED` still defaults to false. Code restoration does not publish
homepage content, promote production curated pools or activate source-free
serving. Existing production recommendation routes continue their current role.

## Verification

- The full Web suite passes **4,144 tests**, with three skips and one todo. Lint,
  typecheck, production build and ISR-output pruning pass.
- A test fixture now returns accepted evidence receipts. Empty mock receipts
  previously scheduled real retries that could consume the following test's
  delivery mock; application behavior is unchanged by that fixture repair.
- Production Web and Admin builds serve the isolated local database. Desktop
  (1440 px) and mobile (390 px) checks both return six distinct cards, verify
  placement, preserve ordering on focus, open the full video, and refetch six
  cards after navigating back. No page errors occurred.
- Screenshots were inspected for the existing spacing, typography, responsive
  row, imagery and heading.

### Paired production-build load comparison

Four alternating fresh-browser loads per revision used the same production
Admin build and isolated database. The first load of each revision is reported
as cold and excluded from the three-sample warm medians:

| Warm median                       | Current Web without row | Restored row enabled |
| --------------------------------- | ----------------------- | -------------------- |
| Time to first byte                | 25.2 ms                 | 24.8 ms              |
| DOM content loaded                | 65.2 ms                 | 66.1 ms              |
| Largest contentful paint          | 2,028 ms                | 1,652 ms             |
| Encoded JavaScript bytes observed | 1,009,687               | 1,014,315            |
| Cumulative layout shift           | 0.0274                  | 0.0403               |

The row adds 4,628 observed JavaScript bytes (about 0.46%). Layout-shift ranges
overlap: 0.0267–0.0536 for the control and 0.0398–0.0445 for the restored page.
All samples stay below 0.054. At this 1000-pixel viewport the row is already
within its 300-pixel preload margin, so it correctly makes one delivery request
before scrolling. This is a small local comparison with remote hero media and
cache variability; it shows no material loading regression, not a production
speedup claim. Cold TTFB is 3,140 ms versus 1,625 ms and is not a matched-cache
benchmark.

The preview initially encountered expired local retention evidence and missing
Redis settings when switching development fixtures to production processes.
Running the real bounded retention task against the isolated clone, configuring
its local Redis, and clearing only the owned preview cache resolved those setup
failures. No production state or runtime deadlines were changed for the preview.

## Release boundary

Redis admission cancellation is repaired by #2276. An independent Admin
preferred-dub batching fix reduces homepage SQL fanout; its evidence and remaining
runtime uncertainty are in `docs/operations/watch-runtime-diagnosis-2026-09-14.md`.
Production browser validation after the Redis deployment passes playback,
profile feedback, six existing seeded recommendations and evidence receipts.
Recommendation 503s remain present in aggregate traffic, so a successful browser
session does not close the runtime incident.

Production curation eligibility and activation remain separate from this code
restoration. Do not relax language, viewing-history or distinct-video rules to
turn incomplete pool coverage into a six-card success claim.

## Shared-client CI prerequisite

The restored shared experience fragment exercises native consumers in CI.
All application build/test/lint checks passed, but `expo-doctor` found 17
pre-existing mobile SDK patch pins below the versions expected by Expo 57.0.22.
Existing **#2267** contains that exact dependency alignment; its diff and green
CI were reviewed before merging it at **22:13:33 UTC**. The homepage branch was
updated from main so its final CI uses those aligned dependencies. No native
homepage surface or cross-device identity work was added.
