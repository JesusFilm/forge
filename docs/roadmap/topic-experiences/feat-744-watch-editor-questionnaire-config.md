---
id: "feat-744"
title: "Editor-owned Watch audience questionnaires"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 7
depends_on:
  - "feat-743"
blocks: []
tags:
  - "web"
  - "cms"
  - "graphql"
---

## Problem

Deliver stage 6 of the six-stage audience stack. The prototype is evidence only; this ticket records the implemented scope and verification.
The governing scope, product requirements, technical decisions, verification and completion contract are in [2026-10-17-0010-feat-watch-audience-stack-plan](../../plans/2026-10-17-0010-feat-watch-audience-stack-plan.md).
This ticket covers U11, U12 only; keep a separate PR whose base is the preceding stage PR.

## Entry Points — Read These First

1. `docs/plans/2026-10-17-0010-feat-watch-audience-stack-plan.md`: Goal Capsule, Product Contract, this stage's U-IDs, Verification Contract and Definition of Done.
2. `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`; also Admin/Auth/typed-client guides when touched.
3. `docs/analytics-and-recommendation-policy.md`: configured telemetry, accepted coverage, and current enablement policy.
4. `packages/experience-schema/src/`: current pattern or planned addition named by the unit.
5. `apps/admin/src/domain/blocks.ts`: current pattern or planned addition named by the unit.
6. `apps/admin/src/graphql/types/blocks.ts`: current pattern or planned addition named by the unit.
7. `apps/admin/src/graphql/types/watch-setting.ts`: current pattern or planned addition named by the unit.
8. `apps/admin/src/services/watch-setting.service.ts`: current pattern or planned addition named by the unit.
9. `apps/admin/src/services/experience.service.ts`: current pattern or planned addition named by the unit.

## Grep These

- `U11.`
- `U12.`
- `WatchSectionRenderer|WatchHomeExperiencePage|WEB_USER_PRINCIPAL|watchSetting|watchAudience`

## What To Build

### U11. Editor-owned questionnaire block and public projection

**Goal:** Make questionnaire/recommendation definitions editable through existing Admin publication.

**Requirements:** R9; AE5; KTD3, KTD11.

**Dependencies:** U1's stable semantic contract; assembled as PR 6 after PR 5.

**Files:** Extend `packages/experience-schema/src/` owning block schemas, `apps/admin/src/domain/blocks.ts`, `apps/admin/src/graphql/types/blocks.ts` and its union registration, `apps/admin/src/graphql/types/watch-setting.ts`, `apps/admin/src/services/watch-setting.service.ts`, `apps/admin/src/services/experience.service.ts`, `apps/admin/src/app/dashboard/experiences/experience-editor/` block library/controls/preview; new `watch-audience` colocated schema/editor/service tests; update shared block fragments in `packages/admin-graphql/src/fragments/`, regenerate SDL/introspection.

**Approach:** Follow KTD11 and the existing admin-authored/Web-owned block pattern. Add an editor for all four roles, exactly three questions, options, action definitions, score mappings and reason copy. Use semantic action kinds with catalog identity or safe resource destination, not React component names or raw HTML. Limit label/copy lengths, weights and list cardinality to bound persisted payload/render work. Publish validation rejects unknown action references and unsafe destinations. Existing revisions preserve history and human publish controls. Normal MCP experience editing can draft the same schema through existing validators; no agent publish route is added.

**Test scenarios:**

1. Valid definitions round-trip through save, draft preview, publication and shared fragments.
2. A fourth question, duplicate/unknown ID, dangling score target or unsafe destination is rejected with an editor-local error.
3. Editing a draft leaves published reads unchanged; a published default-template change updates the common WatchSetting projection.
4. A locale with no published configuration follows the declared locale fallback, never another editor's draft.
5. The block is admitted only in the intended top-level schema and does not break older Experience readers.

**Verification:** Schema/editor and isolated DB publication tests; generated SDL/types and existing Experience compatibility checks pass. No production content is published during implementation.

### U12. Switch both Watch surfaces to published configuration

**Goal:** Complete the replacement of baked-in questionnaire/recommendation data.

**Requirements:** R4, R9; AE5; KTD3, KTD11.

**Dependencies:** U2, U11.

**Files:** New `apps/web/src/lib/watch-audience-content.ts`, `apps/web/src/lib/watch-audience-content.test.ts`, `apps/web/src/components/watch/WatchAudienceBlock.tsx`, `apps/web/src/components/watch/WatchAudienceBlock.test.tsx`; update `apps/web/src/lib/content.ts`, `apps/web/src/lib/watch-home.ts`, `apps/web/src/lib/watch-audience-config.ts`, relevant shared fragments and home/video adapters; extend `apps/web/src/app/api/revalidate/route.test.ts`, `apps/web/e2e/watch-audience-config.spec.ts`.

**Approach:** Resolve the common published definition during existing public content loading and adapt it into the U1 contract. Match only known schema-lag failures for new fields/types and retry the compatibility selection; ordinary server errors remain diagnosable. Seed equivalent editable configuration through reviewed local fixtures and an idempotent dry-run-first migration/import path; no production write is required. Baked-in data remains only a temporary compatibility fallback until a valid authored locale config exists. Render-time destination checks also cover MCP-written or historical JSON. Preserve source block keys and tags during revalidation.

**Test scenarios:**

1. Covers AE5. Publishing one default configuration changes both home and synthetic video questionnaires after revalidation.
2. An older Admin schema uses the compatibility path; an unrelated GraphQL error does not masquerade as schema lag.
3. Authored action ordering/weights change results with the same saved role and no stale answer IDs.
4. Unsafe `javascript:`, protocol-relative, control-character, or malformed destinations are omitted at render even if stored data bypassed a prior validator.
5. Draft configuration stays private; no session-specific state enters cached HTML or another visitor's role.
6. Older readers continue to render existing Experience content; removing a supported action cannot crash the questionnaire.

**Verification:** Local editor → published projection → revalidation → home/video proof and schema-lag negative control; no permanent duplicate live configuration source.

## Constraints

The linked plan governs all KTDs and R-IDs cited above. Preserve the original dirty prototype and recovery outputs. No production migration, live content publication, merge or deployment. No simulated authentication/community or new paid inference route. Before delegation run `agent-quota`; before every worktree/branch, fetch/install/build or broad test use `agent-io-guard -- <foreground command>` and never bypass or nest it. Retain existing auth/download/SEO/language/analytics contracts.

## Verification

Use the linked Verification Contract and the unit-specific scenarios above. Record real behavior, cross-layer checks where applicable, and a page-load comparison against the preceding stack parent. Run formatter and applicable lint/typecheck/build/schema drift checks before PR publication. Update this ticket to in-progress when implementation starts and complete only after the scoped implementation and checks finish; completion does not claim deployment.

## Demonstrated local verification

The shared schema, editor, projection, isolated publication/history/preview and idempotent import checks passed. Existing block starter and exhaustive union fixtures cover the new top-level block. Admin/Web/shared-package relevant lint/type checks, generated SDL/introspection validation and the production Web build passed. A normal hosted-Auth Admin session used Save Draft, Preview and Publish: the draft stayed out of live content, the capability preview rendered the draft questionnaire, and the normal watch-setting webhook updated home and synthetic video together. All six published-config browser cases passed at desktop and 390px. Public flag-off/on and genuine signed-in versus anonymous HTML checks retain public ISR headers, canonicals and session-independent markup.

Parent/candidate production-load evidence includes the initial phone-home investigation and seven additional matched samples per variant. All original samples remain in the expanded result: phone-home median +6.84%, other cells below 1%, unchanged CLS and initial request counts. Poster paint remains bimodal; no causal claim about the mode-frequency difference is made. Exact receipts and raw evidence are in `/home/lado/.local/share/forge-watch-stack-20261017/`.

## Rollout and compatibility

Deploy the Admin producer schema before new modern selections where no compatibility tier exists. Web's public and capability-preview readers narrowly retry only known audience-schema lag; unrelated/execution errors remain failures. Current Mobile and TV explicitly use the unchanged legacy fragment, which was validated against both current and pre-audience SDL; their adapters skip unsupported metadata. Full native-app builds were not run for this Web/Admin scope.

Use the reviewed local importer in dry-run mode first, then `--apply` to stage one draft; it never publishes and refuses non-local connection hosts. Publish only through the existing editorial lifecycle. One published default-template locale definition feeds both surfaces. Present rejected/unavailable authored configuration is omitted, never silently replaced. Code definitions remain only the declared temporary absent/old-schema fallback. Capability previews use their own staged configuration without querying the published source or entering public ISR caches. No production content or external flag was changed.

## Review regression verification (2026-10-17)

Review fix: watch-audience-editor.tsx retains action-score ownership across transient ID collisions and atomically remaps only unambiguous unique IDs. Colliding-prefix, editing/reorder/removal and ID-swap regressions pass without relaxing schema validation. 232 editor-scope tests and 22 shared-schema tests passed; the offered three simplification files are integrated. Publication/importer real DB suites enter CI only at stage 6. Full final Admin/Auth/Web typechecks and Web production build passed; matched desktop/390px home/video loading stayed within the plan budget.

Detailed commands, red/green logs, real runtime proof, limits and six-stage reassembly receipts: `/home/lado/.local/share/forge-watch-stack-20261017/debug-review-r1/`.

## Round 2 review corrections (2026-10-17)

R2 corrections: the block library and insert backstop admit Watch Audience only on a template, preserving existing unrelated Experience blocks. Capability preview now gets template identity from the parent row and omits the staged questionnaire elsewhere; an older producer without that field fails closed. SDL/introspection regenerated together. Real isolated PostgreSQL preview/publication and built-Web template, ordinary-page and homepage-layout preview checks passed without publishing content.

Exact red/green, integration, performance, stage replay and limitations receipts: `/home/lado/.local/share/forge-watch-stack-20261017/debug-review-r2/return-to-caller.json`. Parent owns final independent review and PR shipping.

## Round 3 selected-template repair (2026-10-17)

Generic route-template identity does not establish Watch ownership when multiple templates exist. Editor insertion and capability preview now use a separate server-derived selected identity, sharing public Watch's non-archived `createdAt`, then `id` ordering. Missing selected identity fails closed; historical blocks and generic route authoring remain intact. An older producer's exact missing-field error omits both the new identity and questionnaire; unrelated errors remain errors. SDL and introspection regenerate together.

The second-template editor and renderer cases failed before the fix and pass after it. All 117 editor/service cases, 68 preview cases and the isolated real-PostgreSQL two-template publication proof pass. The retained performance clearance applies to frozen `0199bef`; final repair impact and integration checks are recorded separately before shipping.

## Restack after stage 5 squash merge (2026-10-24)

PR #2783 replays only the five editor-layer commits onto exact main `02ecc6be8d34af143e5975156b78d2e46a9e3406`, dropping the obsolete stage 5 ancestry. The feat-743 conflict retains both the editor Auth CI note and all later concurrency-review history. Main's progress client and its 1,102 regressions, Auth source, Prisma schemas and migrations remain unchanged. The restored course UI required adapting seven inherited rendered-control regressions to Finish, lesson selection and story controls; the real session/focus/retry, reset and revision assertions remain covered, including the structured reversal seam where individual checkboxes no longer exist. All 23 course integration cases pass.

Fresh checks passed: strict lint and full typechecks for Admin, Web, Auth, experience-schema and admin-graphql; repository formatting; generated SDL/introspection with zero drift; 629 focused Admin, 6,992 Web, 660 Auth, 70 experience-schema and two admin-graphql tests; 22 isolated PostgreSQL publication/import/finder/progress cases after deploying all 162 migrations; CI-sensitive dependency/roadmap guards; candidate and exact-main production Web builds. Environment-dependent skips remain (Web: 13 skipped and one todo; Auth: 106 skipped). Node 24.19.0 was available rather than the repository's 24.22.1 pin.

Fresh matched local production loads cover real HTTP-200 home and synthetic-video documents at 1280px and 390px: three measured entries per cell plus retained warmups, then seven additional phone-home samples per variant to investigate its initial player-shell timing. Expanded phone-home shell medians are 17.85ms on main and 18.90ms on the candidate; no measured median LCP increase exceeds 10%, and added CLS stays below 0.012. The uncompressed harness transfers about 34KB more on home and 60KB more on video. Course, story and finder chunks are absent before intent; actual finder/story mounts add no CLS or long tasks, while opening the full course records one 70ms task. The shared shell's existing session read remains; no learning/finder request starts on initial entry.

These are unthrottled local Chromium 154 measurements with identical no-store proxy instrumentation, warm servers and disposable fixtures, not field or playback clearance. External Mux media requests encounter 403s and cross-origin transfer sizes are unavailable. No production data, live content or external flag/config was changed. Exact commands, raw timings, limitations and file/ancestry audits are retained in `/tmp/forge-pr2783-restack-evidence/`.

Durable restack lesson: a clean textual replay can still join newer concurrency regressions to replaced UI controls incorrectly. Preserve the owning state-machine implementation and assertions, then exercise the real replacement controls and inspect both revision requests and rendered recovery status before declaring the stack compatible.

## PR #2783 review round 1 repairs (2026-10-24)

Repair base is exactly `7b9d30865e320ad178ab092604dc50dd829fe536`; the branch is a fast-forward continuation of the repaired stack. Scope and validation contract: [review repair plan](../../plans/2026-10-24-pr2783-review-round-1-repairs.md). This ticket remains in progress while this repair's implementation validation and review clearance are outstanding; historical implementation and review receipts above remain intact.

- Admin image: copy the `@forge/feature-flags` manifest before install and its source before build; include it in both security-image workflow filters. A new Node regression walks Admin's transitive workspace dependency closure, checks both copy phases and both filters, and verifies the shared web/worker image contract. It failed on the two omissions before the fix and now passes.
- Importer: reject duplicate host keys (including encoded aliases), case-ambiguous keys, alternate destination selectors, empty hosts, malformed URLs and non-Postgres schemes. Validate the once-decoded authority plus any query override as explicit loopback or an absolute local Unix socket. Tests inspect the installed pg driver's effective host without connecting, reproduce its last-host rule, and prove both dry/apply orchestration refuse before loading a client. The importer CLI was never run.
- Authored localization: retain the producer's resolved `sourceLocale` through projection and frame; render authored questions/tabs in that locale and direction, including Arabic RTL and LTR source fallback on an Arabic page. Mark English fallback, controls, reveals and resource modules explicitly English. DOM tests pin authored copy, inherited language/direction, mixed resources and fallback boundaries.
- Publication E2E: compact home uses published role labels and canonical navigation pills; video owns the questionnaire with external tabs. Anonymous Partner stays locked; the Partner questionnaire test requires a real hosted-Auth session. An unpublished draft sentinel must stay out of the public projection and serialized home/video HTML. No auth or publication route is mocked.
- Initial loading: category links remain gated through desktop hydration and arm individually on focus or deliberate mouse intent; touch scrolling never arms them. Hero prefetch behavior is unchanged. Regression tests failed before the change; production E2E also checks initial category requests, absent persona-resource scripts and progress writes, then positively checks intent prefetch/navigation and lazy Share loading.

Validation receipts and the original red logs are retained in `/home/lado/.local/share/forge-pr2783-r1-20261024/`. Shared `/tmp` inode exhaustion interrupted the first broad run; task-owned temporary files and subsequent validation moved to the workspace disk without deleting other work. Initial lint/type findings in the new guard/test helper were corrected before final validation.

Detailed commands, distributions, file audit and limitations: [review round 1 validation report](../../reports/2026-10-24-pr2783-review-r1-validation.md). Real pointer E2E exposed an incomplete inherited local home fixture: it had a legacy fixed `VideoHero` and no TV-carousel catalog source. The October 24 restack home timings above and the first repair corpus remain historical diagnostics, but do not clear the intended TV-carousel/compact-role-band composition. The report records corrected-fixture comparisons separately; the disposable fixture correction leaves template canonical configuration and its unpublished draft sentinel unchanged.

No Auth, migration, generated schema/introspection, or learning-progress concurrency implementation was edited. `forge.watch.audience` remains default-off in the shared registry; only owned local test processes enable it. No external flag/config change, importer CLI, live publication, deployment or production write is part of this repair.

Durable repair lessons: validate connection destinations against the installed driver's parsing contract rather than the first URL parameter; test Docker's entire workspace dependency closure; carry the resolved content language instead of inferring it from page language; and re-measure viewport-driven prefetch when a compact composition moves links earlier into view.

Round-1 implementation validation completed locally: strict five-package lint/types, schema/introspection zero drift, 871 scoped Admin tests, 6,998 passing Web tests (13 skips/one todo), 660 Auth tests (106 environment skips), 70 experience-schema tests, 2 admin-graphql tests, 23 feature-flag tests, all 162 disposable DB migrations and 22 publication/import/finder/progress DB tests. Admin/Web production builds and the actual CI Admin Docker image passed, including isolated shared web/worker startup and TLS PostgreSQL client contracts. All 10 final desktop/390px publication E2E cases passed through real local hosted Auth.

Corrected-fixture matched production sampling retains seven loads per build/cell, extended to fourteen for compact home. Main/before/repaired desktop-home shell medians are 25.7/28.8/25.1ms; initial route prefetches fall from 11 to 3, matching main. Every corrected home/video cell meets the plan's 10% median timing and 0.05 added-CLS budget. The report contains all distributions, request/byte counts, mount smoke observations and limits (unthrottled local host, external media failures, desktop pointer at 390px). No performance requirement is waived. Status remains in progress pending review clearance.

## PR #2783 review round 2 repairs (2026-10-24)

Repair base is exactly `3fa4106df2f0fa1e0724a81df799315401535aad`. Status stays in progress until review clears. Scope and evidence requirements: [round-2 repair plan](../../plans/2026-10-24-pr2783-review-round-2-repairs.md). All round-1 and stage-5 concurrency/Auth/migration/schema repairs remain intact.

- Grow sizing: the questionnaire grid's implicit column used the carousel's intrinsic minimum width. `grid-cols-1` gives that actual boundary a `minmax(0, 1fr)` track without adding an overflow mask. Native production measurements reproduce desktop lean/full widths of 4,104/10,534px in a 1,088px panel and phone widths of 3,580/9,262px in a 350px panel; repaired content matches each panel and enables forward controls. Browser regressions measure actual content/grid geometry and exercise lean/full resources, solo/group/leader course modes, touch, keyboard traversal, last-card visibility, long Arabic sizing stress and lesson-sheet containment.
- Streamed publication tabs: both home and video now use retrying `toHaveText` with the exact published labels in order. Auth, publication, draft-isolation, timeout and ranking contracts are unchanged. All 120 desktop/phone cases pass with zero retries (12 five-case cycles per viewport), including 24 genuine signed-in Partner cases through local hosted Auth. Exact labels/order, draft isolation and protected content remain asserted.

Validation receipts and distributions: [round-2 validation report](../../reports/2026-10-24-pr2783-review-r2-validation.md). Strict Web/Admin/Auth/experience-schema/admin-graphql lint/types, schema generation with zero drift, 6,998 Web tests, 871 scoped Admin tests, 660 Auth tests, 70 experience-schema tests, two admin-graphql tests, 23 flag tests and 22 disposable PostgreSQL publication/import/finder/progress tests pass. Admin and exact-main/before/repaired Web production builds pass. Six production-browser geometry/deferred-resource cases pass. The flag remains default-off; no live publication/import or production action occurred.

Matched production performance compares exact main, pinned before and repaired source with rotated order and retained outliers. Native Chrome 154/DPR 2 desktop-video medians (main/before/repaired) are shell 30.40/31.45/33.15ms and IMG LCP 116/116/116ms with fixed local media; external Mux gives 30.60/31.90/31.95ms and 184/192/186ms. Corrected phone-video medians are 35.25/34.40/33.75ms and 104/110/106ms. All seven accepted cells meet the 10% median and 0.05 added-CLS budgets against both parents. Initial deferred implementations and audience/finder/progress requests remain absent. The report retains the native fixed-media slow tail (main/before/repaired maxima 412/380/404ms), increased editor upper-tail frequency, interrupted diagnostic cell and Node-version limitation; it does not claim identical tails or external-network-only causation. No separate performance code change or threshold waiver is justified.

Durable lessons: `min-w-0` on a grid container does not reset its implicit track's automatic minimum; test content geometry and last-card reachability so an overflow mask cannot pass. For streamed React content, assert the final ordered locator collection through Playwright's retrying expectations instead of reading a transient array once.

## PR #2783 review round 3 localization repairs (2026-10-24)

Repair parent is exactly `e96adbc57c06730cce00572155d4625367d021d2`. Status remains in progress pending review clearance. Scope: [round-3 localization plan](../../plans/2026-10-24-pr2783-review-round-3-localization.md); exact commands, falsification, browser proof, loading distributions and limitations: [round-3 validation report](../../reports/2026-10-24-pr2783-review-r3-validation.md).

The producer now carries the selected Bible version's nullable content language through the existing passage projection. Grow's lean/full Scripture text and references declare that actual language/direction, including Arabic RTL and English fallback on an Urdu page; absent/unknown metadata stays neutral. English resources and questionnaire source locales keep their independent boundaries. SDL/introspection regenerate together, with a narrow older-producer retry that preserves the requested-language repair and unrelated failures. No new provider request, migration or version-selection change was introduced.

Story, Finder including its pending/error shell, and both English prayer dialogs declare English/LTR at their actual portal content. The translated shared close control retains its UI locale/direction; authored Share prompts without metadata stay neutral in inline/printed lists. The portal audit retains localized download/share/language dialogs and the inline lesson sheet's existing English boundary.

Rendered red/green coverage and all eight new desktop/390px browser cases pass, including Arabic/Spanish Scripture, English fallback, nested controls, dialog names/descriptions, Tab containment, Story arrow navigation, Escape and return focus. All six retained geometry/deferred-resource cases pass. Broad Web has 7,021 passing tests (13 skips/one todo), relevant Admin passage/schema has 73, and admin-graphql has two. Strict package lint/types, separate E2E lint/types, Admin/Web production builds and second-generation schema/introspection zero drift pass.

All 60 repeated publication cases pass without retries, including 12 genuine hosted-Auth Partner cases; a fresh final build passes another ten cases and repeats localization 8/8 and geometry/deferred-resource 6/6. Native Chrome independently verifies Arabic Scripture and English portal semantics with a translated Arabic close control. No auth/publication route is mocked.

Matched native Chrome 154/DPR 2 production medians (exact parent→repair) are desktop-home shell 32.4→31.3ms/LCP 134→128ms, desktop-video 32.3→32.0ms/118→120ms, phone-video 30.2→30.55ms/98→96ms, and expanded phone-home 32.4→30.0ms/92→96ms. The original phone-home 12-entry LCP miss (82→98ms) remains retained; same-build A/A and one predeclared 24-entry comparison identify unchanged “Watch Now” text-paint variability. Both the independent 24-entry and complete 36-entry phone-home comparisons meet the 10% median budget (+4.35%), with every original sample included in the latter. Added CLS is zero, initial request/script counts and prefetch destinations match, and deferred implementations/finder/progress requests remain absent. The report retains the repair's phone-video 360ms tail, the original miss, warmups, all distributions and limitations; no threshold was waived. Shared flag default remains off; Node 24.19.0 differs from the 24.22.1 pin.

Durable lesson: source-language identity must follow the selected content, including fallback. Portals inherit DOM language/direction from their mount point, so declare authored boundaries on actual portal content and preserve translated nested controls separately. No authored copy, external flag/config, importer, live publication, deployment or production mutation is part of this repair; the shared audience flag stays default-off.

## PR #2783 review round 4 completion (2026-10-25)

Completed after the full repaired scope passed validation, starting from exact remote `9635a6e759ac93f4287c095ed6d3a2e207c049aa`. Earlier in-progress notes above describe their historical review rounds. Implementation/validation completion does not merge the PR or authorize rollout; `forge.watch.audience` remains default-off. Scope and exact files: [round-4 plan](../../plans/2026-10-24-pr2783-review-round-4-title-localization.md) and [round-4 validation report](../../reports/2026-10-24-pr2783-review-r4-validation.md).

Grow continuation series/episode titles now have neutral language and automatic direction because their string contracts do not carry the selected title's source locale. The same confirmed issue is repaired in Share introductions/inline kit headings and Partner active/pending download titles. English labels/counts/resources stay English; Arabic titles, English fallback on a real Urdu dub and missing metadata are covered without changing authored copy. Prior Scripture/questionnaire/portal language boundaries, grid geometry, streamed ordered publication expectations, Docker packaging/path filters, effective importer destination guard and category-prefetch repairs remain intact.

Rendered red/green tests and exact-parent browser red controls fail on the original boundaries. Final strict-fence production browser checks pass localization 16/16, geometry/resource checks 6/6 and publication 60/60 without retries, including 12 genuine hosted-Auth Partner cases. Full Web passes 7,033 tests (13 environment skips/one todo); relevant Admin 896, Auth 660 (106 environment skips), experience-schema 70, admin-graphql two and feature-flags 23. All 168 migrations apply to a fresh disposable database; all 22 publication/import/finder/learning-progress DB cases pass. Strict package lint/types, separate E2E lint/types, Admin/Web production builds, schema print/generate zero drift and Docker/importer/default-off safeguards pass. #2782 concurrency, ownership, reset, resume, erasure, migration and schema lineage is preserved.

Matched production loading against exact main `02ecc6be8d34af143e5975156b78d2e46a9e3406` retains 640 measured loads plus 112 warmups, with balanced order, CPU4 and same-build controls, local valid media and an independent HTML/asset replay. All six A/B cells meet the 10% median shell/LCP and added-CLS budget. Stable phone-home replay (64/build) gives shell 40.60→41.45ms, final VIDEO LCP 540→536ms and matched “Watch Now” text paint 104→104ms; CPU4 text paint is 874→876ms. Identical-build A/A text medians vary 148→130ms. Initial deferred implementations and audience/finder/progress requests/writes remain absent. The report retains distributions, confidence intervals, the desktop-video 448ms post-network image-readiness tail and all earlier diagnostic cohorts; it claims neither identical tails nor external-network-only causation.

Browser runs block Mux Data/all external telemetry and external POSTs, first-party measurement/playback and actual-build Watch-event actions; media is fulfilled locally and real auth/publication remains intact. Server test instrumentation blocks external TCP, shared local telemetry-agent ports and UDP. A deeper request audit found a missed first-party playback endpoint; the fence was corrected and affected video measurements plus all browser suites rerun in full. Negative controls pass with zero external peers. No live publication/import, external config/flag change, production mutation, merge or deployment is part of this repair.

Durable lessons: audio/UI language cannot establish a fallback title's language; use selected source metadata or a neutral exact-text boundary. Audit first-party measurement routes and server telemetry agents as well as external analytics hosts. Keep LCP candidate identity, transfer/readiness/paint stages, all samples and same-build controls so a frame-boundary or decode/scheduling tail is not presented as an attributed code regression.

## 2026-10-25 exact-head CI localization repair

Starting from `3efaf3812f4be49f5d874e26d042d44e6c7e952c`, the exact Web CI command reproduced a test-only race: a fixed 100ms wait expired before the real lazy Grow import completed. Await module completion inside React act and assert the authored question heading, named Scripture section, exact selected text and independent Arabic/RTL versus English/LTR boundaries. All 20 fresh-process checks, full Web (7,033 passes), strict lint/types, 16 production localization browser cases, schema/introspection zero drift and flag safeguards pass. No application or prior repair changes; status remains complete.

The separate recommendation annotation occurs after successful schema generation/migrations. Exact main and candidate each pass all 168 migrations and 63 native integration cases; twelve further interleaved idle/CPU-loaded runs pass the existing five-second test limit. The test and recommendation/migration paths are inherited unchanged. The original CI stall is not reproduced or attributed to this PR; no timeout or recommendation behavior is changed. Exact commands, timings, setup corrections and limitations: [CI validation report](../../reports/2026-10-25-pr2783-ci-localization-test-validation.md). The round-4 performance corpus is retained unchanged, the flag remains default-off, and no live publication/import, external configuration or production action occurs.

## 2026-10-25 role-menu language and keyboard repair

Starting from exact `fd7883f0bf30000c938c7c53216ac3c4ce088a39`, carry the resolved configuration locale through both home/video presence registrations into header copy; keep English menu chrome separate and unknown content neutral. Complete native menu-button opening, managed focus, wrapping arrows/Home/End/character navigation, selection/Escape focus return, native Tab departure and outside pointer/focus dismissal. Preserve the deterministic lazy-import fix and all prior runtime repairs.

Validation: 600 cold component test executions; exact full CI Web command 7,046 passes (13 environment skips, one todo); final six menu browser cases repeated ten times (60/60); existing localization/geometry/resource browser suites 22/22; strict lint/types/format, production builds, flags 23/23 and schema/introspection zero drift. All four matched parent/candidate loading cells pass the plan budgets across 256 measured loads plus 64 warmups, with deferred-resource, prefetch, storage and telemetry guards intact. The earlier exact-main performance corpus retains all 17 hashes. The inherited recommendation timeout/code remains unchanged; the disposable fixture still has all 168 migrations. Status remains complete; the audience default remains off. Exact distributions, scope, setup corrections, limitations and evidence: [role-menu validation report](../../reports/2026-10-25-pr2783-role-menu-validation.md).

## 2026-10-25 round-6 radio and tab accessibility repair

Starting from exact `d754d983e28ca4eede40e98bbc099a07ce8e600f`, replace course/Finder role-radio buttons with controlled native radios and visible label focus indicators. Complete Admin audience tabs and confirmed sibling resource tabs with automatic activation, one roving entry, arrows/Home/End, stable tab/panel ownership and visible focus. English control chrome explicitly owns LTR; authored language boundaries and RoleChip behavior remain intact. Editor navigation never saves or publishes and retains authored edits.

Implementation validation is complete: 330 cold Web and 50 cold Admin focused tests; exact CI Web 7,049 passes and Admin 9,874 passes; retained localization/geometry/RoleChip browser coverage 28/28; publication 50/50 including ten genuine hosted-Auth Partner questionnaire cases; final traced resource-tab repetition 48/48. The report retains both 179/180 intermediate combined cohorts and their distinct touch/focus precondition corrections rather than presenting either as a clean 180-case run. Strict lint/types/format, production Web/Admin builds, schema/introspection zero drift, default-off flags, all 168 fresh migrations, 22 disposable publication/import/finder/progress DB cases and two Docker packaging guards pass.

All four incremental initial-load cells and four course/editor mount/update cells meet the documented budgets across 512 measured entries plus 128 warmups. Telemetry is fully fenced, local media remains functional, deferred implementations stay absent before intent and no new eager request/prefetch/write path is introduced. All prior repairs and exact-main performance corpora are retained. Status returns to complete only after this validation; it does not authorize rollout, merge or deployment. Exact distributions, files, failed controls, setup corrections and limitations: [round-6 validation report](../../reports/2026-10-25-pr2783-round-6-controls-validation.md).

## 2026-10-25 round-7 painted focus and cold return repair

Starting from exact `8e39c679069938b51b743186d60e7838f059b693`, replace invisible role-tab/course focus treatments with contrasting, inset keyboard indicators across the audited Grow surfaces and Story portal. Preserve native radio labels, roving tabs, localized content boundaries and pointer geometry. Coalesce the explicit lesson return's persona/course imports, render directly after completion and isolate the optional prayer shelf so serial lazy reveals and shelf layout cannot delay returned controls. Ordinary entry retains implementation deferral; the admitted preload mounts nothing and performs no progress/account I/O. Shared carousel, prayer implementation, learning-progress/ownership/reset/resume lineage, Admin/Auth, schema/migrations, flags, importer safeguards and earlier repairs remain unchanged.

Runtime validation passes: 940 cold focused Web executions, exact CI Web 7,065 and Admin 9,874 passes, 24 painted-focus cases with 72 contrasting-pixel measurements, retained localization/geometry/menu 28/28, corrected controls 130/130 plus final 13/13, and publication 50/50 with ten genuine local hosted-Auth Partner flows. Strict types/lint, production Web/Admin builds, schema/introspection zero drift, default-off flags, all 168 fresh migrations, 22 disposable DB cases and two Docker packaging guards pass. The unchanged actual Docker image is not rebuilt this round.

Controlled primary matrices retain 784 measured navigations and 240 warmups, plus separate failed-fixture/exploratory diagnostics. Valid-media cold return mount/paint medians versus exact `02ecc6b…` are phone 394.15→403.85ms (+2.46%)/444→450ms (+1.35%) and desktop 412.6→423.6ms (+2.67%)/542→526ms (−2.95%). A/A, replay, all four ordinary-entry cells and incremental no-scroll CLS pass their budgets. Request/script counts stay unchanged; deferred audience implementations, prefetch destinations, initial writes and external peers remain guarded. The report records added bootstrap bytes, inherited viewing-resume reads, media-cache fixture corrections, intervals/tails and limitations without deleting failed samples. Repository-wide formatting also passes; the repaired scope is complete after this validation. Exact files, commands, evidence and durable lessons: [round-7 report](../../reports/2026-10-25-pr2783-round-7-focus-return-validation.md). No merge, deployment, external configuration, live publication/import, external telemetry or production mutation is authorized.
