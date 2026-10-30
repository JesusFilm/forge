# PR #2783 review round 3 localization validation

Repair parent: `e96adbc57c06730cce00572155d4625367d021d2`. The editor branch continues by fast-forward, with the push lease pinned to that exact parent. feat-744 remains in progress pending review clearance.

## Implementation and compatibility

- Admin exposes additive nullable `Passage.languageSlug`, derived from the already selected Bible version for both cached and fresh passages. Hassaniyya requests select the same Modern Standard Arabic version as before; unmapped requests retain the existing English fallback. Provider selection, fetching, cache storage and migrations are unchanged.
- The route snapshot carries that identity to Grow's lean/full Scripture text and localized reference. English headings, labels, version abbreviations and resource controls keep their English boundary. Missing or unrecognized metadata uses `lang="" dir="auto"`, without guessing from the requested dub or page locale.
- The Web reader independently retries the exact old-producer `Passage.languageSlug` validation error. It removes only that child selection, retains other language fields and the existing requested-language compatibility repair, and does not hide unrelated failures. The AST transformation runs only on the compatibility path. SDL and introspection were regenerated through `schema:print` and `generate`, then regenerated a second time with identical hashes.
- English Story, Finder, pending/error Finder and both prayer dialog content boundaries explicitly declare `en/ltr`. The translated shared close control declares its actual UI locale/direction. The Share print article declares English/LTR; authored prompts without language metadata have a neutral boundary in both inline and printed lists. Localized Finder result titles and the printed film title also use neutral text boundaries because their contracts do not identify the selected title locale. No authored copy changed.
- Audience portal audit: Story and Finder use body portals, prayer uses shared DialogContent, and Share prints through a body portal. The course lesson sheet stays inline inside its existing English resource boundary. Existing download/share/language dialogs and player menus use translated content and were not forced to English.

## Falsification and automated validation

Evidence root: `/home/lado/.local/share/forge-pr2783-r3-20261024/`. Earlier round-1/round-2 evidence directories remain untouched.

Rendered red controls failed on the missing passage and portal boundaries: 15 Web failures, five producer metadata failures, one authored Share prompt failure and three schema-lag failures. The repaired focused selection passed 149 tests; the later schema-lag selection passed 10/10. The final full Web run includes all added cases and passes 7,021 tests, with 13 environment skips and one todo, across 347 passing files. Relevant Admin passage/schema tests pass 73/73 and admin-graphql passes 2/2.

Commands and receipts:

```text
pnpm --filter @forge/{admin,web,admin-graphql} lint --max-warnings=0
pnpm --filter @forge/{admin,web,admin-graphql} typecheck
pnpm --filter @forge/web run test --maxWorkers=1 --no-file-parallelism
pnpm --filter @forge/admin run test src/services/scripture-passage.service.test.ts src/graphql/schema.test.ts --maxWorkers=1 --no-file-parallelism
pnpm --filter @forge/admin-graphql run test --maxWorkers=1 --no-file-parallelism
pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin-graphql generate
pnpm --filter @forge/{web,admin} build
pnpm --filter @forge/web exec tsc --noEmit -p <evidence>/e2e-tsconfig.json
pnpm --filter @forge/web exec eslint e2e/watch-audience-config.spec.ts e2e/watch-grow-layout.spec.ts e2e/watch-audience-localization.spec.ts --max-warnings=0
```

Brace notation above abbreviates separate package invocations; exact argument arrays, exit codes, counts and logs are in `broad-first-results.json`, `broad-results.json`, `focused-results.json`, `supplemental-results.json`, `build-results.json`, `final-web-results.json` and `final-source-build-results.json`. Both the pinned-parent and repaired Web production builds, repaired Admin production build, strict package lint/types and separate E2E lint/types pass. `schema-zero-drift.json` records the second-generation hashes.

The first broad Web run exposed two existing translation-only mocks missing the newly used `useLocale`; those mocks now return their existing test catalog locale. The first Admin build runner omitted `DATABASE_URL`; its corrected run uses only the owned loopback database. Initial focused lint formatting was corrected before the final checks. These failed receipts remain retained.

## Real browser, publication and geometry

The new `apps/web/e2e/watch-audience-localization.spec.ts` fails all eight cases against the exact parent at the intended missing passage/portal language attributes. The final repaired run passes all eight cases at 1280px and 390px with zero retries. Arabic and Spanish selected Scripture, Urdu's English fallback, lean/expanded/full passages, exact reference boundaries and English nested copy controls are exercised through real production Web and Admin GraphQL.

Both Arabic portal cases cover Finder and Story names, English/LTR content, focus wrapping, Story arrow navigation, Escape and return focus. Both prayer dialogs retain English names/descriptions while their translated close control is Arabic/RTL. The test asserts no audience/finder/progress writes. The first repaired run exposed an assertion that retained the old expand-button accessible name after it changed to “Hide the passage”; the corrected test asserts the new exact name and expanded state. The first run's log is retained.

The unchanged `watch-grow-layout.spec.ts` passes all six production cases: initial deferred-resource/request absence, panel/grid/content geometry, desktop/mobile carousels and last-card reachability, touch and keyboard navigation, all three full-course modes, long Arabic sizing stress and sheet containment. New Scripture cases also measure page overflow and passage content width.

T3's native Chrome 154 independently verified `ar/rtl` Scripture, a 1,088px Grow inside a 1,088px panel, `en/ltr` Finder/Story/prayer portals over an Arabic document, Arabic prayer-close labeling, settled focus containment and focus return. See `native-browser.json`, `producer-localization.json`, `browser-first-results.json`, `browser-results.json` and the corresponding logs/artifact directories.

The repeated publication suite passes 60/60 cases with zero retries: six five-case cycles per viewport, including 12 genuine signed-in Partner cases. It uses a disposable local identity through the real hosted-Auth credential page, PKCE callback and actual Web session cookie. No authentication/publication route is mocked. Exact streamed tab labels/order, compact home roles, anonymous lock, published questions/ranking, draft sentinel isolation and session-free cached HTML remain asserted. After the final two neutral title boundaries, a fresh build receives another full ten-case publication smoke; its result is recorded below. The final title boundary tests first fail 2/2 and pass in the full final Web suite.

The fresh final build again passes localization 8/8 and geometry/deferred-resource 6/6. The final publication smoke passes all ten desktop/phone cases, including two additional genuine Partner cases, with zero retries. In total this round records 70 successful publication cases (14 genuine Partner cases); the 60-case repeated run preceded only the two neutral authored-title attributes. See `publication-results.json`, `publication-final-results.json`, both publication logs and the private-cookie-free hosted-roundtrip receipts.

The final full Web run passes 7,021 tests, including the two authored-title cases and both requested-language/passage-language mixed-validation-plus-server-error negative controls. Auth's dev process was stopped before performance sampling; its generated guide block was restored and its private server log removed.

## Controlled loading distributions

Exact-parent versus repaired production builds use native Chrome 154.0.8037.92, DPR 2, 1280×800 and 390×844 viewports, warm servers, fresh browser contexts, disabled browser caches and alternating AB/BA order. The transparent same-origin streaming proxy preserves RSC timing. Only Mux media is fulfilled locally through CDP: a fixed real poster after 50ms and explicitly unavailable playback (403). Two warmup entries per variant/cell were predeclared and remain in each raw corpus. Initial cells have 12 measured entries per variant. The original four-cell corpus remains intact.

The table reports **min / median / p90 / max**, in milliseconds. Video LCP is the poster IMG; home uses its actual final text LCP. Phone-home combines the original 12 and one predeclared 24-entry extension, without excluding the initial miss. The independent extension also passes before combination.

| Cell         | Variant |   n | Shell min/median/p90/max | LCP min/median/p90/max | Requests |
| ------------ | ------- | --: | ------------------------ | ---------------------- | -------: |
| home 1280px  | before  |  12 | 29.2/32.4/38.44/41.6     | 100/134/151.2/412      |       52 |
| home 1280px  | after   |  12 | 29.8/31.3/32.82/54.7     | 100/128/139.6/140      |       52 |
| video 1280px | before  |  12 | 27.1/32.3/38.5/41.3      | 108/118/135.2/384      |       57 |
| video 1280px | after   |  12 | 27.3/32/36.18/38.8       | 112/120/128/132        |       57 |
| home 390px   | before  |  36 | 26.1/32.4/38.75/52.4     | 72/92/122/380          |       52 |
| home 390px   | after   |  36 | 25.7/30/37.15/51.4       | 72/96/114/124          |       52 |
| video 390px  | before  |  12 | 27.1/30.2/38.83/44.8     | 88/98/107.6/124        |       62 |
| video 390px  | after   |  12 | 28.4/30.55/35.06/40.6    | 88/96/129.6/360        |       62 |

Every accepted cell meets the existing 10% median timing and 0.05 added-CLS budgets against the exact parent. Maximum measured CLS is unchanged per cell: desktop home 0.000496, desktop video 0.005481, phone home 0, phone video 0.000026. The phone-video repair retains a 360ms tail versus the parent's 124ms maximum despite its improved median; this is not a claim of identical tails.

**Initial phone-home miss and investigation:** the original 12-entry cell has shell 33.25→30.30ms and LCP 82→98ms (+19.51%), and remains recorded as a failed cell in `performance-budget.json`. Its LCP is the unchanged `SPAN.truncate` “Watch Now” text. In inspected initial samples, font/CSS resources completed around 20–43ms, poster resources around 68–77ms; no request failure explains the text-paint difference. Script duration is 157.05→156.66ms and layout 16.37→16.12ms. A same-build A/A control routes both labels to the repaired server, proves identical script sets, and produces 94/96ms medians with a 76–128ms range. One predeclared 24-entry parent/repair follow-up independently gives shell 32.4→29.2ms and LCP 92→96ms (+4.35%). Combining all 36 entries per variant gives shell 32.4→30.0ms and the same 92→96ms LCP (+4.35%). Both the independent follow-up and combined corpus meet budget; no sample, slow tail or original failure is discarded. The evidence is consistent with local text-paint variability, but does not prove a browser-internal cause. No performance code change or budget waiver was made.

The static chunk graph identifies every deferred implementation in each build. Across all measured entries, finder/course/story/Partner/Share implementation requests and audience/finder/progress requests remain absent on entry. Script request counts remain 31/40/31/41 for desktop-home/desktop-video/phone-home/phone-video, and initial prefetch destinations match per cell. Total request counts are unchanged. Median transferred-byte differences in this harness are +36B/+92B/+66B/+92B respectively; the CSS comparison finds only a 54-byte nonmatching utility emitted from the E2E locator string, with no removed rule. Existing session reads remain. Browser interaction suites positively verify deferred resources arrive on intent and navigation remains usable.

Receipts: `controlled-performance-results.json`, `phone-home-followup-results.json`, `perf-*.json`/logs, `performance-summary.json` (full distributions and raw vectors), `performance-audit.json` (resources, candidates, failures, long tasks, prefetches), `deferred-chunk-map.json` and `performance-budget.json`. `measure-perf-initial.mjs` preserves the original harness; the follow-up only adds bounded LCP identity/paint metadata and the explicit A/A port mapping. The A/A corpus is a diagnostic control, not parent data in the combined cell. Earlier main/external-media corpora remain separate and untouched.

## Boundaries and limitations

All runtime data is in owned disposable PostgreSQL databases on `127.0.0.1:55483`. Synthetic Arabic/Spanish/Urdu dubs and cached Scripture were added only to the new R3 fixture clone; the real producer returned Arabic/Spanish metadata and English fallback for Urdu without a provider fetch. The first fixture attempt hit an inherited synthetic French row using Spanish's Core ID; the test-only Spanish row now uses a distinct synthetic ID. No importer CLI or live publication endpoint ran.

Node 24.19.0 was available rather than the repository pin 24.22.1. Browser automation verifies DOM/accessibility-tree names, direction, focus and keyboard behavior; no human screen-reader audio session was performed. Local performance uses desktop-pointer contexts at both widths (the geometry suite separately exercises touch), is unthrottled and fixture-bound, not field or successful external-media playback clearance. The earlier external-media +10.34% sample and complete passing repeat remain in the retained R2 corpus; no sample is deleted or used to waive the budget.

The shared `forge.watch.audience` registry stays default-off. Only owned local test processes opt in. Docker packaging/path filters, importer guard, questionnaire locale handling, Grow grid track, streamed ordered publication expectations, category prefetch behavior and all #2782 concurrency/Auth/migration repairs remain intact. No production data, external config/flag, merge, deployment, publication or import action is part of this repair.

Durable lesson: derive content language from the selected source, including fallback, and place that boundary on the exact authored text. A React portal does not inherit language/direction from its logical component ancestor. Preserve translated nested controls independently when portal copy is English, and test the actual DOM under an RTL document.

## Exact R3 file scope

The repair changes these 30 files relative to the pinned parent:

```text
apps/admin/schema.graphql
apps/admin/src/graphql/types/video.ts
apps/admin/src/services/scripture-passage.service.test.ts
apps/admin/src/services/scripture-passage.service.ts
apps/web/e2e/watch-audience-localization.spec.ts
apps/web/src/components/ui/dialog.tsx
apps/web/src/components/watch/LanguagePickerModal.aliases.test.tsx
apps/web/src/components/watch/WatchFindFlow.test.tsx
apps/web/src/components/watch/WatchFindFlow.tsx
apps/web/src/components/watch/WatchFindLauncher.test.tsx
apps/web/src/components/watch/WatchFindLauncher.tsx
apps/web/src/components/watch/WatchGrow.test.tsx
apps/web/src/components/watch/WatchGrowLean.tsx
apps/web/src/components/watch/WatchGrowPrayer.test.tsx
apps/web/src/components/watch/WatchGrowPrayer.tsx
apps/web/src/components/watch/WatchGrowStory.test.tsx
apps/web/src/components/watch/WatchGrowStory.tsx
apps/web/src/components/watch/WatchGrowVerse.tsx
apps/web/src/components/watch/WatchRoleJourney.test.tsx
apps/web/src/components/watch/WatchShareKit.test.tsx
apps/web/src/components/watch/WatchShareKit.tsx
apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx
apps/web/src/components/watch/watch-passage-language.ts
apps/web/src/lib/content.ts
apps/web/src/lib/fragments/watch-video.ts
apps/web/src/lib/watch-unavailable-target.test.ts
docs/plans/2026-10-24-pr2783-review-round-3-localization.md
docs/reports/2026-10-24-pr2783-review-r3-validation.md
docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md
packages/admin-graphql/src/admin-graphql-env.d.ts
```
