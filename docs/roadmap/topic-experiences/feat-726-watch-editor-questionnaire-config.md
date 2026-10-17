---
id: "feat-726"
title: "Editor-owned Watch audience questionnaires"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-10-17"
duration: 7
depends_on:
  - "feat-725"
blocks: []
tags:
  - "web"
  - "cms"
  - "graphql"
---

## Problem

Deliver stage 6 of the six-stage audience stack. Implementation has not started; the prototype is evidence only.
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
