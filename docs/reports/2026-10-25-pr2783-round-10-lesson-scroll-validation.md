# PR #2783 round 10: committed lesson scroll lifecycle

Exact implementation parent/push lease: `eca4dfbaac240b7054be402a92265a66fcda04e2`. Exact retained return baseline: `02ecc6be8d34af143e5975156b78d2e46a9e3406`. Scope: [round-10 plan](../plans/2026-10-25-pr2783-review-round-10-lesson-scroll.md). Validation is complete; feat-744 returns to complete after the repaired scope passes. No rollout, deployment, external configuration, live publication/import, external telemetry or production mutation is authorized.

## Diagnosis and repair

`openLesson` scheduled a 70ms timeout without cleanup. Its callback read the persistent wrapper ref, which still exists after the lesson closes. A rapid close and subsequent keyboard navigation therefore allowed the old callback to scroll an empty wrapper and move the seventh reading-plan link outside the viewport. Multiple opens also queued multiple callbacks.

Scroll requests now belong to the committed active lesson and capture their focus owner. One animation frame runs only while that exact lesson/container is connected and current, and only while newer keyboard focus does not own the viewport. Effect cleanup cancels work on close, lesson replacement, repeated open and unmount. Focus departure, history/hash/page navigation and link navigation cancel pending work; returning focus to the opener cannot revive it. Listeners detach on cancellation or successful execution. Removing an old focused lesson control permits the next lesson's legitimate scroll without overriding a new focused control. Normal active opens still scroll smoothly once; reduced motion uses instant scrolling. Direct-return initialization creates no scroll request, preserving return readiness and paint behavior. No authored styling, content, routing, requests, storage, flags, package dependencies or imports change. The compiled byte differences are accounted for below.

## Deterministic and real-browser evidence

Fake-timer tests render the actual course and exercise close, active once-only behavior across rerenders, A→B replacement, repeated same-lesson opens, repeated toggles/unmount, focus departure/return, popstate/hashchange/pagehide, link navigation, direct returns and reduced motion. The final exact-parent mutation run fails 10 of the 20 course tests; restoring the repair passes all 20. Five cold runs of the 221-test focused cohort also pass (1,105 test executions across those runs). The component's real carousel remains present. Test assertions concern the scroll boundary rather than counting unrelated carousel teardown timers.

The production browser probe forwards native `scrollIntoView` calls while recording the active/empty lesson boundary; it never mocks a timer, animation frame, event handler or course state. Real trusted Enter/Tab inputs drive rapid open/close and reach the seventh reading-plan link. Each cycle observes actual focus and full viewport geometry for 600ms, beyond the original timeout and native smooth-scroll window. All 32 cycles/cell run before assertions, preserving both successes and failures. Four cells cover English/Arabic × 390/1280px.

Exact parent: **127/128** cycles scroll an empty wrapper and hide the focused link (31/32, 32/32, 32/32, 32/32); all four negative cases fail. All four active-open/pointer/touch positive controls pass on the parent. Candidate: **128/128** rapid cycles retain full focused-link viewport visibility, with **zero** empty-wrapper scrolls. All four active-open/pointer/touch controls pass: **8/8** production browser tests overall. Original per-cycle records, focus geometry samples, screenshots and network receipts are retained separately for parent and candidate.

## Commands and other validation

Node 24.22.1, pnpm 9.12.3, CI fixtures, bounded CPUs and full server/browser telemetry fences. Exact commands, exit codes and logs are retained with the raw evidence.

Completed checks:

- Five cold focused runs: `pnpm --filter @forge/web exec vitest run` over carousel, page routing, Grow loader/prayer/course, RoleTabs/RoleChip/RoleJourney, questionnaire localization and AudienceBlock: **221/run**, all green. Exact-parent course mutation: **10 failed / 10 passed**; repaired course: **20 passed**.
- Exact CI Web command: `pnpm --filter @forge/web run --if-present test`: **7,084 passed**, 13 intentionally gated skips, one todo.
- `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/web lint --max-warnings=0`; strict E2E `tsc --noEmit`: pass.
- Normal candidate and exact-parent `pnpm --filter @forge/web build`: pass. Independent Arabic-fixture production build and **20/20** fully Arabic home/video answer/edit/reset/tooltip/focus cases pass; the normal build is restored for timing.
- Retained production browser cohort: **60 passed**, covering course geometry, language boundaries, RoleChip keyboard/touch, 72 painted focus indicators and R8 slow/rejected optional/course chunks.
- Publication cohort: **50 passed**, including ten genuine local hosted-Auth Partner flows. Draft/public projection, exact streamed tabs, compact home and ordinary loading-deferral assertions remain intact. No live publication/import occurs.
- R6 real browser native radios/Finder and Admin tabs: **13 passed**, including keyboard/focus appearance at English/Arabic × phone/desktop; Admin uses the retained real-component production-CSS fixture.
- `pnpm --filter @forge/admin schema:print`; `pnpm --filter @forge/admin-graphql generate`: pass with **zero SDL/introspection drift**. `@forge/feature-flags` (23), `@forge/experience-schema` (70), `@forge/admin-graphql` (2): pass.
- Fresh disposable PostgreSQL: **168/168 migrations**, **22 publication/importer/finder/learning DB cases**, plus **2 Docker packaging guard tests** pass. The fresh database was removed after validation, with prior fixture databases preserved. Import tests use local fixture databases only; no importer CLI or live content operation runs.

Repository-wide `pnpm run format:check` and the explicit edited-Markdown Prettier check pass; hooks remain enabled. Final manual diff scanning finds no additional issue. All nine owned ports/services are stopped and no owned Chrome remains.

No application assertion or timeout is relaxed. Prior Admin production image/build receipts remain retained; this Web-only lifecycle repair has an empty Admin/Auth/package/workflow/lockfile diff, so those unchanged production artifacts are not rebuilt.

## Controlled performance and resources

The fresh corpus contains **512 measured navigations plus 128 warmups**, eight cells, **32 measured loads/build/cell plus eight warmups/build**. Sampling uses seeded balanced ABBA/BAAB order, serial navigations, fresh contexts and disabled browser cache, warm server/disk, Chrome 154.0.8037.92, DPR 2, CPU rate 1 and affinity 20–27. No heavy validation overlaps sampling. Return controls use the exact supported `?as=grow&growLesson=lesson-1` path, actual DOM mount and Element Timing label paint, symmetric immediate label centering, loaded fonts and decoded valid local HLS on every row. Desktop retains the inherited approximately 8.8-second idle media startup. Ordinary entry observes the initial 3.5 seconds.

| Return cell / viewport         | n/build | Mount median (p10–p90), before → after          | Text paint median (p10–p90), before → after | Median mount / paint Δ |
| ------------------------------ | ------: | ----------------------------------------------- | ------------------------------------------- | ---------------------- |
| Exact main → candidate, 390px  |      32 | 397.55 (392.56–531.39) → 412.15 (404.07–428.42) | 452 (440–594) → 460 (452–480)               | +3.672% / +1.77%       |
| Exact main → candidate, 1280px |      32 | 413.45 (404.34–459.16) → 432.15 (418.23–458.57) | 536 (500.4–599.6) → 536 (520–555.6)         | +4.523% / +0%          |
| Candidate A/A, 390px           |      32 | 414.15 (406.23–429.82) → 417.15 (406.06–428.67) | 462 (456–483.6) → 468 (456–480)             | +0.724% / +1.299%      |
| Candidate A/A, 1280px          |      32 | 428.9 (414.79–451.97) → 426.25 (415.93–456.93)  | 528 (516–555.2) → 524 (516–563.6)           | -0.618% / -0.758%      |

| Exact-main return / metric | p95 before → after | Maximum before → after | Block-bootstrap 95% interval for median Δ% |
| -------------------------- | ------------------ | ---------------------- | ------------------------------------------ |
| 390px / mount              | 676.52→432.97      | 678.8→524.4            | [2.368, 5.087]                             |
| 390px / textPaint          | 726.8→481.8        | 756→592                | [-1.724, 3.571]                            |
| 1280px / mount             | 599.86→508.455     | 723→559                | [3.042, 7.737]                             |
| 1280px / textPaint         | 706→608.4          | 832→676                | [-3.65, 3.422]                             |

The exact-main return medians and A/A cells meet the 10% budgets. The previous round's real-server, A/A, fixed-delay replay and no-scroll return corpora remain hash-verified unchanged; this round adds fresh real-server/A/A evidence without claiming a new replay run. The immediate label-centering paint probe produces the inherited larger inline scroll/shift totals; those raw totals are retained and are not called initial-load CLS equivalence with main's modal. Ordinary-entry CLS below is measured without that probe. Retained geometry/focus checks cover the loaded course layout.

| Ordinary exact-parent → candidate | Shell median (p10–p90)                  | First LCP median (p10–p90)      | Final LCP median (p10–p90)          | Added median CLS |
| --------------------------------- | --------------------------------------- | ------------------------------- | ----------------------------------- | ---------------: |
| home, 390px                       | 46.2 (41.95–67.49) → 44.4 (41.54–55.15) | 160 (108–168) → 160 (104.4–168) | 564 (532–587.6) → 560 (536–583.2)   |                0 |
| video, 1280px                     | 42.2 (41.2–49.85) → 42.45 (40.9–64.42)  | 148 (124–160) → 148 (100.4–156) | 154 (148–179.2) → 156 (148–198.4)   |                0 |
| home, 1280px                      | 48.2 (43.5–51.82) → 45.45 (43.02–63)    | 194 (164–208) → 194 (160.4–208) | 688 (636.8–735.6) → 686 (648–735.6) |                0 |
| video, 390px                      | 41.65 (41.01–59) → 41.5 (41–57.7)       | 136 (92–144) → 138 (92.4–144)   | 140 (132.4–163.6) → 144 (136–152)   |                0 |

All ordinary-entry shell/actual-LCP medians meet the 10% budget; added median CLS meets 0.05. IMG-only LCP is separately checked where every row supplies an image candidate; otherwise the exact missing-candidate counts remain explicit in `validated-performance-not-applicable.json`, while actual first/final LCP stays mandatory. Full distributions retain min/p10/p25/median/p75/p90/p95/max and every original value, with paired two-round block-bootstrap intervals. Passing medians do not establish identical tails or field performance.

| Initial entry | Requests | Script requests | Encoded JS bytes, including link preloads | Encoded CSS bytes |
| ------------- | -------- | --------------- | ----------------------------------------- | ----------------- |
| home, 390px   | 59→59    | 31→31           | 851473→859078                             | 49758→49846       |
| video, 1280px | 57→57    | 40→40           | 941437→949044                             | 49758→49846       |
| home, 1280px  | 59→59    | 31→31           | 851473→859078                             | 49758→49846       |
| video, 390px  | 62→62    | 41→41           | 941631→949238                             | 49758→49846       |

The deferred course chunk grows **73,605→74,518 bytes (+913)**, **20,554→20,920 gzip bytes (+366)**. Initial encoded JavaScript rises **7,605 bytes on home (+0.89%)** and **7,607 bytes on video (+0.81%)**. The emitted common polyfill chunk grows **131,445→139,048 encoded bytes (+7,603)** and contains additional modular Buffer/base64/EventEmitter representations alongside the existing bundled implementations; `r10-bundle-module-diagnostic.json` retains the exact module census. This artifact cost is measured, not attributed entirely to the small course lifecycle edit. No package/import/dependency is added and script/request counts do not increase.

Encoded CSS grows **49,758→49,846 bytes (+88, +0.18%)**. Comparing emitted rules finds only an unused `!container` utility/media rules generated by Tailwind scanning the new `!container` conditional token, plus the source-map name. No rendered class or focus treatment changes. The actual emitted JS/CSS artifacts are used in every passing timing cell; these byte changes are not excluded from the census.

Home request totals span 59–61 in both builds. The two variable requests are blocked first-party `POST /watch/api/recommendations/surface-exposure` attempts; a method/path/type multiset diagnostic finds no other differences between 59- and 61-request rows. These attempts do not deliver telemetry or represent new content requests/writes. Counts include blocked attempts rather than silently omitting them.

Deferred Grow/course/prayer/Story/Finder/Partner/Share implementation chunks remain absent on ordinary entries. Return paths keep unrelated Story/Finder/Partner/Share implementations absent. No new prefetch destination, audience/Finder/learning request, initial role/progress write, relevant storage write or external peer is introduced. The inherited viewing-resume GET remains exactly one per video row and zero per home row, matched between builds. The local recommendation/profile-status POSTs are read-only and recorded separately from blocked telemetry; matched anonymous proxy-origin refusals are not authenticated API-latency measurements.

All **640 navigations**, including warmups, pass the network census: **zero external peers and zero unfenced external POSTs**. External HTTP/WebSockets, Mux Data, first-party Watch-event/recommendation telemetry and server TCP/UDP/local-agent telemetry are fenced. Mux poster/HLS and legacy imagery are locally fulfilled with real media decoding; no external corpus is run. Blocked host/path/method counts and read refusals are retained. Source pins, chunk maps, complete request/resource timings, storage audits and original raw samples accompany `r10-performance-method.json`, `validated-performance-{summary,comparisons,audit,raw-inventory}.json` and `all-rows-network-audit.json`. No timing threshold or request/write assertion is waived.

## Exact changed files

- `apps/web/src/components/watch/WatchGrowCourse.tsx`
- `apps/web/src/components/watch/WatchGrowCourse.test.tsx`
- `apps/web/e2e/watch-grow-scroll.spec.ts`
- `docs/plans/2026-10-25-pr2783-review-round-10-lesson-scroll.md`
- `docs/reports/2026-10-25-pr2783-round-10-lesson-scroll-validation.md`
- `docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md`

## Limits and durable learning

These are local production-build browser tests and controlled performance measurements, not field-performance guarantees or a manual screen-reader audit. Native media is locally fulfilled and decoded; no unsafe external corpus is run. Arabic course chrome intentionally remains English/LTR while earlier authored-language boundaries stay intact. Hosted Auth is actual local Auth/PKCE rather than an external identity provider. Admin/Auth/schema/migration/concurrency/reset/resume/importer/Docker/default-off repairs remain unchanged.

The first fake-timer harness restored frame functions before the real carousel unmounted, causing unrelated teardown errors; teardown now unmounts before restoring globals. A timer-count experiment also counted inherited carousel work, so the final unmount assertion verifies that no scroll escapes the component lifecycle. The meaningful parent stale/duplicate-scroll failures remain independently reproduced. All setup receipts are retained; no application assertion or timeout is weakened.

Durable lesson: delayed viewport work must belong to the committed content instance, with cleanup and a focus owner. A still-connected wrapper does not establish that the content which requested a scroll is still active. Verify the focused element's geometry after trusted keyboard navigation; DOM focus alone can pass while the control is offscreen.

Runtime source pins (28), exact-main ancestry and the protected Admin/Auth/package/workflow/lockfile diff are checked before commit. Earlier performance inventories retain 23 pre-R8, 12 R8 and eight R9 corpora, with every hash verified unchanged.

Raw evidence: `/mnt/worktrees/checkouts/t3/Forge/pr2783-r10-repair-evidence-20261025`, linked at `/home/lado/.local/share/forge-pr2783-r10-repair-20261025`.
