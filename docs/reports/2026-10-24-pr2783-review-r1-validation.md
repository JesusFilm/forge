# PR #2783 review round 1 validation

Repair base: `7b9d30865e320ad178ab092604dc50dd829fe536`. The repair continues that exact editor stack with fast-forward commits; main's Grow concurrency, Auth, migration and schema repairs remain intact. feat-744 stays in progress pending review clearance.

Raw commands, red/green logs, distributions and image receipts are retained in `/home/lado/.local/share/forge-pr2783-r1-20261024/`. All databases and browser identities used here are disposable local fixtures. The importer CLI was never executed. No live content was published, external flag/config changed, production data written, merge performed or deployment triggered.

## Repairs and TDD

- Packaging: the dependency-closure regression failed on the missing feature-flags manifest and source copies, then passed. It checks every transitive Admin workspace dependency, both image workflow path filters and shared web/worker image ownership.
- Importer: the installed `pg.Client` parser reproduces the last-host override without opening a connection. The repaired guard rejects duplicate host keys (including encoded aliases), case-ambiguous keys and alternate selectors; explicit authority and any query override must both resolve to allowed loopback names/addresses or absolute local Unix sockets. Both dry and apply orchestration refuse before loading a DB client. The focused suite passes 88 tests.
- Localization: rendered Arabic/RTL, French/LTR, English fallback on Arabic pages and mixed English resources pass after carrying the producer's resolved source locale through the shared frame. Authored copy is unchanged. English code controls/resources have explicit language boundaries.
- Publication: the original E2E failed because compact home no longer contains a questionnaire. The replacement checks published home role navigation, video tabs outside the questionnaire, exact published questions/options/ranking, anonymous Partner locking and genuine hosted-Auth Partner access. An unpublished draft sentinel must stay out of the public projection and serialized HTML.
- Loading: three focused prefetch regressions failed before opting only the category rail out of eager desktop prefetch; nine tests pass afterward. Focus/mouse intent still arms individual links, touch scrolling does not, and navigation remains accessible. The existing hero posture stays intact.

## Validation

Passed commands use Node 24.19.0 locally; the actual Docker build uses the repository-pinned Node 24.22.1. Installs, builds and broad checks ran through `agent-io-guard`. Shared `/tmp` inode exhaustion interrupted the first broad run; subsequent task temporary files moved to the task evidence directory. Initial new-code lint/type findings were fixed and their full checks rerun. The first Web broad run also exposed harness-injected revalidation/canonical-origin values; the corrected run removes that pollution and fixes the preview fixture's Russian source-locale expectation.

| Check                      | Command / scope                                                                                                                         | Result                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Strict lint                | `pnpm --filter @forge/{admin,web,auth,experience-schema,admin-graphql} lint --max-warnings=0` (each package separately)                 | Passed                                                                                  |
| Full types                 | `pnpm --filter @forge/{admin,web,auth,experience-schema,admin-graphql} typecheck` (each separately; Admin includes 755 test roots)      | Passed                                                                                  |
| Admin scoped broad tests   | 35 editor/block/schema/config/projection/publication/importer/finder/progress service files, exact command in `validation-results.json` | 871 passed                                                                              |
| Auth broad tests           | `pnpm --filter @forge/auth run test --maxWorkers=1 --no-file-parallelism`                                                               | 660 passed, 106 environment-gated skips                                                 |
| Shared schema/client tests | Equivalent full test commands for experience-schema and admin-graphql                                                                   | 70 + 2 passed                                                                           |
| Disposable PostgreSQL      | All 162 migrations; audience publication/import, finder and learning-progress DB suites with their four explicit test flags             | 22 passed                                                                               |
| Schema/introspection       | Admin `schema:print`, admin-graphql `generate`, then `git diff --exit-code` for both generated outputs                                  | Passed, zero drift                                                                      |
| Production builds          | `pnpm --filter @forge/admin build`; Web equivalent with audience enabled only in the local build process                                | Passed                                                                                  |
| Actual Admin image         | `docker build -f apps/admin/Dockerfile -t admin-security-ci .` from repo root                                                           | Passed; image `sha256:6de9bc10d86f52ef68ffa38ea1a8fa3eae2a310effa0e7d7fb81338502aa69c8` |

Full Web validation passed: `pnpm --filter @forge/web run test --maxWorkers=1 --no-file-parallelism` ran 7,012 tests: 6,998 passed, 13 skipped and one todo across 347 passing files plus three skipped files. The separate strict E2E typecheck passed because Web's ordinary tsconfig excludes E2E. The feature-flags package passed all 23 tests, including the default-off audience registry check.

The actual image also passed the workflow's trust verification and isolated runtime contract: both web/worker predeploy commands, workflow PostgreSQL setup, actual web and worker startup, Redis/GraphQL readiness, anonymous dashboard/workflow denials, public schema reads, and shipped PostgreSQL18 client TLS dump/list/restore. See `image-results.json` and `image-web-worker-runtime.log`. Owned containers/network were removed afterward.

The final publication browser run passed all 10 desktop/390px cases in 55.3 seconds against the corrected real fixture. A disposable identity completed the actual hosted-Auth credential login and PKCE callback; the resulting real Web session was passed privately to the Partner test. No auth/publication routes were mocked. Final strict E2E lint/types and repository formatting are checked again before committing; hooks remain enabled.

## Loading evidence

The first corpus below used an inherited incomplete fixture: the homepage had a legacy fixed `VideoHero` and no catalog hero source, so the TV carousel rendered nothing. Real pointer interaction exposed the resulting overlap with the floating header. Those rows are retained as diagnostic evidence and do **not** clear the intended home composition. The corrected disposable fixture uses a schema-validated leading `watchHomeHero`, category rail and a real catalog source/dub; template canonical configuration and the unpublished draft sentinel remain byte-identical. E2E explicitly requires a visible TV carousel before asserting home behavior. Fresh matched measurements on this corrected fixture govern final clearance.

Compare exact main `02ecc6b`, pinned editor `7b9d308` and the repaired production build. Use the same native Chromium 154 incognito browser, 1280×800 and 390×800 CSS viewports, warmed servers, identical no-store/identity proxy instrumentation and a 3.5-second post-load observation window. The diagnostic corpus used one excluded warmup and five measured loads per initial cell; corrected-fixture sampling below supersedes it. The 390px viewport retains a desktop pointer; focused tests separately cover touch behavior.

Initial repaired desktop-home shell values are 20.4, 17.1, 20.3, 22.2 and 27.3ms (median 20.4ms), versus main's 24.0, 19.4, 19.9, 22.2 and 17.0ms (median 19.9ms): +2.5%. The review's 22.1ms/19.3ms median gap did not reproduce in this matched sample. The causal prefetch change does reproduce: pinned editor home starts eight desktop/four compact route prefetches per load; repaired home starts zero, with total initial requests reduced from 66 to 58 desktop and 62 to 58 compact. The original rows remain retained.

Compact home LCP (80ms versus 72ms) and compact video shell (19.7ms versus 16.4ms) cross the initial percentage threshold. Extended interleaved controls, with all original samples retained, are required before clearance.

These unthrottled loopback measurements establish local shell/loading behavior, not field Web Vitals or successful playback. External Mux responses include 403s, cross-origin transfer sizes are unavailable, and recommendation requests through the port-changing proxy are rejected consistently across controls. Existing recommendation writes are distinguished from prohibited eager audience/learning/finder writes.

## Corrected-fixture loading clearance

Exact main `02ecc6be8d34af143e5975156b78d2e46a9e3406`, exact pre-fix `7b9d30865e320ad178ab092604dc50dd829fe536` and candidate production builds share one database fixture, Chrome 154 incognito tab, port-changing no-store/identity proxy, viewport and instrumentation. Each cell has one excluded warmup and seven measured reloads, rotating the order of all three builds. The near-threshold compact-home result triggered a fixed seven additional loads per build, declared before collecting that extension; all original loads remain included (n=14). There is no CPU/network throttling. Shell readiness is the first DOM appearance of the actual TV-carousel/player wrapper; LCP is the final candidate in the fixed 3.5-second window. These are local readiness measurements, not successful-playback timings.

The corrected fixture has the intended `watchHomeHero`, eligible TV-carousel catalog source, trailer and English HLS dub. Hashes before/after fixture correction prove published template configuration and the unpublished draft sentinel unchanged; only disposable catalog/composition fixtures were repaired. See `correct-home-fixture-final.log`. The final E2E requires the actual TV carousel to be visible.

| Route / width | Variant      | n   | Shell values (ms)                                                                  | Shell median | LCP values (ms)                                             | LCP median | CLS median / max  | RSC requests                             |
| ------------- | ------------ | --- | ---------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------- | ---------- | ----------------- | ---------------------------------------- |
| home / 1280   | main-02ecc6b | 7   | 27.5, 26.0, 25.3, 32.8, 22.6, 25.7, 23.3                                           | 25.7         | 220, 228, 224, 188, 252, 200, 260                           | 224        | 0.00000 / 0.00000 | 3, 3, 3, 3, 3, 3, 3                      |
| home / 1280   | before-7b9   | 7   | 28.8, 32.5, 32.4, 30.0, 28.5, 24.9, 27.6                                           | 28.8         | 188, 228, 200, 228, 204, 192, 196                           | 200        | 0.00050 / 0.00050 | 11, 11, 11, 12, 11, 11, 11               |
| home / 1280   | after        | 7   | 24.1, 26.3, 25.1, 26.0, 23.5, 24.0, 25.2                                           | 25.1         | 216, 164, 288, 220, 192, 220, 204                           | 216        | 0.00050 / 0.00050 | 3, 3, 3, 3, 3, 3, 3                      |
| video / 1280  | main-02ecc6b | 7   | 28.2, 18.4, 19.8, 20.7, 20.5, 15.3, 25.3                                           | 20.5         | 88, 68, 80, 68, 72, 76, 76                                  | 76         | 0.00000 / 0.00000 | 1, 1, 1, 1, 1, 1, 1                      |
| video / 1280  | before-7b9   | 7   | 30.4, 25.4, 21.1, 24.3, 24.2, 24.5, 16.1                                           | 24.3         | 104, 104, 80, 96, 88, 76, 68                                | 88         | 0.00550 / 0.00550 | 1, 1, 1, 1, 1, 1, 1                      |
| video / 1280  | after        | 7   | 23.8, 28.1, 20.8, 19.8, 22.0, 18.8, 22.9                                           | 22           | 84, 92, 84, 76, 76, 64, 68                                  | 76         | 0.00550 / 0.00550 | 1, 1, 1, 1, 1, 1, 1                      |
| home / 390    | main-02ecc6b | 14  | 19.2, 21.8, 19.2, 24.1, 18.9, 17.0, 16.8, 28.6, 20.9, 23.3, 28.8, 26.9, 25.1, 20.8 | 21.35        | 80, 72, 88, 120, 76, 72, 68, 124, 80, 96, 100, 120, 100, 80 | 84.0       | 0.00000 / 0.00000 | 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 3 |
| home / 390    | before-7b9   | 14  | 19.4, 18.9, 22.3, 19.3, 22.9, 18.0, 17.5, 20.7, 28.0, 24.8, 30.6, 26.3, 26.7, 19.8 | 21.5         | 76, 68, 88, 68, 68, 96, 76, 76, 92, 104, 108, 112, 72, 104  | 82.0       | 0.00000 / 0.00000 | 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4 |
| home / 390    | after        | 14  | 20.6, 17.6, 23.2, 19.9, 14.7, 19.1, 15.2, 21.1, 27.6, 33.2, 27.6, 30.7, 18.8, 20.8 | 20.7         | 80, 64, 84, 80, 68, 76, 68, 84, 100, 96, 120, 100, 80, 88   | 82.0       | 0.00000 / 0.00000 | 3, 3, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3 |
| video / 390   | main-02ecc6b | 7   | 27.0, 23.9, 19.1, 24.9, 20.9, 27.4, 18.2                                           | 23.9         | 52, 56, 56, 72, 52, 56, 48                                  | 56         | 0.00000 / 0.00000 | 1, 1, 1, 1, 1, 1, 1                      |
| video / 390   | before-7b9   | 7   | 21.5, 29.7, 18.8, 18.0, 20.6, 18.6, 28.7                                           | 20.6         | 64, 64, 64, 52, 60, 52, 56                                  | 60         | 0.00000 / 0.00000 | 1, 1, 1, 1, 1, 1, 1                      |
| video / 390   | after        | 7   | 20.8, 20.4, 21.6, 19.0, 30.0, 19.7, 24.5                                           | 20.8         | 56, 56, 52, 52, 68, 48, 60                                  | 56         | 0.00000 / 0.00000 | 1, 1, 1, 1, 1, 1, 1                      |

Relative to main, candidate shell medians change by −2.34% (desktop home), +7.32% (desktop video), −3.04% (compact home) and −12.97% (compact video). LCP medians change by −3.57%, 0%, −2.38% and 0%, respectively. Maximum added CLS is 0.00050 on desktop home and 0.00550 on desktop video; compact differences are below 0.00001. All cells satisfy the stack plan's 10% median timing / 0.05 added-CLS investigation budget; none is waived. The 33.2ms compact-home candidate outlier is retained.

The eager-link mechanism reproduces on the corrected composition: desktop-home route-prefetch counts fall from 11 (one load 12) to 3, matching main's 3. Compact home falls from 4 to 3. Existing hero prefetch remains. The repaired E2E additionally scrolls the category into view without intent, proves no category request, then focuses it, proves prefetch, and navigates with Enter. Browser-requested immutable script sources exclude Grow course, Partner tools and Share modules initially; Share has a positive intent-load control. Every script source read must succeed.

| Cell       | Main / repaired request medians | Main / repaired measured byte medians |
| ---------- | ------------------------------- | ------------------------------------- |
| Home 1280  | 52 / 53                         | 3,540,584 / 3,574,794                 |
| Video 1280 | 49 / 51                         | 3,656,825 / 3,717,813                 |
| Home 390   | 52 / 53                         | 3,458,398 / 3,492,572                 |
| Video 390  | 61 / 63                         | 3,649,127 / 3,710,091                 |

Bytes are browser-measured resource-size totals, with cross-origin visibility limitations. Raw `perf-corrected-*.json` rows and `corrected-performance-summary.json` retain request, byte, TTFB, LCP, CLS, long-task and write-path observations for every load. Long tasks occur in the samples; this is not a zero-long-task claim. Observed initial writes are existing recommendation endpoints; compact video also records a third-party `/` path without host attribution. No eager audience, learning-progress or finder writes occur. The direct E2E encounters recommendation admission 503 because the fixture has no recommendation worker; proxy-origin recommendation requests consistently receive 403 across builds. These are fixture server limitations, not accepted recommendation-coverage outcomes.

## Interaction mount smoke

The compiled-chunk audit (`deferred-chunk-audit.json`) compares actual requested URLs in all 35 repaired measured initial entries against built implementation chunks for finder, course, story, Partner and Share. All five implementations exist in the production output and none was initially requested. The finder probe distinguishes its actual questionnaire (`data-step`) from the lightweight loading/error shell, which shares the overlay test ID and is present in the ordinary video bundle.

Native-browser genuine clicks mounted the finder, course sheet and story at both widths. Capture-phase click timestamps and a DOM MutationObserver measured the actual target's appearance. Finder shell: 9.8ms desktop / 8.0ms compact; course sheet: 4.9ms / 3.4ms; story cover: 29.8ms / 26.6ms. These are individual mount smoke observations, not distributions or comparative performance clearance. Desktop course-sheet timing is a warm reopen; its first open recorded a 71ms long task. The initial desktop course observer incorrectly expected a dialog, while the current full shelf uses an inline sheet; that incomplete row is retained and excluded from timing claims. Measured successful mounts added no CLS or learning-progress writes. No lessons were finished and no reflections were submitted.

`mount-native-results.json` retains those observations. One navigation transport failure and two consequent selector timeouts were excluded; corrected navigation succeeded. The 390px viewport retains a desktop pointer, with real touch semantics separately pinned by unit tests. External Mux 403s prevent successful-playback clearance. The initial-entry matched corpus, rather than these one-off mounts, supplies the loading budget decision.

## Exact validation receipts

`validation-results.json` contains each invoked command, exit status and duration, including failed initial attempts and successful retries. `validation-resume.log`, `web-tests-clean-retry.log`, `image-results.json`, `image-verification.log` and `publication-e2e-corrected.log` supply the successful broad receipts. The Docker system socket was inaccessible; an isolated task-owned rootless daemon executed the exact CI build/context and all web/worker image contracts successfully, without changing system Docker configuration.

The 35-file Admin command was:

```bash
pnpm --filter @forge/admin run test \
  src/app/dashboard/experiences/experience-editor.test.tsx \
  src/app/dashboard/experiences/experience-editor/watch-home-category-rail-editor.test.tsx \
  src/app/dashboard/experiences/experience-editor/image-picker-folder-browser.test.tsx \
  src/app/dashboard/experiences/experience-editor/watch-home-category-rail-tiles.test.ts \
  src/app/dashboard/experiences/experience-editor/experience-chat-stream-client.test.ts \
  src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx \
  src/app/dashboard/experiences/experience-editor/chat-rating.test.tsx \
  src/app/dashboard/experiences/experience-editor/bible-quote-card.test.tsx \
  src/app/dashboard/experiences/experience-editor/image-picker-browser.test.tsx \
  src/app/dashboard/experiences/experience-editor/anchor-video-picker.test.tsx \
  src/app/dashboard/experiences/experience-editor/experience-chat-errors.test.ts \
  src/app/dashboard/experiences/experience-editor/watch-audience-editor.test.tsx \
  src/app/dashboard/experiences/experience-editor/block-helpers.test.ts \
  src/app/dashboard/experiences/experience-editor/experience-chat-suggested-prompts.test.ts \
  src/app/dashboard/experiences/experience-editor/watch-audience-availability.test.ts \
  src/domain/blocks.test.ts \
  src/domain/watch-audience.test.ts \
  src/graphql/schema.test.ts \
  src/lib/feature-flags.test.ts \
  src/graphql/types/watch-film-finder.test.ts \
  src/graphql/types/watch-audience.test.ts \
  src/scripts/probe-experience-editor-video-data.test.ts \
  src/graphql/types/watch-learning-progress.test.ts \
  src/graphql/types/watch-setting.test.ts \
  src/graphql/types/blocks.test.ts \
  src/scripts/import-watch-audience-config.test.ts \
  src/services/experience-preview.service.test.ts \
  src/services/watch-audience-projection.test.ts \
  src/services/watch-setting-audience.test.ts \
  src/services/watch-learning-progress.service.test.ts \
  src/services/watch-film-finder.service.test.ts \
  src/services/experience.service.test.ts \
  src/services/experience-editor-video.service.test.ts \
  src/services/watch-audience-write-gate.test.ts \
  src/services/watch-setting.service.test.ts \
  --maxWorkers=1 \
  --no-file-parallelism
```

The disposable PostgreSQL command (with a loopback-only disposable `DATABASE_URL`) was:

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

Focused guard tests: `node --test apps/admin/scripts/docker-workspace-packaging.test.mjs` (2), Admin `src/scripts/import-watch-audience-config.test.ts` (88), Web `WatchAudienceBlock.test.tsx`, `watch-audience-content.test.ts` and `WatchHomeCategoryRail.prefetch.test.tsx` (including Arabic/French/fallback/mixed resources and 9 prefetch cases). Broad checks cover their full consuming packages as recorded above. The production publication command is `pnpm --filter @forge/web exec playwright test -c <local-fixture-config> watch-audience-config.spec.ts --timeout 45000`, launched by `auth-e2e.mjs` with the genuine local session supplied only in child memory.

## Scope audit

No Auth source, Prisma schema/migration, generated GraphQL output, shared feature-flag definition or learning-progress concurrency implementation changed. The shared registry still defines `forge.watch.audience` with `defaultValue: false`; only owned local test processes enable it.

Exactly 24 repair files relative to the pinned head:

- `.github/workflows/admin-security-image.yml`
- `apps/admin/Dockerfile`
- `apps/admin/scripts/docker-workspace-packaging.test.mjs`
- `apps/admin/src/scripts/import-watch-audience-config.test.ts`
- `apps/admin/src/scripts/import-watch-audience-config.ts`
- `apps/web/e2e/watch-audience-config.spec.ts`
- `apps/web/src/app/(preview)/preview/experience/[token]/page.test.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/page.test.tsx`
- `apps/web/src/components/home/WatchHomeCategoryRail.tsx`
- `apps/web/src/components/home/WatchHomeRoleBand.tsx`
- `apps/web/src/components/home/__tests__/WatchHomeCategoryRail.prefetch.test.tsx`
- `apps/web/src/components/home/useTouchGatedPrefetch.ts`
- `apps/web/src/components/watch/WatchAudienceBlock.test.tsx`
- `apps/web/src/components/watch/WatchAudienceBlock.tsx`
- `apps/web/src/components/watch/WatchNextSteps.tsx`
- `apps/web/src/components/watch/WatchRoleJourney.tsx`
- `apps/web/src/components/watch/WatchSectionRenderer.tsx`
- `apps/web/src/lib/watch-audience-config.ts`
- `apps/web/src/lib/watch-audience-content.test.ts`
- `apps/web/src/lib/watch-audience-content.ts`
- `docs/plans/2026-10-24-pr2783-review-round-1-repairs.md`
- `docs/reports/2026-10-24-pr2783-review-r1-validation.md`
- `docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md`
