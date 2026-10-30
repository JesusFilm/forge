# PR #2783 round 8: optional failures and visible return loading

Exact implementation parent/lease: `5a75766786a8a786b8f1f0b4c557b046773e72de`. Exact return-performance baseline: `02ecc6be8d34af143e5975156b78d2e46a9e3406`. Scope: [round-8 plan](../plans/2026-10-25-pr2783-review-round-8-optional-loading.md). Implementation validation is complete; feat-744 returns to complete after the checks below. No deployment, external configuration, live publication/import, telemetry or production mutation is authorized.

## Diagnosis and repair

Suspense handles a pending import; it does not contain the rejection thrown when React.lazy renders a failed import. The optional prayer shelf previously had no local error boundary, allowing its rejected chunk to replace an already usable lesson/hero with the route error screen. A small boundary now contains prayer import/render failures in that shelf. Its English/LTR status truthfully says the guide is unavailable and the lessons/plans remain usable. Prayer is English today; authored questions and selected Scripture retain their independent language boundaries.

The boundary resets when the current film, selected language, published configuration or passage content changes. Only the optional boundary resets; course/progress state does not. React.lazy caches the rejected prayer import, so there is no misleading retry button or automatic retry loop. A fresh document can fetch it again. Render failures recover on a new content scope; repeated rejected-import resets remain contained.

The coalesced return loader deliberately waits for the parallel persona/course imports, but its host returned null during that wait. The host now immediately renders an explicit English/LTR status, “Loading the nine lessons…”. Completion still commits the real Grow component in the same import-completion turn; no new timeout, Suspense reveal, serial import or curriculum dependency is introduced. Cached warm mounts render the ready component immediately without an intervening status. The import/coalescing/preload implementation and its default-entry guards are unchanged.

The existing course retry is preserved. Inspection and a real exact-parent browser probe show that this Next/Turbopack runtime performs one bounded network retry and evicts the failed low-level chunk record; the plain course import can recover through its existing “Try again” button. This differs from React.lazy’s cached prayer rejection and from older documented runtime behavior. An exploratory course-reload change was removed after that evidence; no course recovery behavior ships in this repair.

## Validation

Commands use Node 24.22.1, pnpm 9.12.3, CI fixtures and browser/server telemetry fences. Exact command/result JSON receipts accompany the logs.

- Five final cold focused Web runs pass **191 each / 955 executions**. These cover pending and resolved loader output, cached warm output, shared import coalescing, prayer success/delay/rejection/render failure and content-scope resets, real Grow/course/Scripture behavior, role tabs/menu and route admission. The original rendered tests fail without the repair. No arbitrary assertion waits are added.
- Exact CI commands, `pnpm --filter @forge/web run --if-present test` and the equivalent `@forge/admin` command: **7,068 Web passes / 13 gated skips / one todo** and **9,874 Admin passes / 1,013 gated skips / one todo**.
- Strict Web/Admin lint (`--max-warnings=0`), Web/Admin types, separate E2E types, production candidate/parent Web builds and production Admin build pass. Feature flags **23**, experience-schema **70**, admin-graphql **2** pass. Admin schema print, admin-graphql generation and generated UI-locale checks have **zero drift**.
- All **168 migrations** apply to the fresh disposable `forge_watch_audience_test_pr2783_r8_repair` database; all **22** audience publication/importer/Finder/learning-progress DB cases pass. Exact files: `src/services/watch-audience-publication.db.test.ts`, `src/scripts/import-watch-audience-config.db.test.ts`, `src/services/watch-film-finder.service.db.test.ts`, `src/services/watch-learning-progress.service.db.test.ts`, run using `pnpm --filter @forge/admin test -- <files> --no-file-parallelism` with their local DB gates. Docker workspace/shared-image packaging guards **2/2** pass.
- Real production `watch-grow-loading.spec.ts`: **8/8**, English phone and Arabic desktop. Course feedback remains visible through **8,002–8,004ms** of actual chunk delay, then disappears on success or gives the retained honest course error/PDF/retry state. Restoring the network and using the existing course retry restores the requested lesson. Delayed prayer does not block course controls; rejected prayer stays local, preserves hero/course/focus, supports closing the lesson and recovers after a fresh document. Explicit English/LTR status boundaries, real screenshots and no uncaught page errors are asserted. Render-error/content-scope recovery and cached rejection are covered deterministically in rendered unit tests.
- The complete painted-focus matrix passes **24/24**: English/Arabic × phone/desktop × light/dark. **72 indicators** gain **176–6,462 exact blue pixels**, plus eight unselected-tab comparisons; geometry stays unchanged. R6 native radios/resource tabs/Admin audience tabs pass **13/13** with real visible-focus checks.
- Retained localization, geometry/resource and RoleChip suites pass **28/28** in the final combined cohort. One earlier desktop full-course run failed a programmatic plan-link viewport assertion (27/28). Ten exact-parent and ten candidate diagnostic repetitions all pass unchanged, followed by the complete fresh 28/28. This does not establish the isolated failure’s cause or attribute it to this repair; the failed receipt and comparison cohorts remain available, and no geometry product/test assertion is changed.
- Publication suite **50/50**, ten cycles with ten genuine signed-in Partner cases using real local hosted Auth/PKCE and a verified Web session cookie. Exact published role/question/order/ranking, draft leakage, public projection/cache isolation and ordinary-entry deferral/write contracts remain asserted.

## Controlled performance and resource evidence

The final corpus contains **768 measured navigations plus 192 warmups**, without sample exclusions: exact-main/candidate return, candidate A/A, exact-main/candidate HTML/static replay, parent/candidate ordinary home/video, and parent/candidate no-scroll return layout. Every cell has **32 measured loads/build plus eight warmups/build**, seeded balanced ABBA/BAAB order, serial navigations, fresh contexts, disabled browser cache, warm server/disk, Chrome 154.0.8037.92, DPR 2, CPU rate 1 and CPU affinity 20–27. Main is exact `02ecc6be8d34af143e5975156b78d2e46a9e3406`; parent is exact `5a75766786a8a786b8f1f0b4c557b046773e72de`. Candidate production sources are pinned by 25 SHA-256 hashes. No heavy builds/tests or overlapping browser suites ran during sampling.

Return timing uses symmetric immediate label centering from the DOM observer and actual Element Timing on “Choose a lesson”/“On my own”, not a synthetic frame estimate. Every return row requires decoded valid local HLS (readyState ≥ 2), local poster/legacy cover/illustration and loaded fonts. The supported direct URL is `?as=grow&growLesson=lesson-1`. Main desktop samples include its inherited idle player startup. Replay uses captured public HTML/static assets on the same origin with fixed 10ms response delay; real local API endpoints remain in place. All six return/A/A/replay median mount/paint cells meet the 10% budget.

Values below are median (p10–p90), milliseconds, before → after.

| Return comparison                     | n/build | Control mount                                  | Actual label paint                | Median Δ mount / paint |
| ------------------------------------- | ------: | ---------------------------------------------- | --------------------------------- | ---------------------- |
| Exact main → candidate, 390px         |      32 | 393.1 (389.61–518.5) → 406.75 (398.52–416.34)  | 448 (440–566.8) → 456 (444.4–464) | +3.47% / +1.79%        |
| Exact main → candidate, 1280px        |      32 | 417.9 (402.93–552.33) → 427.95 (411.57–479.26) | 532 (500–651.6) → 528 (516–589.6) | +2.40% / -0.75%        |
| Candidate A/A, 390px                  |      32 | 406.5 (398.33–416.17) → 405.9 (399.69–423.89)  | 456 (444.4–468) → 454 (448–471.6) | -0.15% / -0.44%        |
| Candidate A/A, 1280px                 |      32 | 421.4 (409.13–454.98) → 425.2 (412.55–455.33)  | 524 (516–552) → 528 (516–555.6)   | +0.90% / +0.76%        |
| Exact main → candidate replay, 390px  |      32 | 658.05 (656.41–663.58) → 392.2 (388.43–400.37) | 708 (704–732) → 440 (436–455.6)   | -40.40% / -37.85%      |
| Exact main → candidate replay, 1280px |      32 | 685.8 (672.13–702.04) → 415.85 (405.17–433.26) | 838 (804.4–872) → 516 (504–532)   | -39.36% / -38.42%      |

| Real-server return viewport / metric | p95 before → after | Maximum before → after | Block-bootstrap 95% interval for median Δ% |
| ------------------------------------ | ------------------ | ---------------------- | ------------------------------------------ |
| 390px / mount                        | 592.075 → 417.135  | 672.3 → 420.9          | [2.813, 4.477]                             |
| 390px / textPaint                    | 661.8 → 465.8      | 720 → 476              | [-1.299, 2.679]                            |
| 1280px / mount                       | 690.66 → 543.55    | 730.1 → 565.5          | [-0.308, 5.681]                            |
| 1280px / textPaint                   | 806.2 → 652        | 852 → 688              | [-4.693, 3.053]                            |

The distributions retain every value plus min/p10/p25/median/p75/p90/p95/max, and paired two-round 5,000-resample block-bootstrap intervals. Passing medians do not establish identical tails or field performance. The controlled measurements preserve the prior return-performance repair while covering the new pending feedback and optional error boundary.

Ordinary-entry incremental comparisons, exact parent → candidate, each 32/build:

| Page / viewport | Shell median (p10–p90)                    | First LCP median (p10–p90)        | Final observed LCP median (p10–p90) | Added median CLS |
| --------------- | ----------------------------------------- | --------------------------------- | ----------------------------------- | ---------------: |
| home, 390px     | 48.25 (43.93–72.46) → 46.55 (41.27–63.42) | 168 (108–438) → 160 (104–171.6)   | 560 (472.4–686) → 564 (461.6–584)   |                0 |
| home, 1280px    | 46.8 (43.48–57.41) → 47.65 (43.74–54.39)  | 194 (164.4–211.6) → 192 (156–208) | 672 (628–747.6) → 674 (628.4–756)   |                0 |
| video, 390px    | 41.85 (40.72–54.5) → 41.6 (40.51–50.25)   | 138 (132–144) → 136 (92.4–144)    | 140 (132–144) → 138 (128–151.6)     |                0 |
| video, 1280px   | 42.2 (40.62–54.07) → 41.5 (40.51–58.1)    | 148 (128.4–156) → 148 (124–156)   | 148 (140–164) → 152 (144–175.6)     |                0 |

All ordinary cells meet the 10% median shell/actual-LCP and 0.05 added-CLS budgets. IMG-only LCP is checked where every row has an image candidate; sparse home IMG counts are explicitly recorded in `validated-performance-not-applicable.json`, while actual first/final LCP remains mandatory. Ordinary entry observes the first 3.5 seconds; it does not claim to measure desktop video's later idle media startup.

| Initial page / viewport | Requests | Script requests | Encoded JS bytes (including link preloads) | Encoded CSS bytes |
| ----------------------- | -------- | --------------- | ------------------------------------------ | ----------------- |
| home, 390px             | 59 → 59  | 31 → 31         | 851414 → 859019                            | 49758 → 49758     |
| home, 1280px            | 59 → 59  | 31 → 31         | 851414 → 859019                            | 49758 → 49758     |
| video, 390px            | 62 → 62  | 41 → 41         | 941457 → 949163                            | 49758 → 49758     |
| video, 1280px           | 57 → 57  | 40 → 40         | 941263 → 948969                            | 49758 → 49758     |

Request/script counts and prefetch destinations remain guarded. Grow/course/prayer/Story/Finder/Partner/Share implementation chunks remain absent from ordinary entries. Returns keep unrelated Story/Finder/Partner/Share implementations absent. The emitted encoded-JS increase is **7,605 bytes on home and 7,706 bytes on video**, with zero CSS increase. Source-map inspection locates 7,603 bytes in an existing shared crypto/polyfill chunk (Next compiled Buffer/events/string-decoder versus additional standalone buffer/base64/ieee754/events/safe-buffer/string_decoder modules), plus two bytes of references in the home shell chunk. There is no dependency, lockfile or configuration edit; the cause of that packing difference is not established by this comparison. The changed NextSteps/loader host chunk grows 187 raw bytes (103 encoded bytes on its existing video-page link preload), and the intent-loaded Grow chunk grows 408 raw bytes. The host was already preloaded on video; the heavy Grow/course/prayer implementation chunks remain absent from ordinary entry. Thus the measured shared-byte delta is retained rather than attributed entirely to the new status text or called zero-cost. `shared-chunk-module-inventory.json` records the source-map/module evidence. The prayer error boundary stays in the intent-loaded Grow implementation. No stylesheet changes, new package, additional fetch, eager implementation, prefetch destination, audience/Finder/learning request, initial progress/role write or relevant storage write is introduced. The inherited viewing-resume GET remains exactly one per video row and zero per home row, matched between builds. Read-only local recommendation/profile-status POSTs remain allowed and recorded separately from blocked telemetry; matched anonymous proxy origin refusals are retained and are not authenticated API-latency measurements.

The separate no-scroll control measures actual initial return layout against the exact parent, without the label-centering probe. It isolates the pending status's application layout from intentional viewport motion and the legacy dialog/inline presentation difference:

| Viewport | Parent → candidate CLS median (p10–p90)   | Added median CLS | Bootstrap 95% added-CLS interval |
| -------- | ----------------------------------------- | ---------------: | -------------------------------- |
| 390px    | 0 (0–0) → 0 (0–0)                         |                0 | [0.0, 0.0]                       |
| 1280px   | 0.005 (0.005–0.005) → 0.005 (0.005–0.005) |                0 | [0.0, 0.0]                       |

Both no-scroll cells meet the 0.05 added-CLS budget. CLS table values are rounded to 0.001; exact values remain in the raw rows. The immediate-scroll paint probe's larger inline shift totals remain available and are not presented as initial-load CLS equivalence with main's modal. Every final no-scroll row requires valid decoded media and zero static/image failures. Retained full-course geometry, focus and navigation tests cover the eventual loaded controls.

Browser/server telemetry fences remain active for measured rows and warmups: external HTTP/WebSockets, Mux Data, first-party playback/Watch event actions and server external TCP/UDP/local-agent telemetry are blocked. Mux media is fulfilled locally with real decoding; no external corpus runs. The initial byte convenience metric counted only script-initiated resources, omitting existing link-preloaded JavaScript. The final table includes both; the former metric remains separately available as `scriptInitiatedEncodedBytes`. The accounting correction changes no raw row, timing, request count or budget. The raw audits retain blocked requests, media fulfillment, request/resource timings, read refusals, storage and shift sources; external peers remain zero. The complete 960-navigation census, including all 192 warmups, confirms zero external peers and zero unfenced external POSTs (`all-rows-network-audit.json`). The first-party content-read POSTs above do not publish, import or change content.

Evidence: `r8-r8-performance-method.json`, `validated-performance-{summary,comparisons,audit,raw-inventory}.json`, `validated-deferred-chunk-map.json`, `complete-media-{summary,comparisons,audit,raw-inventory}.json` and `layout-clearance.json`. All source/measurement scripts and original failed diagnostic receipts remain alongside the raw samples; previous R4/R7 corpora are hash-verified unchanged. No performance threshold is waived.

## Exact changed files

- `apps/web/e2e/watch-grow-loading.spec.ts`
- `apps/web/src/components/watch/WatchGrow.tsx`
- `apps/web/src/components/watch/WatchGrowLoader.tsx`
- `apps/web/src/components/watch/WatchNextSteps.tsx`
- `apps/web/src/components/watch/watch-grow-loader.test.ts`
- `apps/web/src/components/watch/watch-grow-prayer-loading.test.tsx`
- `docs/plans/2026-10-25-pr2783-review-round-8-optional-loading.md`
- `docs/reports/2026-10-25-pr2783-round-8-optional-loading-validation.md`
- `docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md`

## Retained diagnostics and limits

Initial browser probes used a dynamically assembled radio test ID as a literal chunk marker, so they failed before interception. They also assumed one physical request, overlooking the emitted runtime’s bounded retry. The corrected test identifies the unique static course-sheet marker and pins actual request counts: one successful course download, four rejected course requests across preload/mounted loading, and two rejected optional-prayer requests. Its intentional eight-second delay applies to the first request; subsequent rejected attempts fail immediately. No assertion timeout or retry is increased. Earlier failed receipts remain separate, rather than being presented as passing runs.

One exploratory direct Vitest invocation used the shared temporary directory and failed before collection with ENOSPC. The harness’s dedicated temporary directory resolves that environment condition; it is not a product/test failure. An intermediate lint run saw unformatted edits; final strict lint and repository-wide formatting pass, with exact receipts retained. Browser/server fences block external TCP, UDP telemetry, first-party measurement routes/actions and browser external HTTP/WebSockets; valid local posters/HLS retain actual media decoding. No external corpus runs.

These are local controlled production measurements, not field performance guarantees. Automated accessibility checks cover names, keyboard/focus, actual contrasting pixels, language/direction and rendered geometry; there is no manual screen-reader audit. The Admin browser fixture renders its real production component/CSS/fonts without a full hosted dashboard login. Partner tests use real local hosted Auth/PKCE, not external identity providers. The unchanged Docker image is not rebuilt this round; packaging guards and earlier production-image evidence are retained. Recommendation/HNSW code and test timeouts, auth/erasure, schema/migrations, ownership/CAS/reset/resume lineage, flags and importer safeguards remain untouched.

Durable lessons: give optional lazy content both a pending boundary and a local failure boundary; keep a pending host useful while preserving parallel imports. Validate retry at the actual emitted runtime and React cache layers instead of copying an older bundler assumption. Fault-inject the real production chunk, retain focus and lesson usability after failure, and measure ready control mount and actual text paint separately from initial shell/LCP.

Raw evidence: `/mnt/worktrees/checkouts/t3/Forge/pr2783-r8-repair-evidence-20261025`, also linked at `/home/lado/.local/share/forge-pr2783-r8-repair-20261025`. Prior corpora are unchanged; `retained-performance-corpus-inventory.json` verifies 23 retained R4/R7 raw-file hashes. Final receipts, source pins, screenshots, network fences, distributions and all failed probes remain available there.
