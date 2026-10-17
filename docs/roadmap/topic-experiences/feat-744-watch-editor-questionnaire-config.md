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
