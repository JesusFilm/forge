# PR #2783 round 9: questionnaire chrome language boundaries

Exact implementation parent and push lease: `6d2b28f86965000f6969b6b45c1f18fa4de9622f`. Exact return-performance baseline: `02ecc6be8d34af143e5975156b78d2e46a9e3406`. Scope: [round-9 plan](../plans/2026-10-25-pr2783-review-round-9-questionnaire-chrome.md). The repaired scope has passed validation; feat-744 is complete. No deployment, external configuration, live publication/import, external telemetry or production mutation is authorized.

## Diagnosis and repair

The published configuration owns role names, question prompts, option labels/hints/reasons and action copy. The renderer owns “Who is this for”, “Your answers” and the native “Change this answer” title. These exact strings have no existing message-catalog entries. The journey correctly declared its configuration language but omitted English boundaries for the answered-trail accessible name and tooltip. The shared role tabs similarly inherited the configuration language for their English group name.

The trail and tooltip now declare English/LTR, while each answer's authored label has an explicit configuration-language span. The tab group declares the language of its group name (English by default); its nested grid and each tab retain the resolved configuration language. The nested grid preserves the authored RTL visual ordering, rather than accidentally reversing Arabic tabs when isolating the English group name. All three hosts pass the actual resolved configuration locale, including English fallback. A custom translated tab-group label can declare its own `labelLocale`, independently of the content locale. No authored string, role order, ranking, destination, storage behavior, focus handler or loading code changes.

The sibling audit includes the journey's question counter, Back/Start over controls, English reveals, result prefix/conjunction/next-step/Go/alternative/empty-state metadata, authored reasons/actions, the home band and pill titles, WatchNextSteps' hidden heading/resources, header RoleChip names/title/menu/shortcut boundaries and the Story/Finder/prayer/Share portal boundaries. Existing explicit English, authored or neutral boundaries already handle those paths. In particular, Partner's English resource wrapper does not override its nested authored journey. No portal is introduced by this change; the tooltip remains the native title with its real accessible description.

## Rendered and browser regression evidence

- Rendered tests use a schema-validated fixture in which every editable role/question/option/action copy field is Arabic, retaining real IDs, scores and destinations. Both home/video tests fail on exact parent production components with `ar` instead of `en`. An additional mutation control restores only the parent journey while leaving repaired tabs: video fails on the answered-trail boundary. Green tests independently assert English metadata, Arabic question/role/answer descendants, focus continuity through answer/edit/reset and translated-label/English-fallback provenance.
- A separate production build uses the same fully Arabic read fixture. All four exact-parent phone/desktop × home/video cases fail with inherited/computed `ar/rtl` instead of `en/ltr`. The final candidate passes **20/20** executions (five complete cycles), including schema/projection equality, all four Arabic role labels, authored grid direction, English group name, first answer and native tooltip title/accessible description, hover and keyboard edit, three answers/results, reset and retained Arabic copy/focus. Real screenshots retain home tabs and focused answer/edit controls. Home intentionally remains the authorized compact role band with no questionnaire.
- The Arabic producer is an evidence-only read adapter around the actual loopback Admin GraphQL producer. It supplies a schema-valid Arabic audience projection and reuses the existing English home fixture's other blocks/admission for the otherwise absent Arabic homepage. It makes no draft/publication/import/DB write. This isolates rendering provenance; it is not presented as a real Arabic publication test. Genuine publication/projection/cache/auth contracts are tested independently below.
- Retained production localization/geometry/RoleChip/painted-focus/chunk-fault cohort: **60/60**. This includes 24 focus cases with actual contrasting pixels in selected/unselected states and themes; Scripture/continuation/portal locale matrix; Grow panel/rail geometry; and eight real optional course/prayer slow/reject/success/recovery cases with eight-second delays and usable lesson navigation.
- Retained R6 native radios/resource tabs/Admin tabs: **13/13** with real visible-focus and edit persistence checks. Publication: **50/50**, ten cycles including ten genuine signed-in Partner cases after an actual local hosted Auth/PKCE round trip and a verified Web session cookie (one login, cookie reused across cycles). Draft-vs-published leakage, exact authored order/ranking and deferred-loading/write assertions remain unchanged. A final shared-fence R8/RoleChip run passes **14/14**.

## Commands and other validation

All commands run with Node 24.22.1, pnpm 9.12.3, CI fixtures, bounded CPUs and server/browser telemetry fences. Exact commands and exit codes are retained beside logs.

- Five final cold focused runs, repeated after the last test additions: **208 each / 1,040 executions**. Scope includes real journey/block/home/tabs/menu, course/loader/prayer failure and route/carousel tests. No arbitrary waits/retries are added to rendered assertions.
- Exact Web CI: `pnpm --filter @forge/web run --if-present test` — **7,071 passed**, 13 gated skips, one todo.
- `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/web lint --max-warnings=0`; separate strict E2E TypeScript including R8 faults and the new Arabic tests; production candidate and exact-parent Web builds, plus independent Arabic fixture builds.
- `pnpm --filter @forge/admin schema:print`; `pnpm --filter @forge/admin-graphql generate`; generated schema/introspection/UI-locale diff checks: **zero drift**. Feature flags **23**, experience-schema **70**, admin-graphql **2** pass.
- All **168** migrations apply to fresh disposable `forge_watch_audience_test_pr2783_r9_repair`. The four DB suites (`src/services/watch-audience-publication.db.test.ts`, `src/scripts/import-watch-audience-config.db.test.ts`, `src/services/watch-film-finder.service.db.test.ts` and `src/services/watch-learning-progress.service.db.test.ts`) pass **22/22**; Docker workspace/shared-image packaging guards pass **2/2**. No standalone importer or live publisher is run. The untouched full Admin unit/build/image results remain retained from round 8; this round reruns the relevant DB/schema/packaging/browser contracts instead of rebuilding the unchanged Admin image.

## Controlled performance and resources

The fresh corpus contains **512 measured navigations plus 128 warmups**, eight cells, **32 measured loads/build/cell plus eight warmups/build**. Sampling uses seeded balanced ABBA/BAAB order, serial navigations, fresh contexts and disabled browser cache, warm server/disk, Chrome 154.0.8037.92, DPR 2, CPU rate 1 and affinity 20–27. No heavy validation overlaps sampling. Return controls use the exact supported `?as=grow&growLesson=lesson-1` path, actual DOM mount and Element Timing label paint, symmetric immediate label centering, loaded fonts and decoded valid local HLS on every row. Desktop retains the inherited approximately 8.8-second idle media startup. Ordinary entry observes the initial 3.5 seconds.

| Return cell / viewport         | n/build | Mount median (p10–p90), before → after          | Text paint median (p10–p90), before → after | Median mount / paint Δ |
| ------------------------------ | ------: | ----------------------------------------------- | ------------------------------------------- | ---------------------- |
| Exact main → candidate, 390px  |      32 | 398.05 (393.31–518.74) → 413.3 (401.33–429.45)  | 452 (444–579.2) → 460 (448.4–480)           | +3.831% / +1.77%       |
| Exact main → candidate, 1280px |      32 | 413.75 (406.11–539.34) → 431.6 (415.6–460.22)   | 540 (500–641.6) → 530 (516.4–556)           | +4.314% / -1.852%      |
| Candidate A/A, 390px           |      32 | 413.85 (403.55–425.53) → 413.45 (402.94–429.28) | 462 (452–480) → 462 (452–480)               | -0.097% / +0%          |
| Candidate A/A, 1280px          |      32 | 424.2 (413.51–456.05) → 427.75 (413.92–456.76)  | 524 (516–555.2) → 528 (516–552)             | +0.837% / +0.763%      |

| Exact-main return / metric | p95 before → after | Maximum before → after | Block-bootstrap 95% interval for median Δ% |
| -------------------------- | ------------------ | ---------------------- | ------------------------------------------ |
| 390px / mount              | 671.02→436.585     | 680.8→458.6            | [1.998, 5.028]                             |
| 390px / textPaint          | 715.6→488          | 748→508                | [-1.709, 4.425]                            |
| 1280px / mount             | 634.585→501.595    | 730.3→552              | [1.958, 7.333]                             |
| 1280px / textPaint         | 740.8→600          | 852→664                | [-4.0, 1.124]                              |

The exact-main return medians and A/A cells meet the 10% budgets. The previous round's real-server, A/A, fixed-delay replay and no-scroll return corpora remain hash-verified unchanged; this round adds fresh real-server/A/A evidence without claiming a new replay run. The immediate label-centering paint probe produces the inherited larger inline scroll/shift totals; those raw totals are retained and are not called initial-load CLS equivalence with main's modal. Ordinary-entry CLS below is measured without that probe. Retained geometry/focus checks cover the loaded course layout.

| Ordinary exact-parent → candidate | Shell median (p10–p90)                   | First LCP median (p10–p90)          | Final LCP median (p10–p90)            | Added median CLS |
| --------------------------------- | ---------------------------------------- | ----------------------------------- | ------------------------------------- | ---------------: |
| home, 390px                       | 45.4 (42.45–73.77) → 46.35 (42.04–63.81) | 162 (104.4–409.6) → 162 (108–175.6) | 574 (536.4–679.6) → 558 (536.4–587.2) |                0 |
| video, 1280px                     | 43.55 (41.22–54.5) → 42.5 (40.81–58.41)  | 148 (128.4–160) → 148 (128–160)     | 156 (148–184) → 154 (144–178.4)       |                0 |
| home, 1280px                      | 47.35 (42.75–53.26) → 45.8 (42.61–48.69) | 198 (160–219.2) → 194 (156–211.6)   | 700 (660–755.2) → 720 (649.2–752)     |                0 |
| video, 390px                      | 42.05 (40.8–59.43) → 42.1 (40.52–57.48)  | 136 (116–144) → 136 (112.4–144)     | 140 (132–151.6) → 140 (132.4–147.6)   |                0 |

All ordinary-entry shell/actual-LCP medians meet the 10% budget; added median CLS meets 0.05. IMG-only LCP is separately checked where every row supplies an image candidate; otherwise the exact missing-candidate counts remain explicit in `validated-performance-not-applicable.json`, while actual first/final LCP stays mandatory. Full distributions retain min/p10/p25/median/p75/p90/p95/max and every original value, with paired two-round block-bootstrap intervals. Passing medians do not establish identical tails or field performance.

| Initial entry | Requests | Script requests | Encoded JS bytes, including link preloads | Encoded CSS bytes |
| ------------- | -------- | --------------- | ----------------------------------------- | ----------------- |
| home, 390px   | 59→59    | 31→31           | 851414→859078                             | 49758→49758       |
| video, 1280px | 57→57    | 40→40           | 941366→949043                             | 49758→49758       |
| home, 1280px  | 59→59    | 31→31           | 851414→859078                             | 49758→49758       |
| video, 390px  | 62→62    | 41→41           | 941560→949237                             | 49758→49758       |

Initial encoded JavaScript grows by 7,664 bytes on home (+0.90%) and 7,677 bytes on video (+0.82%); request/script counts and CSS bytes match. The emitted common chunk changes its Buffer/base64/IEEE754/EventEmitter polyfill representation alongside the small component chunks. This artifact-level difference is retained in `bundle-module-diagnostic.json`; it is not claimed to be entirely the markup delta or dismissed from the byte census. The production source adds only the existing locale direction helper import, no package dependency or loading/effect/request path. All timing budgets pass with the actual emitted artifacts.

Home request totals span 59–61 in both builds. The two variable requests are blocked first-party `POST /watch/api/recommendations/surface-exposure` attempts; a method/path/type multiset diagnostic finds no other differences between 59- and 61-request rows. These attempts do not deliver telemetry or represent new content requests/writes. Counts include blocked attempts rather than silently omitting them.

Deferred Grow/course/prayer/Story/Finder/Partner/Share implementation chunks remain absent on ordinary entries. Return paths keep unrelated Story/Finder/Partner/Share implementations absent. No new prefetch destination, audience/Finder/learning request, initial role/progress write, relevant storage write or external peer is introduced. The inherited viewing-resume GET remains exactly one per video row and zero per home row, matched between builds. The local recommendation/profile-status POSTs are read-only and recorded separately from blocked telemetry; matched anonymous proxy-origin refusals are not authenticated API-latency measurements.

All **640 navigations**, including warmups, pass the network census: **zero external peers and zero unfenced external POSTs**. External HTTP/WebSockets, Mux Data, first-party Watch-event/recommendation telemetry and server TCP/UDP/local-agent telemetry are fenced. Mux poster/HLS and legacy imagery are locally fulfilled with real media decoding; no external corpus is run. Blocked host/path/method counts and read refusals are retained. Source pins, chunk maps, complete request/resource timings, storage audits and original raw samples accompany `r9-performance-method.json`, `validated-performance-{summary,comparisons,audit,raw-inventory}.json` and `all-rows-network-audit.json`. No timing threshold or request/write assertion is waived.

## Exact changed files

- `apps/web/src/components/home/WatchHomeRoleBand.tsx`
- `apps/web/src/components/watch/WatchNextSteps.tsx`
- `apps/web/src/components/watch/WatchRoleJourney.tsx`
- `apps/web/src/components/watch/WatchRoleTabs.tsx`
- `apps/web/src/components/watch/WatchSectionRenderer.tsx`
- `apps/web/src/components/watch/WatchQuestionnaireLocalization.test.tsx`
- `apps/web/src/test/fixtures/watch-audience-arabic.ts`
- `apps/web/e2e/watch-questionnaire-localization.spec.ts`
- `apps/web/e2e/watch-audience-test.ts`
- `docs/plans/2026-10-25-pr2783-review-round-9-questionnaire-chrome.md`
- `docs/reports/2026-10-25-pr2783-round-9-questionnaire-chrome-validation.md`
- `docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md`

## Setup corrections and limitations

The initial Arabic home probe reached the language-inventory redirect because the local producer had no Arabic homepage. The read-only fixture now supplies home admission/content, and all four authoritative parent failures are actual language/direction mismatches. The first candidate probe passed its localization assertions but exposed an orphaned shared-fence response inspection after context teardown. The listener now detaches before draining every inspection; inspection failures and external peers still fail the test. Separately built parent actions have different build-salted IDs: the fixture accepts an explicit reference manifest so negative probes fence both real builds. External WebSockets are also explicitly fenced. Early failed setup receipts remain available. No timeout or localization assertion is loosened.

These are local production-build browser tests and controlled load measurements, not field-performance guarantees or a manual screen-reader audit. Native tooltips are checked through the real title, accessible description and effective DOM language; screenshots do not claim to capture an operating-system tooltip. The Admin browser fixture renders the real component/CSS/fonts without a full dashboard login. Hosted Auth is real local Auth/PKCE, not an external identity provider. Recommendation/HNSW code/timeouts, auth/erasure, schema/migrations, concurrency/ownership/CAS/reset/resume lineage, importer guards, Docker packaging, feature-flag defaults and all prior loading/performance repairs are untouched.

Durable lesson: an authored-language container also changes the language of renderer-owned accessible names and native tooltips. Inspect `aria-label`, `title`, hidden text and portal boundaries as well as visible copy; isolate each content source and restore authored descendants explicitly. Keep authored layout direction independent from the language of a container's English accessible name. Test with every editable copy field translated, so English fixture content cannot hide missing provenance.

Raw evidence: `/mnt/worktrees/checkouts/t3/Forge/pr2783-r9-repair-evidence-20261025`, linked at `/home/lado/.local/share/forge-pr2783-r9-repair-20261025`. Round-8 and earlier raw corpora are preserved and hash-checked separately. The ticket is complete after validation; no rollout is authorized.
