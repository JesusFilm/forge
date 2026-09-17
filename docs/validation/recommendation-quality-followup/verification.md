# Recommendation follow-through validation

Status: implementation, sequential Compound Engineering review and PR CI complete.
PRs #2317/#2318/#2320 are deployed through normal main/Railway flow. Real browser,
profile erasure, exact service revisions and bounded operational windows are
recorded in the [release report](../../operations/recommendation-quality-release-2026-09-16.md).
The matched pre-release build reproduced the late cold-paint behavior, tracked
under feat-515; usefulness needs
independent mode observations and a mature controlled comparison.

## Verified so far

- Serialization/token-boundary unit and production-adapter tests: 80 checks.
- Admin full suite at the initial mode implementation: 7,234 passed, five failed
  under simultaneous full-app load. The three affected unrelated suites passed
  all 131 tests with two workers; no timeout or assertion was relaxed.
- Web full suite at the same checkpoint: 4,388 passed, one translation-catalog
  test timed out. Its isolated suite passed all 458 tests with one worker.
- Recommendation unit/native run: 601 passed and one failed because the shared
  disposable database had not yet applied 0098. After normal migration deploy
  applied 0097 and 0098, the viewer lifecycle suite passed both tests. Two Redis
  tests were skipped in this database run; Redis code is outside this change.
- Mode native tests include accepted preview → profile facet → candidate
  performance, minimum independent-profile evidence, conflicting replay,
  withdrawal, reset and simultaneous deletion/publication. The concurrent test
  retains immutable playback facts while leaving no deleted profile influence.
- Hero/Watch renderer/navigation plus mode collector React tests: 148 passed,
  one existing todo. Recorder lifecycle tests also passed after automatic
  identity initialization was ordered before standalone context creation.
- Production-adapter native fixtures and the public disposable database apply
  the actual migrations. Generated Prisma clients come from `prisma generate`.

These are intermediate counts. Further changes receive targeted validation and
the final release must also pass builds, types, formatting, lint and CI.

## Browser evidence and loading cost

`viewing-mode-browser.json` contains five baseline/current loads per variant and
a real-media journey through the production recorder. The fixture uses a native
video stream, the actual overlap geometry helper, React production build and a
synthetic episode endpoint. It does **not** establish a full Watch/Mux-page or
production result.

- Muted preview recorded 30,668ms without a manual attempt or start.
- Covering the sticky preview stopped mode credit while media continued.
- Watch now switched to sound-on activated evidence (10,217ms observed).
- Preview and activated playback used one claimed episode.
- Compressed fixture bundle: 65,544 → 66,401 bytes (+857 bytes).
- Median DOMContentLoaded: 29.4 → 32.8ms. Maximum observed long task: 0 → 52ms.
  These small fixture samples bound component cost; they are not a field loading
  performance claim. Whole-page verification remains part of release checks.

## Interpretation and rollout

Equal sound-on/off qualification proves implementation parity, not actual
attention. The viewer's distinct-video preference and independent per-video
evidence are bounded proxies. Sound-off recommendation effects will be sparse
until new observations accumulate; historical missing manual-play facts cannot
be backfilled as muted viewing. Causal uplift requires the mature controlled
comparison, including assigned units with no exposure.

Use `RECOMMENDATION_VIEWING_MODE_ENABLED=false` for a narrow rollback through
normal deployment configuration. It leaves player behavior, raw evidence,
profile erasure and ordinary recommendation ranking available. Keep For you
held off. Do not expand Recommendation Visibility or locale/source scope.

## Final local review checkpoint

- Recommendation suite with production PostgreSQL adapter: **617 passed**, two
  Redis-only skips. Subsequent tiny-clip, overlap and Admin-history assertion
  changes have focused rechecks; no assertion or timeout was weakened.
- Full Admin: **7,253 passed**, one stale history-copy assertion failed and was
  updated for reconstructed history; 285 opt-in skips and one existing todo.
- Full Web: **4,397 passed**, one unchanged homepage render-count assertion
  failed; all 70 tests in that file passed in isolation. Ten opt-in skips and one
  existing todo. CI on the final revision remains the merge gate.
- Admin and Web production builds passed with local/CI configuration. both typechecks,
  actual migrations and workflow build registration checks passed. Frozen-lockfile
  installation includes the other task's Expo and Redis patch changes.
- Production baseline full Watch-page samples are in
  `page-performance-before.json`: initial LCP 1,512ms, warm samples 556/672ms;
  muted preview remained playing and Watch now remained available. These are
  synthetic browser observations, not field-percentile claims.
- `quality-readiness-results.json` is a live read-only capture at
  2026-09-16T00:21:39.730Z. It shows a semantic control pointer, zero assignments
  and no shadow decisions/runs. The seeded session A/A does not satisfy the new
  profile-unit protocol. No approval or evaluation pass was fabricated.
- `compound-review.md` records the sequential Compound Engineering review,
  corrected findings, migration/contract checks and remaining empirical gates.

## CI permissions

The configured GitHub OAuth credential lacks the `workflow` scope, so this
release retains the existing CI workflow. New native database suites were run
explicitly against PostgreSQL locally (including retry, mode/privacy, curated
migration and comparison routing). Existing CI still exercises the application
suites, schema drift, migrations and its established database suites. The new
standalone native suite files are not added to the CI database command in this
release; do not count their skipped ordinary-unit invocations as native coverage.

## Merge validation

PR [#2317](https://github.com/JesusFilm/forge/pull/2317) passed all 22 applicable
checks on `0bdd22a214c4f70c2041e4bec2eac7e4fe868610`. Admin passed 7,258 tests and
Web passed 4,398; the earlier local full-suite failures did not recur. Builds,
types, lint, format, schema drift, the existing PostgreSQL/Redis integration
suites and CodeQL passed. Opt-in skipped native tests are documented separately
above and have explicit local PostgreSQL results.

The PR merged at 2026-09-16T01:27:22Z as
`3028f3305c1b01c2e4671ec9686ee51280dd1115`. Normal Railway deployments started
from that main revision. No worktree deployment or For you activation was used.

The post-merge [main CI run](https://github.com/JesusFilm/forge/actions/runs/35044154998)
also passed on the merged revision.

## Production evidence index

- `final-service-revisions.json`: exact successful Web/Admin/worker deployments,
  with the independent Admin fix preserved and feature ancestry verified.
- `preview-production-browser.json`, `preview-profile-evidence.json`: real muted
  preview, covered-player exclusion, Watch now and attributed selected preview.
- `preview-profile-cleanup.json`, `preview-profile-after-cleanup.json`: only the
  synthetic profile was deleted; derived mode influence disappeared and immutable
  facts remained. The public erasure receipt was pending, not claimed completed.
- `curated-production-browser.json`, `slug-production-browser.json`: six-card
  curated recovery and the fixed repeated-hyphen destination with six cards.
- `http-feature-window.json`, `runtime-feature-errors.json`,
  `runtime-feature-retries.json`: the first window's nine upstream 503s and 38
  contention observations are retained; no claim that the whole rollout was clean.
- `http-recovery-window.json`, `db-recovery-window.json`: 02:14–02:24, after the
  independent Admin duration fix; 2,345 HTTP requests, zero 5xx, eight recovered
  rows/48 cards. The cohorts are not a causal comparison.
- `http-final-window.json`, `db-final-window.json`: 02:31–02:36 on the final Web
  revision; 862 API requests, zero 5xx/400, 148 admission 403s, healthy worker and
  no stored finalization errors in that cohort. Five retained rows remained empty.
- `feature-health-final.json`: 92 mode episodes/40 current profiles, no invalid
  identity/conflict/retention rows, no late mode facts, and no candidate meeting
  the 20-independent-profile minimum. Counts include synthetic traffic.
- `page-performance-after.json` and `page-performance-cold-*.json`: preserve warm,
  cold and late-paint observations. They are synthetic measurements, not field
  percentiles or a claim that loading performance improved.

The paired `*-queries.json` files contain read-only aggregate SQL. Each query
uses a separate repeatable-read transaction. Private smoke query parameters,
profile/session/episode/request identifiers, cookies, tokens and credentials are
excluded. Request-ID digests in HTTP artifacts only establish scope/deduplication.

## Matched whole-page load comparison

`page-performance-matched.json` records six successful fresh-browser journeys
against independent pre-release/current production builds, under the same CI
configuration and shared catalog read backend. Both builds reproduced the
approximately ten-second late heading-paint observation. Baseline long tasks
were 111–124ms, current 125–127ms, with no playback/profile dependency regression
observed. The small sample cannot establish field percentiles, occurrence rates
or a causal explanation for the pre-existing late paint; feat-515 retains that
investigation. Local GraphQL endpoint/ISR setup failures were fixed before the
six valid page measurements and are not counted as page-performance samples.
