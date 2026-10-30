# PR #2783 review round 2 validation

Base: exact `3fa4106df2f0fa1e0724a81df799315401535aad`. Performance parent: exact main `02ecc6be8d34af143e5975156b78d2e46a9e3406`. The repair is a fast-forward continuation of the editor branch; feat-744 remains in progress pending review clearance.

## Repairs and failing controls

`WatchNextSteps.tsx` adds `grid-cols-1` at the questionnaire grid. Tailwind emits a zero-minimum `minmax(0, 1fr)` track. Existing `min-w-0` on the container alone did not change the implicit column's automatic minimum. No overflow mask was added.

Native Chromium measurements against the exact before production build and repaired production build:

| Viewport | Shape |  Panel | Before Grow width | Repaired Grow width | Forward controls before → after |
| -------- | ----- | -----: | ----------------: | ------------------: | ------------------------------- |
| 1280px   | lean  | 1088px |            4104px |              1088px | disabled → enabled              |
| 1280px   | full  | 1088px |           10534px |              1088px | disabled → enabled              |
| 390px    | lean  |  350px |            3580px |               350px | disabled → enabled              |
| 390px    | full  |  350px |            9262px |               350px | disabled → enabled              |

All four initial geometry cases failed before the production-code fix. The final six browser cases pass: actual grid/content bounds and no document horizontal overflow; lean plans; all nine lessons; solo/joining/leading course modes; full-plan grid; daily-prayer rail; desktop arrows; phone touch swipes; real Tab/Shift+Tab traversal through the last card; long Arabic/RTL heading stress; lesson-sheet containment; and no incidental progress writes. The Arabic stress changes only a local DOM heading; existing rendered locale tests exercise real producer-resolved language/direction and authored-copy preservation.

Two additional initial-video cases inspect sources of scripts the browser actually requested. Finder/course/story/Partner/Share implementation markers must be absent, with no audience/finder/progress requests. Opening the actual full course is the positive control for the deferred-course marker.

The first green harness needed hidden-control locators and real keyboard resets for Embla. The expanded harness initially confused the lean plan carousel with the full plan grid. Those test errors are retained in the evidence directory; they were corrected without relaxing geometry, focus, timeout or navigation assertions.

Both home and video publication assertions now use retrying `toHaveText` with the exact published role labels in order. The final repetition ran **120/120 passing cases**, with zero retries: 12 complete five-case cycles at each of 1280px and 390px, in 10.7 minutes. A disposable identity completed the real local hosted Auth credential → PKCE callback flow. Its real Web session was supplied privately to the child process; all 24 signed-in Partner cases verified that session and the actual protected panel. No Auth or publication route was intercepted. Exact questions/ranking, anonymous Partner locking, unpublished-draft sentinel exclusion from the projection and serialized home/video HTML, category prefetch gating, navigation and deferred Share loading remain asserted.

```bash
pnpm --filter @forge/web exec playwright test -c <local-production-config> \
  watch-audience-config.spec.ts --timeout 45000 --repeat-each 12
pnpm --filter @forge/web exec playwright test -c <local-geometry-config> \
  watch-grow-layout.spec.ts --timeout 30000
```

## Performance method

Production `next build` / `next start` for exact main, exact before and repaired source, with the same Node/dependency versions, disposable real producer, enabled local audience test process, viewport, route and server environment. The repaired source differs from before by the one grid class. Servers are warm; every entry has a fresh anonymous Chromium context and CDP-disabled browser cache. A common-origin transparent proxy streams response bytes unchanged; it does not buffer or rewrite HTML. Observer instrumentation runs through `addInitScript` and uses the same shell predicate for every build.

All six permutations of base/before/repaired order are rotated. Two warmups per build are retained separately, followed by the predeclared measured samples. No measured outlier is discarded. The observation window is 3.5 seconds from navigation; retain every LCP candidate, its element/size/render/load time and resource identity, resource timing/status/failure, CLS, long tasks, CDP script/task/layout durations, request/chunk/prefetch/write sets and host load. Report the final IMG candidate separately from the final-window LCP so a late media candidate cannot be mistaken for an initially blank page.

The external-media cell leaves Mux untouched. The separately labeled deterministic control serves one fixed real 1280px Mux poster from a local fixture with a 50ms response delay and timing headers; playback destinations consistently return 403. Auth, publication, recommendation and application routes remain real. This isolates variable media retrieval/playback without changing application code or external configuration. Local media control establishes a code comparison, not a claim about field playback.

The repository runner uses Chromium 149.0.7827.55 at DPR 1; the native browser uses Chrome 154.0.8037.92 at DPR 2. The additional native-binary comparison uses the latter binary and pixel ratio in its own headless process. Absolute timings are compared only within each matched browser/method cell. The earlier R1 buffered/injected proxy and the transparent streaming proxy are different measurement paths; their absolute timings are not interchangeable.

The first local-media diagnostic used Playwright routing, which pauses application requests while matching registered routes. The refined control uses CDP Fetch patterns limited to Mux/media hosts, leaving application HTML and scripts unpaused. Both diagnostic corpora are retained. The first phone-video diagnostic shell ratio was 40.10/36.45ms (+10.014%), so it is investigated with that narrower control instead of rounding it into a pass. The supplemental phone-home runner was interrupted before its final receipt and overlapped the start of broad validation; its raw rows remain diagnostic and do not establish clearance.

Completed Chromium 149 desktop-video diagnostics, 24 measured runs per build:

| Method                           | Main shell | Before shell | Repaired shell | Main IMG LCP | Before IMG LCP | Repaired IMG LCP |
| -------------------------------- | ---------: | -----------: | -------------: | -----------: | -------------: | ---------------: |
| Fixed media / Playwright routing |    40.00ms |      39.25ms |        39.55ms |        134ms |          136ms |            140ms |
| External Mux untouched           |    32.15ms |      32.55ms |        33.40ms |        200ms |          206ms |            212ms |

The external run retained a 424ms main sample (poster resource 24→377.3ms, image load 377.5ms) and a 416ms repaired sample (resource 26.7→139.4ms, image load 355.9ms). Both have no recorded long task; script duration is 142.5/151.9ms respectively. The repaired tail includes delay after resource availability and is not attributed solely to network transfer. Exact historical review samples lack comparable retained traces, so these new runs do not establish their precise mechanism. They do show slow tails on both code paths, alongside controlled distributions meeting the budget. No measured tail was discarded.

Native-binary **Chrome 154.0.8037.92, DPR 2**, 24 measured samples per build per method (plus two retained warmups each). Distribution entries are **p10 / median / p90 [min–max]**, in milliseconds:

| Media method                  | Build  | Shell distribution                | IMG LCP distribution          |
| ----------------------------- | ------ | --------------------------------- | ----------------------------- |
| Fixed local media, narrow CDP | base   | 28.12 / 30.4 / 45.14 [27.1–59.5]  | 108 / 116 / 142.8 [96–412]    |
| Fixed local media, narrow CDP | before | 29.06 / 31.45 / 41.48 [28.1–54.5] | 109.2 / 116 / 309.2 [100–380] |
| Fixed local media, narrow CDP | after  | 29.8 / 33.15 / 45.17 [25.8–51.9]  | 108 / 116 / 310.8 [104–404]   |
| External Mux untouched        | base   | 27.4 / 30.6 / 50.77 [25.2–58.7]   | 158.4 / 184 / 238 [156–300]   |
| External Mux untouched        | before | 28.43 / 31.9 / 48 [26.8–56.4]     | 165.6 / 192 / 220 [160–400]   |
| External Mux untouched        | after  | 27.63 / 31.95 / 41.1 [26.7–44.4]  | 161.2 / 186 / 222.4 [156–348] |

Repaired versus main: fixed-media shell **+9.05%**, IMG LCP **0%**; external-media shell **+4.41%**, IMG LCP **+1.09%**. The repaired build also meets both median limits relative to the pinned before build. Added desktop-video CLS is 0.00547045, below 0.05. No threshold is waived.

The native fixed-media corpus reproduces the fast/slow LCP modes even without an external fetch: main/before/repaired maxima are 412/380/404ms while all medians are 116ms. The editor builds have more upper-tail observations in this sample; that difference is retained rather than hidden by the median. This establishes that external HTTP failures alone do not explain the slow mode. The exact image load/decode/presentation scheduling mechanism is not established by these captures, and the measured budget is a median budget, not a claim of identical tails or field performance.

| Native method  | Build  | Script median | Layout median | Total long-task median |
| -------------- | ------ | ------------: | ------------: | ---------------------: |
| Fixed media    | base   |      139.86ms |        5.29ms |                    0ms |
| Fixed media    | before |      144.08ms |        5.37ms |                    0ms |
| Fixed media    | after  |      141.74ms |        5.31ms |                    0ms |
| External media | base   |      140.61ms |        5.36ms |                    0ms |
| External media | before |       145.7ms |        5.54ms |                    0ms |
| External media | after  |      145.06ms |        5.53ms |                    0ms |

The paired captures do not reproduce the reported 18.7→22.7ms shell or 116→380ms median LCP regression. They retain the slow mode, compare exact main/before/repaired builds under one browser/method at a time, and separate that tail from median clearance. No separate performance source change is justified by these results.

Supplemental Chromium 149 distributions, 12 measured runs per build (plus two retained warmups); entries are **p10 / median / p90 [min–max]**, milliseconds. Phone cells use the refined media-only CDP control; desktop home retains the original matched control. Home final LCP is text (`SPAN`), while video is the poster `IMG`.

| Cell                     | Build  | Shell distribution                | Final LCP distribution        |
| ------------------------ | ------ | --------------------------------- | ----------------------------- |
| Desktop home             | base   | 34.43 / 36.6 / 53.27 [32.8–55.7]  | 124 / 152 / 160 [120–168]     |
| Desktop home             | before | 34.09 / 38.6 / 54.89 [33.5–60.2]  | 124.4 / 146 / 412.8 [116–444] |
| Desktop home             | after  | 34.23 / 37 / 57.82 [33.8–61.2]    | 124.4 / 142 / 163.2 [120–444] |
| Phone video / narrow CDP | base   | 31.44 / 35.25 / 40.42 [31.1–54.1] | 100 / 104 / 115.6 [96–116]    |
| Phone video / narrow CDP | before | 30.89 / 34.4 / 41.09 [30.7–41.4]  | 100 / 110 / 119.6 [96–124]    |
| Phone video / narrow CDP | after  | 31.12 / 33.75 / 42.99 [30.2–57.6] | 100 / 106 / 122.4 [96–128]    |
| Phone home / narrow CDP  | base   | 29.79 / 34.2 / 40.73 [28.6–51.3]  | 80.8 / 100 / 118.8 [72–136]   |
| Phone home / narrow CDP  | before | 31.92 / 34.35 / 48.49 [31.7–63.5] | 80 / 84 / 344.4 [76–404]      |
| Phone home / narrow CDP  | after  | 32.31 / 34.05 / 38.58 [31.7–58.2] | 80.4 / 88 / 347.2 [76–400]    |

The corrected phone-video shell ratio is −4.26% versus main; final LCP is +1.92%. Corrected phone-home is −0.44% / −12.00%, respectively, with zero added CLS. Both also meet the timing/CLS limits versus the pinned before build. The strict budget receipt checks all seven accepted cells, sample counts and native browser/DPR identities against both exact parents. All pass; the interrupted phone-home and borderline global-route phone-video cells remain labeled diagnostics, not clearance evidence.

Every accepted initial-entry capture has zero finder/course/story/Partner/Share implementation chunk hits and zero audience/finder/progress API requests or writes. Existing recommendation requests/writes remain present. Video requests 38→40 script resources on desktop (39→41 on phone), before and repaired equal; home 30→31. Video retains the same single home-route prefetch; home retains the same trailer prefetch, with no eager category-link fan-out. Anonymous video HTML is 138,048→159,755 bytes versus main, unchanged by this round. All current external desktop poster responses are 200; deterministic phone/home playback 403s are deliberate fixtures and are counted separately. Native fixed-media script/layout medians and the request/chunk audit give no evidence of a new hydration or initialization bottleneck from the grid repair. Navigation, deferred course loading and no progress writes are independently checked in the browser regressions.

## Validation

Completed: strict five-package lint with zero warnings and typechecks; separate E2E lint/types; schema print + gql.tada generate with zero drift; 871 Admin cases across 35 files, 660 Auth cases (106 environment skips), 70 experience-schema cases, two admin-graphql cases, 23 feature-flag cases and two packaging-closure checks. All 162 migrations and 22 publication/import/finder/progress cases pass in a fresh loopback-only PostgreSQL 18 database. Admin production build passes; before/candidate/exact-main Web production builds pass.

The first full Web run inherited the preview secret and canonical-origin values from the coordinator: 21 expected-secret/origin assertions failed in revalidation/login tests (6,977 other cases passed). The complete suite is rerun with those preview variables removed so `vitest.setup.ts` provides the intended test defaults; application code is not changed for that environment error.

The clean-environment full Web run passes **6,998 tests**, with 13 skips and one todo. The final six geometry/deferred-resource browser cases also pass again. The exact Admin test selection is recorded below; the normal full Web/Auth/experience-schema/admin-graphql test scripts use `--maxWorkers=1 --no-file-parallelism`. Production Web build receipts cover before, repaired source and exact main; the repaired-source build precedes only E2E/documentation edits.

Final checks: all six edited/new files formatted; explicit edited-Markdown Prettier check, whole-repository `pnpm format:check` and `git diff --check` pass. The final six-file audit preserves round-1 packaging/filters, destination guard, localization, compact home/tabs/Auth and prefetch behavior; Admin/Auth/schema/migrations/shared flags have no delta from the pinned head. See `final-results.json` for command and exit-code receipts.

## Scope, evidence and limits

Evidence directory: `/home/lado/.local/share/forge-pr2783-r2-20261024/`. It retains production build logs; original geometry red logs and harness failures; native geometry JSON; the genuine-Auth receipt without credentials; all 120 repetition results; comparison and deterministic-media harnesses; raw timing/request/candidate distributions, summaries and critical-document/chunk audits; and broad validation command/exit-code receipts. Raw credentials, cookies and recommendation capabilities are not retained. The private Auth development log is removed during cleanup.

Node 24.19.0 is available locally, while the repository pins 24.22.1. Measurements are unthrottled local-host Chromium comparisons, not field/mobile-hardware, production-network or playback clearance. All build/cell conditions and any media failures are recorded with the results. No threshold is waived.

No Admin/Auth source, migrations, concurrency implementation, shared flag definition, generated GraphQL SDL/introspection, Docker packaging or workflow filter changes occur in this round. Round-1 destination validation, resolved locale/direction, compact home/external tabs, genuine Partner flow and deferred category prefetch are preserved. The shared `forge.watch.audience` default remains false. No external configuration/flag change, importer CLI, live content publication, merge, deployment or production mutation was performed.

Exactly these six repair files differ from the pinned head:

- `apps/web/src/components/watch/WatchNextSteps.tsx`
- `apps/web/e2e/watch-audience-config.spec.ts`
- `apps/web/e2e/watch-grow-layout.spec.ts`
- `docs/plans/2026-10-24-pr2783-review-round-2-repairs.md`
- `docs/reports/2026-10-24-pr2783-review-r2-validation.md`
- `docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md`

## Exact Admin and DB selections

```bash
pnpm --filter @forge/admin run test \
  src/graphql/schema.test.ts \
  src/lib/feature-flags.test.ts \
  src/domain/blocks.test.ts \
  src/domain/watch-audience.test.ts \
  src/scripts/import-watch-audience-config.test.ts \
  src/scripts/probe-experience-editor-video-data.test.ts \
  src/graphql/types/blocks.test.ts \
  src/graphql/types/watch-setting.test.ts \
  src/graphql/types/watch-learning-progress.test.ts \
  src/graphql/types/watch-audience.test.ts \
  src/graphql/types/watch-film-finder.test.ts \
  src/app/dashboard/experiences/experience-editor/anchor-video-picker.test.tsx \
  src/app/dashboard/experiences/experience-editor/experience-chat-errors.test.ts \
  src/app/dashboard/experiences/experience-editor/watch-audience-editor.test.tsx \
  src/app/dashboard/experiences/experience-editor/block-helpers.test.ts \
  src/app/dashboard/experiences/experience-editor/experience-chat-suggested-prompts.test.ts \
  src/app/dashboard/experiences/experience-editor/watch-audience-availability.test.ts \
  src/app/dashboard/experiences/experience-editor/watch-home-category-rail-editor.test.tsx \
  src/app/dashboard/experiences/experience-editor/image-picker-folder-browser.test.tsx \
  src/app/dashboard/experiences/experience-editor/watch-home-category-rail-tiles.test.ts \
  src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.test.ts \
  src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx \
  src/app/dashboard/experiences/experience-editor/chat-rating.test.tsx \
  src/app/dashboard/experiences/experience-editor/bible-quote-card.test.tsx \
  src/app/dashboard/experiences/experience-editor/image-picker-browser.test.tsx \
  src/app/dashboard/experiences/experience-editor.test.tsx \
  src/services/watch-setting-audience.test.ts \
  src/services/watch-audience-projection.test.ts \
  src/services/watch-learning-progress.service.test.ts \
  src/services/experience.service.test.ts \
  src/services/watch-film-finder.service.test.ts \
  src/services/experience-editor-video.service.test.ts \
  src/services/experience-preview.service.test.ts \
  src/services/watch-setting.service.test.ts \
  src/services/watch-audience-write-gate.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

```bash
WATCH_AUDIENCE_DB_TEST=1 WATCH_AUDIENCE_IMPORT_DB_TEST=1 \
WATCH_FILM_FINDER_DB_TEST=1 WATCH_LEARNING_PROGRESS_DB_TEST=1 \
pnpm --filter @forge/admin run test \
  src/services/watch-audience-publication.db.test.ts \
  src/scripts/import-watch-audience-config.db.test.ts \
  src/services/watch-film-finder.service.db.test.ts \
  src/services/watch-learning-progress.service.db.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

The DB command uses only the fresh loopback `forge_watch_audience_test_pr2783_r2` database. Fixtures created/published by integration tests are disposable local test records. The importer CLI and any live publication endpoint are never invoked.
