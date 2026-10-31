# PR #2783 round 6: audience radio and tab accessibility

Exact parent/lease: `d754d983e28ca4eede40e98bbc099a07ce8e600f`. Remote matched before work. Scope: [repair plan](../plans/2026-10-25-pr2783-round-6-controls.md). All previous fixes remain; the audience registry default remains false. This report records local implementation validation, not a rollout authorization.

## Root causes and implementation

The course mode buttons declared radio roles without radio keyboard behavior. Every button was tabbable, arrow keys did not move selection, and the inactive group option removed its focus outline. Controlled native radio inputs now share a unique `useId` group name and visible labels. The browser supplies one group Tab stop, wrapping arrows, Space and pointer/touch selection; a label `:focus-visible` outline makes keyboard focus visible. Selection survives controlled progress rerenders and causes no progress write. Native radios do not add custom Home/End behavior. The English controls explicitly own LTR direction, including on Arabic documents, so Right/Down advances and Left/Up retreats.

Admin's audience role buttons declared tabs but lacked roving focus, keyboard activation and a panel relationship. They now use automatic activation for immediate local panels, wrapping Left/Right, Home/End, unique stable tab IDs, `aria-controls`, `aria-labelledby`, selected state and a single entry tab. The existing role fields/preview share an associated panel, preserving their nodes and draft editing behavior. Keyboard navigation does not call `onChange`, save or publish. The theme's text color supplies a visible 2px focus outline. Admin currently supports English/Spanish UI; this English role chrome explicitly owns LTR direction even if the root is RTL. Authored field contents retain their language behavior. Tab proceeds into the first editable field.

The sibling audit found the same defects in Finder duration radios and Grow/Partner resource tabs. Finder uses the same native radio approach with an inset focus ring inside its clipped list. Resource tabs reuse a small local hook mirroring the established `WatchRoleTabs` roving-focus/shared-panel pattern, with automatic activation, arrows/Home/End, selected state and panel ownership. Their English resource chrome is LTR. Selecting the already-selected Grow filter retains that selection, as expected for tabs. Existing main audience tabs, Share tabs and native questionnaire/preview radios retain their established patterns. RoleChip, selected Scripture/question locale boundaries, concurrency, importer and prefetch repairs remain intact. No dependency or I/O is added.

## Tests and contract validation

TDD component assertions failed before implementation. Independent real-browser controls on the rebuilt exact parent fail both original ArrowRight findings: focus remains on the original course radio or editor tab. Candidate browser checks exercise native behavior rather than synthetic key handlers.

- Five cold Web focused runs: six suites, **330 passed** total. The retained lazy-import language test, RoleChip and main role tabs are included. Five final cold Admin editor runs: **50 passed**.
- Exact CI Web command: `pnpm --filter @forge/web run --if-present test` — **7,049 passed**, 13 environment skips, one todo; 348 passing files.
- Exact CI Admin command: `pnpm --filter @forge/admin run --if-present test` — **9,874 passed**, 1,013 gated skips, one todo; 622 passing files.
- Web/Admin strict lint and typechecks pass; Web lint uses `--max-warnings=0`. Separate E2E lint/types pass. Node **24.22.1**, pnpm **9.12.3**, `CI=true`, synthetic `.env.ci` fixtures and bounded four-CPU CI worker selection are recorded with the commands.
- Exact-parent Web, candidate Web and Admin production builds pass; Admin's workflow build verifiers run normally. No production source changed after these builds; hashes are retained.
- Admin `schema:print`, admin-graphql `generate` and explicit generated diff checks pass with **zero SDL/introspection drift**. No generated artifact is edited.
- Feature-flags **23/23**, including the unchanged default-off audience registry. Only owned local fixture processes enable test behavior.
- All **168 migrations** apply to a newly created disposable PostgreSQL database. Four real DB suites pass **22/22**: audience publication, importer guard/orchestration, film finder and learning progress (11 ownership/CAS/reset cases). Tests operate only on disposable fixtures; no live publication/import is run.
- Docker workspace closure, both package-copy phases, both workflow filters and shared web/worker-image guards pass **2/2**. Packaging is byte-identical to the pinned parent. An actual Docker image rebuild was not repeated this round; the parent GitHub production-image check was green.

- Final preserved localization/geometry/resource/RoleChip browser suites: **28/28**, zero retries. Exact parent and candidate also each pass six matched full-course geometry diagnostic cases.
- Final hosted publication/control cohort: **18/18**. Ten subsequent combined cycles passed **179/180**; all **50 publication cases** pass, including ten genuine signed-in Partner questionnaire cases, and all course/Finder/Admin cases pass. A resource-tab Space assertion failed once. The final resource test now explicitly asserts the intended tab is focused before sending Space; **48/48 traced cases** (12 cycles × four language/viewport cells), zero retries, pass with the selected-state assertion unchanged. This does not establish the precise cause of the earlier unscoped key delivery failure; the failed receipt is retained rather than counted as a clean full combined run.
- Browser checks cover Arabic/English, 390/1280px, arrow wrapping, Tab/Shift+Tab entry/exit, Space/Enter as appropriate, click/touch, accessible names/checked/selected state, panel ownership, local draft retention, actual computed focus styles and full-viewport focus screenshots. Admin root LTR/RTL cases use the actual built CSS/fonts.

## Controlled loading and resource evidence

Production parent `d754d983…` versus repair, Node 24.22.1, Chrome 154.0.8037.92, DPR 2, CPU rate 1, fresh contexts, disabled browser cache, warm servers and a shared no-store origin. Each cell retains eight warmups and 32 measured loads per build in seeded balanced ABBA/BAAB order. The 3.5-second observation window retains text/poster/final VIDEO LCP candidates, readiness/resource timing, layout/script/task work, CLS and all outliers. Local valid HLS/poster fixtures preserve media behavior. Browser and server telemetry fences remain active; no external-media corpus is run.

All four initial-load cells meet the 10% median shell/LCP and 0.05 added-CLS budgets: **256 measured loads plus 64 warmups**, with none excluded. No performance product change or threshold waiver is needed. Values are median (p10–p90), milliseconds.

| Cell          | Shell, parent → repair                    | Final LCP, parent → repair            | Shell / LCP change |
| ------------- | ----------------------------------------- | ------------------------------------- | ------------------ |
| home, 1280px  | 48.15 (44.82–56.25) → 45.9 (42.94–52.47)  | 670 (632.4–707.2) → 696 (632.8–755.2) | -4.67% / +3.88%    |
| home, 390px   | 49.35 (44.92–59.18) → 46.15 (43.62–53.5)  | 556 (540–649.2) → 560 (536–599.2)     | -6.48% / +0.72%    |
| video, 1280px | 40.95 (39.43–55.64) → 41.2 (39.71–55.22)  | 150 (140–163.6) → 148 (140.4–179.6)   | +0.61% / -1.33%    |
| video, 390px  | 40.85 (39.41–52.54) → 40.55 (39.71–48.66) | 140 (132–148) → 140 (132–147.6)       | -0.73% / +0.00%    |

The full distributions include minimum/p10/p25/median/p75/p90/p95/maximum and every value in `performance-summary.json`. Paired two-round, 5,000-resample block-bootstrap intervals are in `performance-budget.json`; these describe this controlled corpus, not field guarantees.

| Cell          | Initial script requests, parent / repair | Encoded script bytes, parent / repair | Median CLS, parent / repair |
| ------------- | ---------------------------------------- | ------------------------------------- | --------------------------- |
| home, 1280px  | 31 / 31                                  | 847399 / 855004                       | 0.000000 / 0.000000         |
| home, 390px   | 31 / 31                                  | 847399 / 855004                       | 0.000000 / 0.000000         |
| video, 1280px | 40 / 40                                  | 929985 / 937589                       | 0.005000 / 0.005000         |
| video, 390px  | 41 / 41                                  | 930179 / 937783                       | 0.000000 / 0.000000         |

Initial encoded script bytes increase by 7,604–7,605 bytes (under 0.9%), with unchanged script request counts. No new UI dependency, timer, observer, effect, data request or dynamic-import entry point is introduced by the controls. The build resource table exposes the actual initial bundle cost, including changes to shared compilation/splitting; it is not an attribution of every changed byte to the small hook. Finder/course/Story/Partner/Share marker mappings are nonempty in both actual builds, and their initial requested chunk counts stay zero. Prefetch destination sets match. There are zero initial audience/finder/learning-progress requests or role/learning/audience storage writes, zero static/media failures and zero external response peers.

The measured initial-load request audit records **1238 blocked telemetry/other external attempts**, all retained by host/path/method. Mux Data and every non-media external endpoint are blocked; media is fulfilled locally. First-party playback/measurement and actual-build Watch-event server actions are also blocked. Existing functional recommendation/profile-status read POSTs remain recorded on the local comparison proxy; they are not content publication or telemetry writes. Server instrumentation denies external TCP, local telemetry agents and UDP. No external POST escapes the fence.

Actual deferred full-course mount and controlled mode updates, plus real production Admin component initialization/tab updates, are measured separately. Each phone/desktop cell retains eight warmups and 32 measured entries per build (**256 further measured entries plus 64 warmups**). Course uses the same seeded balanced order; editor uses alternating AB/BA pairs. Equivalent native clicks update both parent and repair because the original course keyboard is broken. The editor measurement isolates the production component with built CSS/fonts, not the full authenticated dashboard route.

| Surface        | Ready, parent → repair                          | Update-to-next-frame, parent → repair      | Ready / update change |
| -------------- | ----------------------------------------------- | ------------------------------------------ | --------------------- |
| course, 390px  | 584.05 (576.91–596.58) → 583.35 (578.73–617.49) | 9.15 (8.21–14.59) → 10.05 (8.3–14.59)      | -0.12% / +9.84%       |
| course, 1280px | 589.85 (582.25–614.74) → 590.4 (584.44–628.75)  | 14.35 (12.96–15.69) → 14.7 (13.58–15.49)   | +0.09% / +2.44%       |
| editor, 390px  | 64.1 (63.1–67.39) → 64.45 (62.65–67.59)         | 13.8 (10.63–14.645) → 14.375 (11.4–14.7)   | +0.55% / +4.17%       |
| editor, 1280px | 64.35 (62.81–66.67) → 65.25 (63.51–68.03)       | 14.15 (11.62–14.5) → 14.25 (12.215–14.545) | +1.40% / +0.71%       |

All surface ready/update medians meet the same 10% comparison and course added-CLS stays within 0.05. Course selected-state transitions are asserted in every entry; no audience/finder/progress request or role/progress/audience storage write is introduced. `surface-performance-summary.json` retains all distributions, script/layout work, bytes, blocked requests and course CLS/long tasks. These local controls establish neither field performance nor identical scheduling tails. Prior exact-main corpora remain untouched; the seven round-4 raw performance JSON artifacts inventoried this round retain their hashes.

## Harness corrections and limits

The first full Admin run exposed a harness path mismatch: the evidence directory's symlink made the profiler fixture's `require.cache` path differ from the physical TMPDIR path. Using the resolved physical directory restores its existing assertions and the entire CI command passes. The runtime network fence initially threw synchronously for a blocked instrumentation socket; it now destroys that denied socket asynchronously, preserving the deny rule and ordinary Node error semantics. Neither requires an application change.

An initial larger browser cohort passed 179/180; a resource tab touch after keyboard traversal missed selection with the row beneath the fixed header. Centering the actual touch target before changing input modality retains every assertion and timeout. The subsequent combined cohort had a separate Space/focus precondition miss, recorded above; no timeout, selected-state expectation or product key handler is relaxed. An earlier geometry run passed 27/28 with a plan-link focus visibility miss. Native Space selection and matched exact-parent/candidate geometry diagnostics each pass 6/6; final preserved coverage is rerun in full. All initial logs remain retained.

The Admin browser fixture mounts the real production component using production React and the actual built Admin CSS and font files. It verifies keyboard, focus visibility, panel ownership and local edit retention without bypassing authenticated dashboard APIs. It is an isolated component fixture, not a full hosted Admin login. Public projection/publication and genuine Partner hosted-Auth coverage use their real local services. Browser accessibility checks cover rendered semantics, accessible names and real keyboard/focus behavior; they are not a manual screen-reader audit.

Evidence: `/home/lado/.local/share/forge-pr2783-r6-a11y-20261025/`, physically `/mnt/worktrees/checkouts/t3/Forge/pr2783-r6-a11y-evidence-20261025/`. Receipts include exact commands, failed controls, builds, raw browser JSON/screenshots, network fences, DB/migration checks and performance corpora. No external telemetry, deployment, external configuration/flag change, live content operation or production mutation is authorized or performed.

Durable lessons: a declared radio/tab role is a keyboard and focus contract. Prefer native radios when the visual presentation can live on their labels; verify native Tab behavior in a browser instead of inferring it from individual `tabIndex` properties. For local tabs, associate the existing panel and preserve editable nodes rather than remounting fields to satisfy ARIA. Check focus styling with real built CSS/fonts and a screenshot that includes the outline; a tightly cropped element screenshot can omit the indicator. Assert the intended key target before page-level keyboard input after changing input modality.

## Exact changed files

- `apps/web/e2e/watch-audience-controls.spec.ts`
- `apps/web/src/components/watch/use-watch-resource-tabs.ts`
- `docs/plans/2026-10-25-pr2783-round-6-controls.md`
- `docs/reports/2026-10-25-pr2783-round-6-controls-validation.md`
- `apps/admin/src/app/dashboard/experiences/experience-editor/watch-audience-editor.test.tsx`
- `apps/admin/src/app/dashboard/experiences/experience-editor/watch-audience-editor.tsx`
- `apps/web/e2e/watch-grow-layout.spec.ts`
- `apps/web/src/components/watch/WatchFindFlow.test.tsx`
- `apps/web/src/components/watch/WatchFindFlow.tsx`
- `apps/web/src/components/watch/WatchGrowCourse.test.tsx`
- `apps/web/src/components/watch/WatchGrowCourse.tsx`
- `apps/web/src/components/watch/WatchGrowPlans.tsx`
- `apps/web/src/components/watch/WatchPartnerResources.test.tsx`
- `apps/web/src/components/watch/WatchPartnerResources.tsx`
- `docs/roadmap/topic-experiences/feat-744-watch-editor-questionnaire-config.md`
