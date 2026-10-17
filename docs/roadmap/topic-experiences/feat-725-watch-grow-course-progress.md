---
id: "feat-725"
title: "Grow course story and durable account progress"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-10-17"
duration: 10
depends_on:
  - "feat-724"
blocks:
  - "feat-726"
tags:
  - "web"
  - "auth"
  - "graphql"
---

## Problem

Deliver stage 5 of the six-stage audience stack. Implementation has not started; the prototype is evidence only.
The governing scope, product requirements, technical decisions, verification and completion contract are in [2026-10-17-0010-feat-watch-audience-stack-plan](../../plans/2026-10-17-0010-feat-watch-audience-stack-plan.md).
This ticket covers U8, U9, U10 only; keep a separate PR whose base is the preceding stage PR.

## Entry Points — Read These First

1. `docs/plans/2026-10-17-0010-feat-watch-audience-stack-plan.md`: Goal Capsule, Product Contract, this stage's U-IDs, Verification Contract and Definition of Done.
2. `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`; also Admin/Auth/typed-client guides when touched.
3. `docs/analytics-and-recommendation-policy.md`: configured telemetry, accepted coverage, and current enablement policy.
4. `apps/admin/prisma/schema.prisma`: current pattern or planned addition named by the unit.
5. `apps/admin/prisma/migrations/`: current pattern or planned addition named by the unit.
6. `apps/admin/src/services/watch-learning-progress.service.ts`: current pattern or planned addition named by the unit.
7. `apps/admin/src/services/watch-learning-progress.service.test.ts`: current pattern or planned addition named by the unit.
8. `apps/admin/src/services/watch-learning-progress.service.db.test.ts`: current pattern or planned addition named by the unit.
9. `apps/admin/src/graphql/types/watch-learning-progress.ts`: current pattern or planned addition named by the unit.

## Grep These

- `U8.`
- `U9.`
- `U10.`
- `WatchSectionRenderer|WatchHomeExperiencePage|WEB_USER_PRINCIPAL|watchSetting|watchAudience`

## What To Build

### U8. Account-owned learning progress backend

**Goal:** Add durable learning state with enforceable subject ownership.

**Requirements:** R8, R12; KTD8–KTD9.

**Dependencies:** U6's real identity integration.

**Files:** Modify `apps/admin/prisma/schema.prisma`, add one forward-only migration under `apps/admin/prisma/migrations/`; new `apps/admin/src/services/watch-learning-progress.service.ts`, `apps/admin/src/services/watch-learning-progress.service.test.ts`, `apps/admin/src/services/watch-learning-progress.service.db.test.ts`, `apps/admin/src/graphql/types/watch-learning-progress.ts`, `apps/admin/src/graphql/types/watch-learning-progress.test.ts`; modify `apps/admin/src/auth/permissions.ts`, `apps/admin/src/graphql/context.ts`, `apps/admin/src/graphql/schema.ts`; regenerate SDL/introspection; new `apps/web/src/lib/watch-learning-progress.ts`, `apps/web/src/lib/watch-learning-progress.test.ts`, `apps/web/src/app/api/learning-progress/route.ts`, `apps/web/src/app/api/learning-progress/route.test.ts`; extend `apps/auth/src/services/account-deletion.service.ts` and its tests, plus the existing Admin account-deletion erasure seam.

**Approach:** Implement KTD8–KTD9 with validated known course/version/lesson/step IDs and bounded structured payloads, without arbitrary free text or userId arguments. Add own-data permissions only, and cover principal distinctions. GET/POST/DELETE are dynamic private/no-store; Web checks same-origin mutation requests and forwards the verified user's token to Admin using a request-scoped client. Integrate learning erasure transactionally with the existing account deletion path. Deleting progress and deleting an Auth account must not resurrect stale in-flight state.

**Execution note:** Start with cross-user and reset/conflict integration cases before wiring UI.

**Test scenarios:**

1. User A saves and reads their lesson; user B, anonymous, Consumer Bearer and unrelated editorial principal cannot read or mutate A's record.
2. Inactive/expired/wrong-client/wrong-environment tokens and cross-origin mutations are denied.
3. Same expected revision racing twice yields one update and one explicit conflict; a stale pre-reset write cannot recreate reset progress.
4. Unknown course/version/step and oversized state are rejected without a partial write.
5. Database errors return an actionable failure rather than empty successful progress.
6. Account deletion removes learning records with the existing erasure contract; failure does not claim full deletion.

**Verification:** Real isolated DB and checked-token GraphQL → Web route integration prove ownership, persistence, conflict and erasure. Security review explicitly approves the additive own-data permission set.

### U9. Grow content and course definition

**Goal:** Port useful Grow content with accurate provenance and no simulated community.

**Requirements:** R8, R10–R11; KTD10.

**Dependencies:** U2; content work can run alongside U8.

**Files:** New `apps/web/src/components/watch/WatchGrow.tsx`, `apps/web/src/components/watch/WatchGrowPlans.tsx`, `apps/web/src/components/watch/WatchGrowCourse.tsx`, `apps/web/src/components/watch/WatchGrowPrayer.tsx`, colocated tests, `apps/web/src/lib/watch-grow-content.ts`, `apps/web/src/lib/watch-grow-content.test.ts`, `apps/web/src/lib/beginning-with-jesus.ts`, `apps/web/src/lib/beginning-with-jesus.test.ts`.

**Approach:** Port nine lessons from the source-backed prototype into versioned stable lesson/movement/step IDs. Keep plans as real external destinations and prayer as dated guides with attribution. Lesson first view explains its benefit. Use an accessible lesson sheet for all lessons. Keep draft reflection text browser-local with a clear label; use the same draft store in sheet and story. Source images use `next/image`, current approved hosts, and optimized derivatives. Do not port generated presence/counts, fake answers, group join, sponsor claims, or notification promises.

**Test scenarios:**

1. All nine lessons have stable IDs, benefits, valid source references and usable lesson navigation.
2. An anonymous visitor opens course and prayer without a login wall.
3. A September guide remains labelled September in October and links to its actual source.
4. A missing/failed external image or optional guide leaves readable content and a working source hub.
5. Local reflection drafts are labelled device-only and contain no fabricated social response.

**Verification:** Content/source audit plus responsive sheet behavior; no unrequested subscription, prayer or group submission.

### U10. Lesson story and durable progress integration

**Goal:** Deliver the demonstrated 26-card lesson-1 experience with honest saved progress.

**Requirements:** R8, R10–R12; AE4; KTD9–KTD10.

**Dependencies:** U8, U9.

**Files:** New `apps/web/src/components/watch/WatchGrowStory.tsx`, `apps/web/src/components/watch/WatchGrowStory.test.tsx`, `apps/web/src/lib/watch-learning-progress-client.ts`, `apps/web/src/lib/watch-learning-progress-client.test.tsx`, `apps/web/e2e/watch-grow-progress.spec.ts`; integrate `apps/web/src/components/watch/WatchGrowCourse.tsx`.

**Approach:** Use a real modal/dialog portal with focus containment, Escape and restored body scroll. Acquire shared Watch modal activity at open intent, before lazy content resolves, and release through the existing close lifecycle; never add dialog-local player resume logic. Keep all 26 semantic cards and both story/sheet edit views against shared draft/progress adapters. Persist structured progress only after signed-in changes; debounce resume writes within the active session, flush safely on close, and visibly report save failures/conflicts. Versioned step identity maps stored progress; unknown retired steps are ignored without marking new content complete. Explicit completion is independent of navigation or a timer. While anonymous, label progress as unsaved and offer the existing hosted sign-in only when the visitor asks to save; a safe return restores the same lesson/card without automatically completing it. Require a fresh explicit save/completion action after verified sign-in. Cancelling login returns to the open lesson with no saved-progress claim.

**Test scenarios:**

1. Covers AE4. Card 1 explains benefit; all 26 cards can be reached; card 26 alone creates no completion.
2. Story/sheet draft edits agree, but account progress sync never sends free-text drafts.
3. Escape/close returns focus and scroll; arrows do not intercept typing; reduced motion and 390px layout stay usable.
4. A second signed-in device resumes saved progress; sign-out/account switch drops the old user's cached state and ignores late responses.
5. Offline/error state keeps visible unsaved progress and offers retry, never a false Saved label.
6. Concurrent/reset/content-version conflicts follow KTD9 and cannot silently complete or erase another version's lesson.
7. Anonymous save intent offers real sign-in; success returns to the same lesson/card and requires explicit confirmation, while cancellation leaves navigation usable and progress visibly unsaved.

**Verification:** Real signed-in two-context browser proof, persistence after reload, modal accessibility, and initial-load plus story-mount performance evidence.

## Constraints

The linked plan governs all KTDs and R-IDs cited above. Preserve the original dirty prototype and recovery outputs. No production migration, live content publication, merge or deployment. No simulated authentication/community or new paid inference route. Before delegation run `agent-quota`; before every worktree/branch, fetch/install/build or broad test use `agent-io-guard -- <foreground command>` and never bypass or nest it. Retain existing auth/download/SEO/language/analytics contracts.

## Verification

Use the linked Verification Contract and the unit-specific scenarios above. Record real behavior, cross-layer checks where applicable, and a page-load comparison against the preceding stack parent. Run formatter and applicable lint/typecheck/build/schema drift checks before PR publication. Update this ticket to in-progress when implementation starts and complete only after the scoped implementation and checks finish; completion does not claim deployment.
