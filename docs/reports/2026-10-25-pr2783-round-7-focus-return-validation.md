# PR #2783 round 7: painted focus and cold lesson returns

Exact implementation parent and push lease: `8e39c679069938b51b743186d60e7838f059b693`. Exact loading baseline: `02ecc6be8d34af143e5975156b78d2e46a9e3406`. Scope: [repair plan](../plans/2026-10-25-pr2783-review-round-7-focus-return.md). The full repaired scope has passed local validation, including repository-wide formatting; feat-744 returns to complete after these checks. This report does not authorize rollout, deployment, external configuration changes, live content operations or production mutation.

## Diagnosis and changes

The selected role tab's translucent white ring disappears against its white background. On the exact parent, all four English/Arabic, phone/desktop selected-tab screenshot pairs are identical between keyboard focus and blur. Course cards and lesson-close controls suppress the browser outline without supplying a painted replacement: seven of eight pairs are identical; the remaining pair has incidental image/motion differences, with no computed outline or shadow. A matching `:focus-visible` selector therefore does not establish visible focus.

Role tabs now have a 3px `#2563eb` inset outline, offset -4px, and a white inset edge. The blue has 5.17:1 contrast against white. A scoped CSS module supplies the same keyboard indicator across audited deferred Grow controls and the Story portal. The inset geometry survives carousel/rounded overflow boundaries without moving or resizing controls. Native radio labels retain their existing indicator. Pointer-only styling, selected state, roving tab behavior, language boundaries and course geometry stay intact.

Cold `?as=grow&growLesson=lesson-1` returns expose serial persona/course imports and nested production lazy/Suspense reveals. The React production renderer's fallback-reveal throttle can add roughly 300ms after chunks are ready. Profiling also identifies Embla offset measurements forcing the full inline course/prayer shelf layout before return controls paint. A direct import-completion host and parallel, coalesced persona/course loading remove the serial/reveal delay. A tiny, server-admitted client entry starts these imports only for explicit valid lesson-return intent; it mounts nothing and performs no progress/account I/O. Ordinary entry, invalid lessons, other roles and unavailable/rejected/default-off surfaces retain implementation deferral. Course import failure still reaches the existing retry/PDF fallback.

The remaining paint cost comes primarily from the optional prayer shelf. It now has its own lazy/Suspense boundary, so its rich layout does not delay actual returned-course controls. It still occupies the same position in the full shelf when loaded, and the lean shape no longer imports its implementation. The shared carousel and prayer implementation remain byte-identical to the parent; the earlier frame-deferral experiment is not included. The return's introductory opacity transition is skipped so it does not delay control text paint. No curriculum, progress service, ownership/CAS/reset/resume lineage or authentication implementation changes.

## Validation receipts

Commands use Node 24.22.1, pnpm 9.12.3, `CI=true`, repository `.env.ci` fixtures and bounded four-CPU worker selection. Browser/server network fences deny external TCP/WebSockets, all UDP and local telemetry agents. Mux poster/HLS requests receive valid local fixtures; functional local recommendation/profile reads remain observable. No external-media corpus is run.

- Five final fresh-process focused Web runs: **188 each, 940 total passes** across loader, deferred prayer, route admission, Grow/course, role tabs/menu and mixed-language journey coverage. New loader tests cover promise completion without timers, coalescing, default-entry guards and retry. New prayer-loading tests first fail on the static import, then prove that loading the persona does not import prayer and that the real returned-course slot renders while prayer is unresolved. The long-shelf order test awaits actual module completion inside React act instead of relying on a fixed delay.
- Exact Web CI command, `pnpm --filter @forge/web run --if-present test`: **7,065 passed**, 13 gated skips, one todo.
- Exact Admin CI command, `pnpm --filter @forge/admin run --if-present test`: **9,874 passed**, 1,013 gated skips, one todo. Five cold editor repetitions: **50 passed**.
- Strict Web/Admin lint and typechecks, separate E2E typecheck, production Web/Admin builds, feature-flags **23**, experience-schema **70** and admin-graphql **2** tests pass. Production runtime hashes are pinned in `validated-production-source-hashes.json` and checked before the final loading matrix.
- Admin `schema:print`, admin-graphql `generate` and generated UI-locale checks have **zero drift**. No generated artifact is hand-edited. The shared audience flag remains default-off.
- All **168 migrations** apply to the fresh disposable `forge_watch_audience_test_pr2783_r7_repair` database. Audience publication, guarded importer, finder and learning-progress DB suites pass **22/22**, including ownership/CAS/reset cases. Exact DB files: `src/services/watch-audience-publication.db.test.ts`, `src/scripts/import-watch-audience-config.db.test.ts`, `src/services/watch-film-finder.service.db.test.ts` and `src/services/watch-learning-progress.service.db.test.ts`, run with `pnpm --filter @forge/admin test -- <files> --no-file-parallelism`. The importer CLI is not run against live data.
- Docker workspace/package-copy/workflow/shared-image guards pass **2/2**. Admin, package manifests, Dockerfile and image workflow are unchanged. The actual image is not rebuilt this round; prior production-image evidence is retained rather than represented as a new image build.
- `watch-audience-focus.spec.ts` final production browser matrix: **24/24**, English/Arabic × 390/1280px × light/dark color schemes, plus cold-return/query-cleanup/carousel navigation. **72 indicators** gain **176–6,462 exact blue pixels** with stable width/height; eight additional unselected-tab pixel comparisons pass. Focus and blur PNGs, computed styles, keyboard flow and touch/pointer behavior are retained. These checks catch identical rendering rather than accepting DOM focus alone.
- `watch-audience-localization.spec.ts`, `watch-grow-layout.spec.ts` and `watch-role-chip.spec.ts` retained browser coverage: **28/28**. `watch-audience-controls.spec.ts` retained R6 course/Finder radios, Grow/Partner tabs and real production Admin tabs: **130/130**, ten complete cycles, followed by **13/13** on the final rebuilt source.
- `watch-audience-config.spec.ts` final publication suite: **50/50**, ten cycles including ten genuine signed-in Partner questionnaire cases using real local hosted Auth/PKCE and its verified cookie. Draft-versus-published, exact streamed tabs/questions/ranking, public cache isolation and ordinary-entry resource/write assertions remain intact.

## Retained diagnostics and test corrections

The first retained R6 controls run passes 12/13; a traced repetition passes 39/40, both missing the same Partner resource-tab Space activation. Sanitized events show keydown/keyup delivered to the intended unselected button without application cancellation, but no native click in that failing Chromium run. This does not establish the browser's precise cause. The test imperatively focused a `tabIndex=-1` tab, outside the chosen automatic-activation roving interaction. It now reaches the target through ArrowLeft, checks its focus/selection, sends Space and retains focus/selection/one-entry-tab assertions. No Partner runtime key handler, timeout, retry or expectation is weakened; all 130 corrected-flow cases and the final 13-case rebuilt cohort pass. Failed receipts and trace remain available.

Earlier direct/parallel loading and early-entry experiments improve mount but do not clear every return budget; the failed paint cohort remains in `perf-return-course-390-aligned-failed-paint-budget.json`. Carousel experiments are retained as diagnostics and are absent from the product change. Removing an inline grid did not help and is not part of the change. A later paint probe also revealed a measurement asymmetry: only the inline candidate received Playwright visibility/stability waits and a second scroll, while the base dialog was already visible. The final probe scrolls the actual label to center immediately in the same DOM-observer turn on **both** builds, before paint, and records its real Element Timing entry. It removes candidate-only polling, not product work. The stopped cohort and all earlier failures remain separate diagnostics; final cohorts are collected afresh with no sample exclusions. Two early CSS diagnostic probes briefly overlap; `overlap-diagnostic.json` records that limitation, and neither is used for clearance. All final cohorts run serially.

## Controlled loading and resources

The first final matrix contains **624 measured navigations plus 192 warmups**, with no samples excluded: exact-main/unchanged-head negative controls (12/build/viewport), exact-main/candidate returns (32), candidate A/A (16), deterministic HTML/static replay (32), and parent/candidate ordinary home/video entry (32). Each cell has eight warmups/build, seeded balanced ABBA/BAAB order, fresh contexts, disabled browser cache, warm server/disk, Chrome 154.0.8037.92, DPR 2, CPU rate 1 and CPU affinity 20–27. No two measurement navigations overlap. Return samples require valid decoded local HLS; their observation continues through the inherited desktop media startup. Ordinary entry observes the initial 3.5 seconds, before the desktop film player's later idle mount.

Return timing uses the same immediate label-centering rule on both builds, in the DOM observer before paint, and actual Element Timing on “Choose a lesson”/“On my own”. The 10% median budget applies to mount and label paint; ordinary entry checks shell plus actual first/final LCP and 0.05 added CLS. An image-only comparison is reported where IMG is an LCP candidate in every row. Home mostly reports text/video candidates; `validated-performance-not-applicable.json` records the sparse IMG counts rather than calling an absent image candidate a passing metric. All required timing counts, viewport/DPR and loaded fonts are asserted.

Values below are median (p10–p90), milliseconds, before → after. “Main” is the exact requested `02ecc6b…`, not a moving branch ref; “parent” is exact `8e39c679…`.

| Return cell                               | n/build | Control mount                                   | Actual label paint                    | Median Δ mount / paint |
| ----------------------------------------- | ------: | ----------------------------------------------- | ------------------------------------- | ---------------------- |
| Main → parent, negative control, 390px    |      12 | 396.3 (393.46–411.74) → 750.35 (745.74–780.85)  | 448 (440.4–462.8) → 804 (792.4–830)   | +89.34% / +79.46%      |
| Main → parent, negative control, 1280px   |      12 | 412.3 (404.51–434.44) → 770.7 (754.97–808.33)   | 528 (504.8–547.6) → 872 (860.8–903.6) | +86.93% / +65.15%      |
| Main → candidate, initial fixture, 390px  |      32 | 398.75 (393.44–675.15) → 412.75 (402.72–431.95) | 452 (436–715.2) → 460 (448.4–483.6)   | +3.51% / +1.77%        |
| Main → candidate, initial fixture, 1280px |      32 | 408.85 (400.83–694.03) → 424.75 (410.21–468.17) | 532 (517.2–775.2) → 524 (512–567.6)   | +3.89% / -1.50%        |
| Candidate A/A, 390px                      |      16 | 407.15 (396.1–411.95) → 409.9 (397.55–424.45)   | 456 (444–464) → 456 (444–472)         | +0.68% / +0.00%        |
| Candidate A/A, 1280px                     |      16 | 419.65 (409.2–442.5) → 420.65 (411.8–490.55)    | 524 (516–550) → 522 (512–598)         | +0.24% / -0.38%        |
| Main → candidate, replay, 390px           |      32 | 664.95 (662.44–670.92) → 397.1 (394.02–402.69)  | 728 (712–740) → 444 (444–452)         | -40.28% / -39.01%      |
| Main → candidate, replay, 1280px          |      32 | 681.3 (670.04–689.8) → 412.7 (404.63–426.26)    | 840 (800–864) → 512 (500–532)         | -39.42% / -39.05%      |

The negative controls reproduce the reported regression; every candidate/A/A/replay readiness median meets the budget. In the initial real-server return fixture, phone mount p95/max improve 689.815/716.8→433.635/454.2ms and paint 760.6/784→485.8/504ms; desktop mount 728.045/743.8→479.995/539.1ms and paint 873/904→581/648ms. Paired two-round, 5,000-resample block-bootstrap 95% intervals for the median percentage change are phone mount **[2.856, 4.576]**, paint **[0.877, 4.464]**; desktop mount **[−0.423, 6.318]**, paint **[−3.321, 0]**. These are local corpus estimates, not field guarantees.

The initial fixture revealed one secondary-media asymmetry: main's legacy JFP course-cover optimizer cannot fetch through the server egress fence and returns 500; primary Mux poster/HLS remains valid. Replay also retains an unavailable home-prefetch response. Those rows remain intact as diagnostics, not a claim of universal HTTP success. A fresh full-size main/candidate cohort locally fulfills that exact public course-cover image to verify readiness without its failure; **the completed cross-check and no-scroll control below both pass**. Anonymous recommendation/profile read POSTs retain matched origin refusals in the shared-origin performance proxy; these are not authenticated API-latency tests. Genuine hosted-Auth/publication behavior is validated separately above.

Ordinary-entry results, parent → candidate:

| Cell          | Shell median (p10–p90)                  | First LCP median (p10–p90)        | Final observed LCP median (p10–p90) | Added median CLS |
| ------------- | --------------------------------------- | --------------------------------- | ----------------------------------- | ---------------: |
| home, 390px   | 45.9 (42.71–69.4) → 46.2 (41.41–64.14)  | 164 (104–388) → 164 (108–172)     | 572 (536.4–656) → 564 (536.4–587.6) |                0 |
| home, 1280px  | 46.05 (43.5–56.01) → 47.55 (43.3–52.88) | 204 (170–215.6) → 196 (157.2–212) | 676 (636–766.4) → 672 (632–735.2)   |                0 |
| video, 390px  | 41.55 (40.41–59.46) → 41.4 (40.51–60.3) | 136 (116.4–144) → 136 (92.4–144)  | 140 (132.4–152) → 142 (132–152)     |                0 |
| video, 1280px | 42.7 (41.11–53) → 41.7 (40.91–59.5)     | 148 (121.2–160) → 148 (116.8–160) | 152 (144–178.4) → 156 (144–176)     |                0 |

All four ordinary cells pass every applicable budget; video IMG-LCP medians are 140→142ms (phone) and 152→156ms (desktop). Every full distribution retains min/p10/p25/median/p75/p90/p95/max and every value in `validated-performance-summary.json`; all block-bootstrap intervals are in `validated-performance-comparisons.json`.

| Initial cell  | Requests | Script requests | Encoded script bytes | Encoded CSS bytes |
| ------------- | -------- | --------------- | -------------------- | ----------------- |
| home, 390px   | 59 → 59  | 31 → 31         | 847399 → 855061      | 49699 → 49758     |
| home, 1280px  | 59 → 59  | 31 → 31         | 847399 → 855061      | 49699 → 49758     |
| video, 390px  | 62 → 62  | 41 → 41         | 930179 → 938307      | 49699 → 49758     |
| video, 1280px | 57 → 57  | 40 → 40         | 929985 → 938113      | 49699 → 49758     |

The observed initial bundle delta is **7,662 encoded JS bytes on home, 8,128 on video, and 59 CSS bytes**, with unchanged request/script counts. Grow/course/prayer/Story/Finder/Partner/Share implementation chunks remain absent on every ordinary entry. There are no new prefetch destinations, initial audience/learning/finder requests, progress/role/audience storage writes or external peers. Returns also keep unrelated Story/Finder/Partner/Share implementations absent. Prayer is a separate intent-loaded chunk and is no longer imported by the lean persona.

The first resource audit incorrectly classified `/api/watch-progress` as a forbidden audience request. Source inspection confirms the inherited viewing-resume GET is read-only; every video row has exactly one in both parent and candidate, and home has none. The corrected audit explicitly requires equality and the one-per-video count, while retaining all write and Grow-learning/Finder prohibitions. The first failed audit receipt remains in `first-resource-audit-inherited-read-failure.txt`; `corrected-performance-audit.log` passes. No product code is changed for this classification. Only existing local recommendation content reads and profile `action=status` POSTs are allowed; telemetry actions, playback measurement, external HTTP/WebSockets and server TCP/UDP telemetry are fenced.

The immediate-scroll return probe produces large layout-shift totals on inline parent/candidate, unlike the base dialog. This is not initial-load CLS and is not presented as matching the base dialog. An incremental parent/candidate no-scroll control records actual shift sources to separate probe motion from layout changes. Earlier candidate-only scrolling cohorts remain noncomparable diagnostics. Ordinary-entry CLS and retained full-course geometry/navigation checks cover their respective windows separately.

### Complete-media cross-check and actual return layout

The fresh main/candidate return cohort has **32 measured loads/build/viewport plus eight warmups/build**, with the legacy course cover locally fulfilled as a valid image as well as valid Mux poster/HLS. It has zero image/static failures and external peers. It uses the same production source pins, symmetric probe, balanced order, cold contexts, media delay, CPU/DPR and budgets. All four mount/paint comparisons pass without a threshold waiver. No failed original row is removed.

| Viewport | Control mount median (p10–p90)                  | Actual paint median (p10–p90)       | Median Δ mount / paint |
| -------- | ----------------------------------------------- | ----------------------------------- | ---------------------- |
| 390px    | 394.15 (389.35–413.43) → 403.85 (398.01–430.24) | 444 (436–483.2) → 450 (444–479.6)   | +2.46% / +1.35%        |
| 1280px   | 412.6 (401.5–483.53) → 423.6 (409.12–469.26)    | 542 (505.2–609.6) → 526 (516–579.2) | +2.67% / -2.95%        |

| Viewport / metric  | p95 before → after | Maximum before → after | Block-bootstrap 95% interval for median Δ% |
| ------------------ | ------------------ | ---------------------- | ------------------------------------------ |
| 390px / mount      | 421.645 → 433.335  | 696.8 → 443.1          | [0.744, 4.635]                             |
| 390px / textPaint  | 489.8 → 483.6      | 764 → 496              | [0.0, 3.636]                               |
| 1280px / mount     | 599.29 → 538.8     | 727.2 → 545            | [1.095, 5.187]                             |
| 1280px / textPaint | 693.4 → 648        | 820 → 656              | [-5.755, 0.373]                            |

An additional **eight measured loads/build/viewport plus four warmups/build** compare parent/candidate returns without programmatic scrolling and retain the actual layout-shift sources. This isolates the application's initial return layout from the paint probe's viewport motion:

| Viewport | Parent → candidate CLS median (p10–p90)   | Added median CLS |
| -------- | ----------------------------------------- | ---------------: |
| 390px    | 0 (0–0) → 0 (0–0)                         |                0 |
| 1280px   | 0.005 (0.005–0.005) → 0.005 (0.005–0.005) |                0 |

The first no-scroll fixture audit found an inherited Unsplash illustration cached only in the candidate server optimizer: parent returned 500, candidate 200. Those 32 measured rows and 16 warmups remain diagnostics. Two additional image-source inspection navigations identify the exact URL. The final no-scroll cohorts fulfill that source locally in both builds and require zero image/static failures; no product change or sample deletion is made. Both incremental no-scroll cells meet the 0.05 added-CLS budget. The large immediate-scroll totals are not evidence of an equivalent initial-load shift. Retained rendered/browser geometry and carousel/focus tests cover the eventual full course and its controls. This control does not claim that an inline course and the legacy modal have identical geometry.

Across the first matrix and final controls there are **784 measured navigations and 240 warmups**, including unchanged-head negative controls. The 32 failed-fixture layout rows, their 16 warmups, two image-source inspections and earlier exploratory/failed corpora are retained separately. `complete-media-summary.json` retains every distribution/value; `complete-media-comparisons.json` retains intervals; `complete-media-audit.json` retains media/network/read refusals/storage/shift sources; `complete-media-raw-inventory.json` and `validated-performance-raw-inventory.json` retain raw-file SHA-256 hashes. The source and measurement scripts remain with the evidence corpus. No external-media corpus is run.

## Exact changed files

- `apps/web/e2e/watch-audience-controls.spec.ts`
- `apps/web/e2e/watch-audience-focus.spec.ts`
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- `apps/web/src/components/watch/WatchGrow.test.tsx`
- `apps/web/src/components/watch/WatchGrow.tsx`
- `apps/web/src/components/watch/WatchGrowCourse.tsx`
- `apps/web/src/components/watch/WatchGrowFocus.module.css`
- `apps/web/src/components/watch/WatchGrowLoader.tsx`
- `apps/web/src/components/watch/WatchGrowReturnPreload.tsx`
- `apps/web/src/components/watch/WatchGrowStory.tsx`
- `apps/web/src/components/watch/WatchNextSteps.tsx`
- `apps/web/src/components/watch/WatchRoleTabs.test.tsx`
- `apps/web/src/components/watch/WatchRoleTabs.tsx`
- `apps/web/src/components/watch/watch-grow-loader.test.ts`
- `apps/web/src/components/watch/watch-grow-loader.ts`
- `apps/web/src/components/watch/watch-grow-prayer-loading.test.tsx`
- `docs/plans/2026-10-25-pr2783-review-round-7-focus-return.md`
- `docs/reports/2026-10-25-pr2783-round-7-focus-return-validation.md`
- `docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md`

## Limits and durable lessons

These are local, unthrottled Chrome 154/DPR 2 production measurements with fixed valid media, warm server/disk caches and cold browser contexts. They establish neither field performance nor identical scheduling tails. Accessibility coverage includes real DOM, names, keyboard/focus and painted pixels; it is not a manual screen-reader audit. The Admin browser fixture uses the real production component/CSS/fonts rather than a full hosted dashboard login. Live public content, external Auth providers and production telemetry are not exercised.

Keep paint probes symmetric when comparing a modal with inline content. Count contrasting indicator pixels as well as changed screenshots: incidental media differences can produce a false positive for visible focus. For supported cold return journeys, measure actual control mount and label paint in addition to the initial shell/LCP. Resolve serial lazy boundaries before adding eager imports; scope any return preload to actual admitted intent and prove ordinary-entry chunks and writes remain absent. Give optional heavy shelves their own loading boundary so they cannot hold up a supported return target; verify their eventual geometry and navigation as well as the target's first paint.

Raw evidence is retained at `/mnt/worktrees/checkouts/t3/Forge/pr2783-r7-repair-evidence-20261025`, also linked from `/home/lado/.local/share/forge-pr2783-r7-repair-20261025`. All 17 previously retained exact-main corpus hashes were verified. Evidence includes failed controls, exact command receipts, source pins, traces, screenshots, media/network fences and distributions.
