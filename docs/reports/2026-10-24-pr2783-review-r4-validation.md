# PR #2783 round 4: content titles and controlled loading

Repair starts from exact remote `9635a6e759ac93f4287c095ed6d3a2e207c049aa`. The initial local HEAD, remote branch and clean-tree checks matched. Performance compares the repaired production build with exact main `02ecc6be8d34af143e5975156b78d2e46a9e3406`.

## Content boundary repair and sibling audit

`WatchGrowLean` now gives the selected series and next-episode title their own `lang="" dir="auto"` spans. These title contracts contain strings without the selected title's source locale. Audio/UI language cannot establish title language because the real producer can return English titles for another audio language. A neutral language boundary avoids making an unsupported language claim; automatic direction follows the actual title. “Tomorrow:”, episode counts, “Keep going” and navigation remain English. Nullish fallback and authored copy are preserved.

The independent sibling audit found the same issue in the Share introduction, inline film-kit heading, and Partner download active/pending titles. These exact title boundaries receive the same treatment. The already-neutral Finder and printed Share titles remain intact. Grow lesson/plan titles, Share resource titles and Partner editorial resources are authored English; their English boundaries remain. Native language labels, localized download/share/language dialogs, selected Scripture metadata, translated dialog controls and questionnaire source locales retain their independent semantics. Canvas/native-share data has no DOM language boundary to change.

No schema, generated output, migration, config, flag, importer, Docker or learning-progress implementation changes are part of this round.

## Falsification and automated checks

Rendered title regressions first failed against the parent components: nine failures in Grow/Share suites and three in Partner. The final held-HEAD Partner control fails three tests against the old component and passes 18/18 with the repair. Holding the first download HEAD request makes the active-state assertion deterministic; an initial harness attempt inspected that state after it had already completed and is retained in the receipts. The six new production continuation/Share browser cases also fail against the exact parent on missing title boundaries.

| Validation                                                                      | Result                                                                                 |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Full Web tests                                                                  | 7,033 passed; 13 environment skips; one todo; 347 passing files                        |
| Relevant Admin editor/config/schema/publication/importer/finder/progress suites | 896 passed across 37 files                                                             |
| Full Auth tests                                                                 | 660 passed; 106 environment-gated skips                                                |
| experience-schema / admin-graphql / feature-flags                               | 70 / 2 / 23 passed                                                                     |
| Disposable PostgreSQL publication/import/finder/learning-progress suites        | 22/22 passed; no skips                                                                 |
| Fresh migration lineage                                                         | All 168 applied; migration status clean; migration files identical to main             |
| Strict lint and types                                                           | Web/Admin/Auth/experience-schema/admin-graphql passed; separate E2E lint/types checked |
| Production builds                                                               | Admin, repaired Web, exact-main Web and exact-parent Web passed                        |
| Schema print and admin-graphql generate                                         | Passed with zero SDL/introspection drift                                               |
| Admin image packaging/filter safeguards                                         | 2/2 passed; every transitive workspace dependency and shared web/worker image checked  |

Broad commands use `pnpm --filter <package> run test --maxWorkers=1 --no-file-parallelism`, strict `lint --max-warnings=0`, and `typecheck`. Exact file selections, commands, statuses and durations are retained in the evidence JSON listed below. Database suites use their four explicit opt-ins against an owned disposable loopback database. Their first attempt correctly refused a database name lacking the required `_test_` marker; the same fresh database was renamed to satisfy the guard. No bypass was added. The first broad Web attempt inherited preview-only revalidation/origin values; removing those values from the unit-test environment yielded the full passing run without an application change.

Schema verification runs `pnpm --filter @forge/admin schema:print`, `pnpm --filter @forge/admin-graphql generate`, then `git diff --exit-code -- apps/admin/schema.graphql packages/admin-graphql/src/admin-graphql-env.d.ts`. Generated files are never hand-edited.

The R1 production image build/runtime proof remains applicable to unchanged Docker/package/filter inputs: [R1 report](2026-10-24-pr2783-review-r1-validation.md). This round reruns the closure/path-filter/shared-image safeguards and importer tests; it does not claim a fresh Docker image build.

## Browser, accessibility and publication

The final localization suite covers Arabic titles, English titles, and a real Urdu dub with English-only title fallback at 1280px and 390px. It asserts the actual document language, neutral title attributes, computed title direction, surrounding English labels/counts, accessible heading/link names, keyboard continuation navigation, Share-kit Escape and return focus. Retained cases cover Arabic/Spanish Scripture, English fallback, English portals under an Arabic document, translated nested controls, focus containment and Story keyboard navigation. Local HLS fixtures also prove decoded playback and advancing media time on both widths.

The first media check clicked an aria-hidden decorative surface whose center is covered by the phone overlay. It timed out without a product failure. The corrected test uses the actual accessible “Watch now” button; the failed receipt is retained. The six retained geometry/resource cases measure the actual grid/content widths, last-card access and carousel controls in lean/full/solo/group/leader modes, including long Arabic content and touch/keyboard behavior.

Final strengthened-fence production-browser results: localization 16/16 and geometry/resource checks 6/6. All 60 publication cases pass with zero retries (six five-case cycles per viewport), including 12 genuine signed-in Partner cases. A disposable credential identity traverses the actual hosted Auth login and PKCE callback; its real Web session is passed privately to the suite. Exact published labels/order, questions/ranking, protected Partner resources, public projection, draft isolation, cached HTML and deferred resources/writes remain asserted. The new credential identity is removed afterward; inherited template fixtures remain unchanged. Auth stops and its private raw server log is removed before performance sampling.

## Telemetry-safe loading methodology

All browser integration specs use a shared test-only network boundary. It blocks every external request except GET media fulfilled from local fixture bytes, including Mux Data, analytics scripts/beacons and external POSTs. It also blocks first-party recommendation measurement endpoints while preserving genuine content delivery, auth and publication contracts. Service workers are disabled. The production-build action manifest supplies the Watch-event action IDs; guessed hashes and blanket auth-action interception are avoided. Each case attaches the blocked host/path/method and local-media receipt, omitting credentials/query data; response peer checks reject actual external connections. The local hosted-Auth flow uses the same boundary.

Evidence-only server preload code blocks nonloopback TCP, shared local telemetry ports 8125/8126 and UDP sends. Services were restarted after the audit identified local-agent traffic as an additional telemetry boundary. This is process-local test instrumentation, not a production config/analytics change. No live external-media corpus is run. The poster and valid eight-second HLS manifest/segment are served locally at their normal media URLs; actual player decoding is tested separately.

The method was declared before sampling in `performance-method.json`: identical production mode/environment/producer and same-origin streaming proxy; fixed Chrome 154.0.8037.92/DPR 2; fixed browser CPU affinity 20–27; fresh contexts, cache disabled and service workers blocked. Eight warmup loads per variant/cell remain in the raw corpus. Seeded balanced ABBA/BAAB order controls drift. Every measured load has a 3,500ms observation window. No final-cohort measured sample or outlier is excluded; changed-policy diagnostics remain separate and fully retained below.

Cells: phone-home CPU 1 and CPU 4, 64 measured loads per build each; same-build phone-home A/A, 32 per label; desktop-home, desktop-video and phone-video, 32 per build each; independent full-document phone-home replay, 64 per build. The replay serves each build's captured anonymous production HTML and actual static assets from memory with a fixed 10ms response delay; real hydration/player/session work remains. It separates SSR/streaming variance from client work and stays distinct from streaming results.

Receipts include shell readiness, every LCP candidate/identity and image resource timing, TTFB, paint, long tasks, script/layout work, requests/prefetches/chunks, storage mutation keys and network methods. Budget: median shell/LCP no more than 10% above exact main, added median CLS no more than 0.05, plus absence of initial deferred audience implementations and audience/finder/progress requests/writes. Distribution and paired block-bootstrap uncertainty are reported below; same-build variability is evidence, never a threshold waiver.

Ten diagnostic warmups were retained separately before any measured sampling: an overly broad POST audit needed to distinguish the pre-existing recommendation profile `action=status` read from telemetry and product writes. The final corpus records that action without request values, blocks measurement POSTs, and rejects any other initial unblocked same-origin write. Existing feedback/carousel storage keys are recorded separately from deferred audience/progress state. No measured load was dropped for this correction.

The final seven cells contain 640 measured loads (576 A/B plus 64 same-build A/A) and 112 retained warmups. Every final measured load and outlier remains in its declared cohort. All six A/B cells meet the primary 10% median shell/final-LCP and 0.05 added-CLS budgets against exact main. Additional image-candidate and matched phone-home “Watch Now” text-paint checks also pass. No production performance code change or threshold waiver was needed.

| Cell              | Loads/build | Shell ms, main → repair | Change  | Final LCP ms, main → repair | Change  | Median CLS, main → repair |
| ----------------- | ----------- | ----------------------- | ------- | --------------------------- | ------- | ------------------------- |
| phone home        | 64          | 45 → 45.35              | 0.778%  | 554 → 556                   | 0.361%  | 0 → 0                     |
| phone home CPU4   | 64          | 138.45 → 143.05         | 3.322%  | 1648 → 1656                 | 0.485%  | 0 → 0                     |
| phone home A/A    | 32          | 44.9 → 44.85            | -0.111% | 558 → 548                   | -1.792% | 0 → 0                     |
| desktop home      | 32          | 45.2 → 45.7             | 1.106%  | 682 → 660                   | -3.226% | 0 → 0.0004999             |
| desktop video     | 32          | 39.35 → 40.6            | 3.177%  | 152 → 152                   | 0%      | 0.0000107 → 0.0054812     |
| phone video       | 32          | 38.8 → 40.15            | 3.479%  | 136 → 140                   | 2.941%  | 0.0060908 → 0.0000262     |
| phone home replay | 64          | 40.6 → 41.45            | 2.094%  | 540 → 536                   | -0.741% | 0 → 0                     |

A/A labels both refer to the candidate, not main. Successful local HLS gives home a final VIDEO LCP candidate; the earlier text candidate is audited separately so media timing cannot hide the original phone-home objection. Video-page final LCP is the poster IMG. Raw receipts retain every candidate and image response-to-render timing.

Distributions below are **min / median / p90 / p95 / max**, in milliseconds; no tail is trimmed.

| Cell              | Variant | Shell distribution                        | Final LCP distribution               |
| ----------------- | ------- | ----------------------------------------- | ------------------------------------ |
| phone home        | before  | 40.3 / 45 / 51.05 / 53.48 / 60.1          | 444 / 554 / 582.8 / 659.4 / 688      |
| phone home        | after   | 41.3 / 45.35 / 52.48 / 55.325 / 69.7      | 468 / 556 / 582.8 / 592 / 684        |
| phone home CPU4   | before  | 106.2 / 138.45 / 147.64 / 153.425 / 157.2 | 1564 / 1648 / 1693.6 / 1706.8 / 1752 |
| phone home CPU4   | after   | 124 / 143.05 / 155.11 / 159.03 / 169      | 1604 / 1656 / 1698.8 / 1715.4 / 1788 |
| phone home A/A    | before  | 41.8 / 44.9 / 49.69 / 50.125 / 51.9       | 532 / 558 / 576 / 579.6 / 604        |
| phone home A/A    | after   | 41.2 / 44.85 / 48.87 / 50.18 / 54.9       | 484 / 548 / 572 / 573.8 / 580        |
| desktop home      | before  | 43 / 45.2 / 51.7 / 52.515 / 59.5          | 576 / 682 / 740 / 770.4 / 792        |
| desktop home      | after   | 42.7 / 45.7 / 49.96 / 51.585 / 55.2       | 616 / 660 / 731.6 / 733.8 / 744      |
| desktop video     | before  | 38.1 / 39.35 / 57.62 / 59.295 / 61.8      | 140 / 152 / 172 / 172 / 172          |
| desktop video     | after   | 38.9 / 40.6 / 57.84 / 64.225 / 77.6       | 136 / 152 / 176 / 188 / 448          |
| phone video       | before  | 37.1 / 38.8 / 41.56 / 47.68 / 58.3        | 124 / 136 / 143.6 / 152 / 156        |
| phone video       | after   | 38.2 / 40.15 / 43.89 / 62.905 / 66        | 132 / 140 / 144 / 144 / 152          |
| phone home replay | before  | 39.2 / 40.6 / 43.07 / 43.555 / 45.1       | 516 / 540 / 562.8 / 564 / 568        |
| phone home replay | after   | 39.6 / 41.45 / 43.44 / 44.27 / 45.3       | 524 / 536 / 560 / 564 / 580          |

The original independent phone-home report was 100→116ms (+16%) across 33 samples/build. These controls do not attribute that result to code: identical-build A/A itself produces a substantial early text-paint difference. The successful-media, CPU4 and replay cells separately clear their budgets. The supplementary first-text audit uses the same “Watch Now” identity on phone-home; intermediate text candidates on other pages can be absent or refer to different authorized content and remain descriptive.

| Matched phone-home text | Main → repair ms | Change   | 95% block-bootstrap ratio interval |
| ----------------------- | ---------------- | -------- | ---------------------------------- |
| phone home              | 148 → 120        | -18.919% | -21.622 to 10.345%                 |
| phone home CPU4         | 874 → 876        | 0.229%   | -0.228 to 0.917%                   |
| phone home A/A          | 148 → 130        | -12.162% | -21.918 to 2.778%                  |
| phone home replay       | 104 → 104        | 0%       | 0 to 0%                            |

Conditional uncertainty uses 5,000 seeded paired block-bootstrap resamples of the balanced two-round blocks. It is not a field-performance guarantee or a claim of identical tails.

The retained desktop-video candidate maximum is 448ms versus main's 172ms. In that paired round, the identical poster bytes finish transfer at 91.4ms versus 92.5ms, but image readiness is 379.8ms versus 94.7ms and paint 448ms versus 156ms. Recorded longest main-thread tasks are 68ms versus 75ms; total script work is 223.6ms versus 219.4ms. This localizes the large gap after successful network completion, without a corresponding large measured JavaScript task; it does not establish the decoder/compositor scheduling cause. `HeroPlayer.tsx` is identical to exact main. The outlier is retained, no external-media failure is used to explain it, and identical tails are not claimed. Desktop-video's 0% median LCP change passes the declared budget, while its conditional 95% interval still extends to +10.81%; the phone-home CPU4/replay controls give tighter evidence for the actual round-4 objection.

| Cell              | Shell ratio 95% interval | Final-LCP ratio 95% interval |
| ----------------- | ------------------------ | ---------------------------- |
| phone home        | -1.424 to 2.444%         | -1.079 to 1.449%             |
| phone home CPU4   | 1.407 to 4.625%          | -0.242 to 0.972%             |
| phone home A/A    | -4.167 to 2.477%         | -3.546 to 0.365%             |
| desktop home      | -1.758 to 4.222%         | -5.714 to 0.604%             |
| desktop video     | 0.126 to 6.033%          | -11.768 to 10.811%           |
| phone video       | 1.633 to 4.713%          | 0 to 5.882%                  |
| phone home replay | 0.98 to 2.723%           | -2.206 to 0.746%             |

The final resource audit maps actual compiled implementations for Finder, course, Story, Partner and Share in both builds (nonempty mappings), and observes zero initial requests for those implementations and zero audience/finder/learning-progress requests or storage writes. Existing feedback/carousel/viewer-ID storage remains recorded; no other unblocked initial same-origin write is allowed beyond the existing functional profile-status and recommendation-delivery POST reads. Those matched local proxy reads receive admission 403 responses; they are not mocked, and this controlled anonymous fixture does not claim personalized-delivery health. Genuine auth/publication contracts are validated separately on their real local origin.

Prefetch sets, request counts/bytes, script/layout/task distributions, image resource timing and every blocked request are in `performance-audit.json` and `performance-summary.json`. The unchanged hero trailer prefetch is distinguished from prohibited eager category loading. All final media responses are successful and every external response-peer list is empty. Mux Data POSTs to `inferred.litix.io` are observed and aborted; no external POST reaches a peer. Actual-build Watch-event action IDs, first-party playback/measurement endpoints and shared local telemetry-agent ports are fenced, while media, content delivery, auth and publication remain real.

Retained policy diagnostics are separate cohorts, not silently discarded outliers. The initial ten profile-audit loads were warmups only. The pre-playback-fence desktop-video cohort has 64 measured loads plus 16 warmups; the interrupted phone-video cohort has three measured loads plus 16 warmups. The audit found the unblocked first-party playback request, so both video cells were repeated in full under the required stronger policy regardless of their earlier timing results. Every earlier load remains in `diagnostic-playback-*`; all four completed home cells were checked and contain neither the added playback request nor a Watch-event action, so the stricter policy cannot alter those completed cohorts.

| Retained pre-policy diagnostic          | Variant | Measured n | Shell min/median/p90/p95/max       | LCP min/median/p90/p95/max  |
| --------------------------------------- | ------- | ---------- | ---------------------------------- | --------------------------- |
| desktop video                           | before  | 32         | 38.1 / 39.1 / 46.65 / 49.65 / 53.4 | 136 / 144 / 168 / 172 / 188 |
| desktop video                           | after   | 32         | 39.1 / 40.1 / 51.28 / 56.88 / 64   | 140 / 148 / 176 / 180 / 184 |
| phone video (interrupted; no inference) | before  | 1          | 39.1 / 39.1 / 39.1 / 39.1 / 39.1   | 128 / 128 / 128 / 128 / 128 |
| phone video (interrupted; no inference) | after   | 2          | 39.4 / 39.6 / 39.76 / 39.78 / 39.8 | 144 / 144 / 144 / 144 / 144 |

## Evidence and limitations

Local retained evidence: `/home/lado/.local/share/forge-pr2783-r4-20261024/`. This includes `title-red.log`, held-HEAD Partner red/green logs, `localization-browser-red.log`, broad/build/browser result JSON, full test logs, `safeguards.json`, migration status/count, sanitized hosted-Auth receipts, performance method/raw samples/summary/audit/budget and the measurement scripts. Earlier R1/R2/R3 corpora remain intact, including the independent objections and failed/tail samples; this round does not rewrite their history.

Local Node is 24.19.0 rather than the repository pin 24.22.1. Browser assertions cover DOM/accessibility semantics, direction, focus and keyboard behavior; no human screen-reader audio session was performed. Controlled fixture measurements establish local comparative behavior, not field performance or live external-media reliability. Phone-width performance uses a desktop-pointer context; the separate geometry suite exercises touch. Same-build variability, confidence intervals and tail distributions must be read alongside medians.

The registry `forge.watch.audience` remains default-off; only owned local test processes opt in. Safeguards compare Docker/workflow/importer/registry and Grow identity-fence/reset files with the exact parent, and learning services/transport plus all 168 migration files with exact main. Disposable DB cases retain concurrency, ownership, reset, erasure and resume contracts. No importer CLI, live publish/import endpoint, external configuration change, deployment, merge or production mutation runs.

After all repaired-scope validation passed on 2026-10-25, feat-744 was marked complete. Historical in-progress notes remain intact; PR review/merge and rollout are separate.

## Exact round-4 files

```text
apps/web/e2e/watch-audience-config.spec.ts
apps/web/e2e/watch-audience-localization.spec.ts
apps/web/e2e/watch-audience-test.ts
apps/web/e2e/watch-grow-layout.spec.ts
apps/web/src/components/watch/WatchGrow.test.tsx
apps/web/src/components/watch/WatchGrowLean.tsx
apps/web/src/components/watch/WatchPartnerDownloadTools.test.tsx
apps/web/src/components/watch/WatchPartnerDownloadTools.tsx
apps/web/src/components/watch/WatchShareIdeas.test.tsx
apps/web/src/components/watch/WatchShareIdeas.tsx
apps/web/src/components/watch/WatchShareKit.test.tsx
apps/web/src/components/watch/WatchShareKit.tsx
docs/plans/2026-10-24-pr2783-review-round-4-title-localization.md
docs/reports/2026-10-24-pr2783-review-r4-validation.md
docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md
```
