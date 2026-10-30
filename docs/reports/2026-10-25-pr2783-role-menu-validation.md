# PR #2783: role-menu language and keyboard repair

Exact parent/lease: `fd7883f0bf30000c938c7c53216ac3c4ce088a39`. Remote matched before work. The deterministic lazy-import repair and every earlier runtime repair remain intact. feat-744 stays complete; the audience registry default remains false.

## Findings and implementation

`WatchRoleChip` inherited its document's language/direction even though its labels, hints and shortcut titles came from the selected published configuration. The shared presence registration discarded that configuration's source locale. Both the video (`WatchNextSteps`) and compact home (`WatchHomeRoleBand`) now register the resolved source locale. The chip's authored spans, radio items and shortcut declare that locale/direction; missing provenance uses `lang="" dir="auto"`. Audio language is used only for destination URLs. English menu chrome has its own English/LTR boundary. The trigger's accessible name references both the English prompt and the authored selected chip, including at the compact breakpoint where the chip is visually hidden.

The previous menu declared menu/radio semantics but only toggled its visibility, leaving focus on BODY after a selected item unmounted. It now uses native buttons/anchors and the existing role-tabs navigation pattern, with managed focus (`tabIndex=-1`) inside the menu: native Enter/Space and arrow opening, first/last entry, wrapping Up/Down, Home/End, character navigation, Escape and selection focus restoration, and native Tab/Shift+Tab from the trigger's page position. Arrow navigation does not select a role. Outside pointer/touch or focus dismisses without stealing focus. Ownership, accessible names and checked state remain explicit. No new UI dependency, portal, request, timer or dynamic import is added.

Sibling audit: the home and video registration paths both needed the provenance repair. The floating header's Library/search/language labels and AccountControl use their translation catalogs; they are not replaced with English. Existing English Find/Grow portal boundaries, localized dialog close controls, Scripture/title boundaries and role-tab content boundaries remain unchanged. This repair does not expand into account-menu keyboard behavior.

## Behavioral and contract validation

- TDD: nine initial component regressions fail against the original implementation. The previous production build also fails both English/Arabic browser boundary cases. The final component file has 13 cases, covering English fallback, authored Arabic/RTL, French/LTR, missing metadata with English and Arabic content, both real registration hosts, ownership, focus, selection, dismissal and character navigation.
- Ten fresh-process runs of the four affected component suites: **600/600**. They include the retained real lazy-import Scripture test.
- Exact CI command, Node **24.22.1**, pnpm **9.12.3**, `CI=true`, all four `.env.ci` fixtures and four visible CPUs: `pnpm --filter @forge/web run --if-present test` — **7,046 passed**, 13 environment skips, one todo; 348 passing files.
- Production role-menu browser suite: all six final cases repeated ten times, **60/60**, zero retries. Real English/Arabic documents, 1780px/1280px, accessible names/ownership/checked state, keyboard wrapping and boundaries, native Enter/Space, Tab/Shift+Tab, focus return, click/touch and outside dismissal. A narrower earlier four-case cohort also passed 40/40.
- Existing production localization and geometry/resource suites: **22/22**, zero retries, including desktop/390px, Arabic/Spanish Scripture, English fallback, mixed resources/continuation titles, portal labels/focus/keyboard, real decoded local media, lean/full Grow, carousel reachability and deferred-resource positive/negative controls.
- Web strict lint (`--max-warnings=0`), typecheck, separate E2E typecheck/lint and production build pass. Exact parent and exact main also build in production mode with the same Node and local launcher inputs.
- Feature-flags tests **23/23**; `forge.watch.audience` retains `defaultValue: false`. The existing local-only test override exercises the gated UI without changing LaunchDarkly or committed configuration.
- Admin `schema:print` and admin-graphql `generate` pass with **zero SDL/introspection drift**. No generated artifact is edited.

## Controlled loading and resource evidence

The incremental comparison is the exact immediate parent `fd7883f0…` versus this repair, as required by the stack plan. Both are production builds with identical local environment inputs, Chrome 154.0.8037.92, DPR 2, CPU rate 1, fresh browser contexts and disabled browser cache. Four home/video × desktop/phone cells each retain eight warmups and 32 measured loads per build, using seeded balanced ABBA/BAAB order. Local HLS/poster fixtures preserve media behavior; all external and first-party telemetry is blocked in the browser, and the server runtime denies external TCP, shared telemetry agents and UDP. All samples, outliers, LCP candidates, resource timing, script/layout/task work, CLS, prefetch and storage writes are retained.

All four cells meet the plan’s 10% median shell/LCP and 0.05 added-CLS budgets. There are **256 measured loads and 64 retained warmups**; no measured load or outlier is excluded. No performance code change or threshold waiver is needed. Values below are median (p10–p90), milliseconds.

| Cell          | Shell, parent → repair                   | Final LCP, parent → repair          | Shell / LCP change |
| ------------- | ---------------------------------------- | ----------------------------------- | ------------------ |
| home, 1280px  | 49.35 (45.62–54.83) → 46 (43.71–51.08)   | 686 (628.4–761.6) → 700 (664–738.4) | -6.79% / +2.04%    |
| home, 390px   | 48.5 (44.9–54.06) → 45.7 (43.52–51.94)   | 558 (484.8–582.8) → 546 (532–580)   | -5.77% / -2.15%    |
| video, 1280px | 40.8 (40–50.85) → 40.3 (39.42–52.24)     | 152 (140.4–160) → 150 (140–176)     | -1.23% / -1.32%    |
| video, 390px  | 40.75 (39.61–52.39) → 40.2 (39.22–50.46) | 144 (136–151.6) → 140 (132.4–148)   | -1.35% / -2.78%    |

The raw records and `performance-summary.json` retain minimum/p10/p25/median/p75/p90/p95/maximum, every value, LCP element identity and resource readiness. Seeded 5,000-resample paired two-round block-bootstrap intervals are in `performance-budget.json`; they describe conditional uncertainty, not field guarantees.

| Cell          | Initial JS requests, parent / repair | Encoded script bytes, parent / repair | Median CLS, parent / repair |
| ------------- | ------------------------------------ | ------------------------------------- | --------------------------- |
| home, 1280px  | 31 / 31                              | 846824 / 855004                       | 0.000000 / 0.000000         |
| home, 390px   | 31 / 31                              | 846824 / 855004                       | 0.000000 / 0.000000         |
| video, 1280px | 40 / 40                              | 929411 / 937589                       | 0.005000 / 0.005000         |
| video, 390px  | 41 / 41                              | 929605 / 937783                       | 0.000000 / 0.000000         |

Initial encoded script bytes increase by 8,178–8,180 bytes (under 1%); request counts do not increase. The compiled chunk containing the role chip grows by 1,466 bytes. These costs remain visible in the resource evidence; all measured loading budgets pass.

Compiled Finder/course/Story/Partner/Share marker mappings are nonempty for both actual builds; their initial request counts are zero. Initial prefetch destination sets match. There are zero initial audience/finder/learning-progress requests or role/learning/audience storage writes, zero static/media failures and zero external response peers. All attempted external requests and first-party telemetry actions are blocked and recorded. Existing functional profile-status and recommendation-delivery POST reads remain recorded; on this local comparison proxy they receive the same admission response and are not publication or telemetry writes. Genuine hosted-Auth behavior is outside this anonymous timing cell.

The prior exact-main performance corpus is retained unchanged (all 17 hashes match). This incremental comparison does not replace or rewrite those historical measurements.

## Scope, setup and limitations

Exact changed files:

- `apps/web/src/components/watch/WatchRoleChip.tsx`
- `apps/web/src/components/watch/watch-audience-presence.ts`
- `apps/web/src/components/watch/WatchNextSteps.tsx`
- `apps/web/src/components/home/WatchHomeRoleBand.tsx`
- `apps/web/src/components/watch/WatchRoleChip.test.tsx`
- `apps/web/e2e/watch-role-chip.spec.ts`
- `docs/reports/2026-10-25-pr2783-role-menu-validation.md`
- `docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md`

The native recommendation test/code/timeouts remain untouched. The inherited timeout investigation and its retained 4292ms loaded tail remain in the [CI repair report](2026-10-25-pr2783-ci-localization-test-validation.md); no recommendation behavior or timeout increase is included here.

The isolated parent's initial build rejected node_modules directory symlinks outside Turbopack's root. An offline frozen Web install restored native dependencies; its Web typecheck also needed the existing Admin blocks module's three locked type dependencies. A broader offline Admin install could not find a cached Pothos tarball and made no download. Mirroring those three dependency links within the parent root completed setup without source/lock edits or skipping type checks. These setup attempts are not performance samples. One intermediate lint attempt caught formatting in the new browser test and was corrected. A compact-menu test initially assumed a transitive ARIA label included visually hidden selected text; the trigger's direct accessible name does, while the menu correctly exposes its English prompt and checked radio state. The corrected browser expectations retain all required name/state assertions.

Browser accessibility coverage checks rendered semantics and real keyboard/focus behavior; it is not a manual screen-reader audit. Authored non-English and missing-provenance menu copy use rendered component tests through the actual home/video registration paths; the real producer's browser fixture resolves to published English fallback on Arabic audio. No publication/import operation is performed for that coverage. Local timing controls do not establish field performance or identical scheduling tails.

Evidence directory: `/home/lado/.local/share/forge-pr2783-r5-menu-20261025/` (workspace-backed), with test/build receipts, browser network attachments, raw performance samples, summaries/audits and cleanup receipts. No deployment, live publication/import, external configuration change, production mutation or escaped external telemetry is part of this repair.
