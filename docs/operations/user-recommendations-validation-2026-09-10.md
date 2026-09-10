# User recommendations: local validation, 10 September 2026

The implementation is available in the isolated worktree
`codex/feat-477-user-recommendations`, based on `origin/main` at `899aa556`.
Web runs at <http://localhost:3047/watch>; its Admin API runs on port 3147.
The preview uses a separate local PostgreSQL database, `forge_feat477_20260910`,
cloned from the existing development catalog. No production data or deployment
was changed. Both new serving flags default off outside this preview.

## Automated checks

- Recommendation regression suite: **447 passed**, 61 passing files. Its 72
  opt-in database tests were skipped in that run; database checks below ran
  separately against local PostgreSQL.
- Focused Web recommendation and playback checks: **103 passed**. Final homepage,
  For you component and BFF checks: **31 passed**, including pending withdrawal,
  fixed placement, stable focus, refresh and six-card composition.
- Catch-all routing checks: **96 passed**, including forwarding the actual UI
  locale separately from the selected playback language on language homepages.
- All 225 Web message catalogs passed parity and ICU checks (**458 checks**).
  Pending For you translations remain explicitly tracked in the existing policy.
- Real PostgreSQL: viewer lifecycle **2 passed**; profile projection and source-free
  retrieval **2 passed**; playback episode lifecycle **6 passed**; curated
  generation validation/publication/rollback **1 passed**. The latter also has
  **13 passing unit tests**. The two new database files are included in CI.
- Final targeted profile/delivery checks passed after preventing click-only
  session interests from starting homepage personalization. The real database
  fixture verifies useful source-free retrieval after one qualified outcome.
- Admin, Web and shared GraphQL client TypeScript checks passed. Admin SDL and
  client introspection were regenerated through their generators. Changed-code
  lint, formatting, locale-generation consistency and diff checks are recorded
  in the final local check logs.

These groups overlap; their counts must not be added into a claimed unique total.
Full production build, production traffic, native application UI and real-world
recommendation quality were not validated by this local run.

## HTTP and browser evidence

The native HTTP smoke used a fleet consumer bearer and opaque viewer/session
handles, with **no cookies**: bootstrap, six curated recommendations, render and
impression evidence, selection, playback claim, playback feedback and deletion
all passed. Shared operations expose this same contract to native clients.

Chromium desktop (1440 × 1000) and mobile viewport (390 × 844) verified:

- Six distinct cards immediately below Browse by category, with loaded images.
- Stable card order and no new delivery on ordinary window focus.
- Keyboard Enter opens the canonical whole-video route. Chosen Witness resolved
  with the correct title and a video element; no scene timestamp was appended.
- Returning home fetched a new list and restored six cards.
- No uncaught page errors; recommendation HTTP responses were all 200.

An additional desktop pass selected Watch now in the normal player. Its playback
claim and facts were accepted by the real local API. This short playback is not
claimed as a qualified view: qualification and learning were verified by the
separate deterministic PostgreSQL fixture.

The local snapshot initially lacked a published homepage and route manifest.
The preview publishes a valid local homepage body containing the category block,
uses local playback template data, and regenerates the Admin route manifest with
`pnpm --filter @forge/admin watch-route-manifest:generate`. These are development
fixtures, not production homepage edits. Canonical recommendation URLs required
no routing workaround.

Browser harness: Playwright Chromium with a normal browser user agent, fresh
contexts, and `ignoreDefaultArgs: ["--disable-dev-shm-usage"]`. Default Chromium
GPU allocation failed because the shared `/tmp` mount was nearly full; using
`/dev/shm` corrected the harness. Browser navigation checks disabled HTTP cache to
avoid stale Next development/HMR documents during repeated worktree edits.

Local evidence files:

- `/tmp/forge-477-ui-flow.json`: desktop/mobile assertions.
- `/tmp/forge-477-playback-flow.json`: normal player and feedback assertions.
- `/tmp/forge-477-native-final.json`: cookie-free API smoke.
- `/tmp/forge-477-desktop.png`, `/tmp/forge-477-mobile.png`,
  `/tmp/forge-477-playback.png`: inspected browser captures.

## Page-load comparison

Compared the same local homepage with `WATCH_FOR_YOU_ENABLED=false` and `true`,
using the same Chromium harness, fresh browser contexts, one discarded warmup
and three measured navigations per condition. Runs were sequential without other
browser or test workloads. Values below are medians from Next development mode,
not production Core Web Vitals or a statistically powered performance result.

| Metric               |  Flag off |   Flag on |
| -------------------- | --------: | --------: |
| TTFB                 |  266.7 ms |  266.6 ms |
| DOMContentLoaded     |  389.8 ms |  509.1 ms |
| LCP                  |   2380 ms |   2184 ms |
| CLS                  |    0.0303 |    0.0300 |
| Encoded script bytes | 2,196,836 | 2,196,836 |

No added script transfer, TTFB increase or LCP/layout-shift regression appeared in
this comparison. DOMContentLoaded was about 119 ms slower; this small development
sample cannot establish its cause or production impact. Confirm production
navigation/hydration timing during staged activation. Recommendation delivery is
client-side and bounded, with lazy images and reserved skeleton geometry. The
row entered the 300 px prefetch margin in this desktop fixture, so the enabled
run made one delivery request before scrolling; it is not a zero-request initial
page claim. Raw samples are in `/tmp/forge-477-performance-off-controlled.json`
and `/tmp/forge-477-performance-on-controlled.json`.

## Curation and activation gate

The one-time delegated curation produced start pools and five interest themes.
Local generation `2026-09-10.astra-admin-preview.v2` is active for en/English,
fr/French and hi/Hindi. The broader audit evaluated 2,317 audio languages in the
en UI context: 2,273 have at least thirty curated starters, while 35 languages
have fewer than six eligible Admin IDs even across the entire local catalog.
Overlapping interest lists cannot create missing inventory. The later exhaustive
pass below completes the local UI/audio matrix and individual flagged-choice
metadata reviews. Translation/inventory gaps and current production eligibility
remain activation requirements in feat-476/feat-477. No monthly worker or model
API call was used.

See [consumer and operations guidance](user-recommendations.md), the
[coverage report](../recommendations/curation/2026-09-10/admin-coverage-report.md),
and [qualified-outcome diagnostic](user-recommendations-outcomes.sql).

### Exhaustive local coverage and media follow-up

The follow-up audit checked every starter and interest pool across all
**225 website locales × 2,317 audio slugs = 521,325 exact contexts**. The
repeatable-read local catalog snapshot was taken at 2026-09-10 02:40:01 UTC.
47,901 contexts supply six distinct starters; 47,732 meet the thirty-candidate
reserve; 5,723 meet forty-four. No interest pool adds distinct inventory beyond
the starter union. Eighteen representative contexts match the actual Admin
audit service, including small inventories and Chinese locale keys.

The full cross-product is an API envelope, not the default Web pairing. Using
Web's actual locale resolver, 2,081 of 2,317 public homepage audio routes have
six eligible curated starters, 2,073 have thirty, and 185 have forty-four. The
236 routes below six include 200 whose resolved display locale has no matching
published video text. This is candidate coverage; only three local contexts
are activated.

Only twenty-one website locale keys match published display metadata. Another
202 have no matching translated rows; `zh-Hans`/`zh-Hant` mismatch the stored
lowercase keys. Translation coverage is tracked by the concurrent feat-475 work;
an English display fallback is not an approved substitute. Even with English
display text, thirty-five audio languages have fewer than six eligible Admin
video IDs in the entire catalog before canonical deduplication.

All 233 editorial Core references, including alternate cuts, also passed live
English HLS manifest GET and image HEAD checks: 466 links total. This verifies
link health, not all-dub playback or spoken-language correctness. All eleven
flagged choices received individual metadata reviews; existing exclusions stay
in place and add no active inventory. Production database credentials were not
available for a fresh publication/restriction query in this pass.

Evidence: [full coverage report](../recommendations/curation/2026-09-10/all-context-coverage-report.md),
[media checks](../recommendations/curation/2026-09-10/media-validation.md), and
[editorial reviews](../recommendations/curation/2026-09-10/editorial-review.md).

## Authored block refinement

The user requested a registered frontend block and the name **Homepage
Recommendations Block**. The initial category appendix was removed. Admin now
validates `homepageRecommendations` as a top-level singleton and exposes
`HomepageRecommendationsBlock`. The editor library has its own entry, heading
control, preview and normal reorder/remove actions; MCP accepts the same block
through existing Experience mutations. The shared live and draft fragments feed
Web's normal section dispatcher. The visible default is **Recommended for You**.

The local homepage stores this block immediately after its category rail. The
homepage starter follows the same order; Web no longer inserts it implicitly.
Deploy Admin's additive block schema before the new Web fragment, and activate
stored block data only after all Admin instances understand it. No automatic
production content backfill was added.

Block checks cover schema strictness and nesting, singleton enforcement, editor
starters, GraphQL mappings, draft/live fragments, renderer dispatch, context,
flags, and authored order/removal. Updated browser and page-load evidence is in
`/home/nisal/.cache/forge-477-preview/`. Earlier `/tmp/forge-477*` artifacts now
link there because the remote machine's temporary-file quota was exhausted.

Final block checks passed: **231 Admin tests** and **510 Web/i18n tests** (the
latter includes all 225 message catalogs), Admin/Web TypeScript and changed-code
ESLint. Desktop and mobile browser flows both confirmed six distinct cards, the
new visible heading, placement below the category rail, stable focus, whole-video
navigation, and fresh recommendations after returning home. No page errors were
recorded. These checks supersede the original category-appendix placement test.

A repeat of the same three-warm-navigation development check after block
registration measured median TTFB 326.5 ms, DOMContentLoaded
510.9 ms, LCP 2912 ms and CLS
0.0121. Script transfer was 2,197,499 bytes,
663 bytes above the previous enabled widget. The block keeps the same deferred
private request and card geometry. These small development samples remain a
smoke comparison, not a production performance guarantee.

## Merge validation against current main

PR #2249 merges the implementation with both new release flags defaulting off.
No production pool promotion or homepage publication is included. After merging
main `ab801776`, Admin and Web production builds passed, including the Admin
workflow-registration checks. Admin/Web lint and TypeScript plus the regenerated
shared GraphQL client passed. The existing seeded request default is preserved.

The recommendation suite and focused database-fixture reruns passed 503 tests;
local Redis integration added two Admin and three Web passing tests. The latest
block run passed 231 Admin tests; 206 focused Web tests covered the new row,
old-schema retries, layout analytics and playback event preservation. The first
CI run exposed the missing registration of three intentional public-shaped,
service-authenticated resolvers; the central manifest now records their identity
boundary. CI must be green on the final PR revision before merge.

Production-mode local browser checks used isolated PostgreSQL and Redis. Desktop
and mobile both passed six-card distinctness, authored placement/heading, stable
focus, full-video navigation and refetch on return, with no page errors. Three
warm page-load samples measured median TTFB 28.4 ms, DOMContentLoaded 74.6 ms,
LCP 1,760 ms, CLS 0.0291 and 1,008,769 encoded script bytes. These local smoke
samples are not a production benchmark. One request immediately after starting
the server exceeded the delivery deadline; subsequent cold-start requests served
six cards. Recheck cold-process latency before production activation.

The live and preview Experience loaders now recognize an unknown
`HomepageRecommendationsBlock` and retry the existing legacy projection. This
protects independent Web/Admin deployment order even while the row flag is off.
It supersedes the earlier requirement to deploy Admin before Web code; publishing
the new block still requires every Admin instance to understand its discriminator.
