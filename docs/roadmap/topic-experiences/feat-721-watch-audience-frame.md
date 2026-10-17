---
id: "feat-721"
title: "Watch audience frame and three-question journeys"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 5
depends_on: []
blocks:
  - "feat-722"
tags:
  - "web"
  - "watch"
---

## Problem

Deliver stage 1 of the six-stage audience stack. Implementation has not started; the prototype is evidence only.
The governing scope, product requirements, technical decisions, verification and completion contract are in [2026-10-17-0010-feat-watch-audience-stack-plan](../../plans/2026-10-17-0010-feat-watch-audience-stack-plan.md).
This ticket covers U1, U2 only; keep a separate PR whose base is main.

## Entry Points — Read These First

1. `docs/plans/2026-10-17-0010-feat-watch-audience-stack-plan.md`: Goal Capsule, Product Contract, this stage's U-IDs, Verification Contract and Definition of Done.
2. `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`; also Admin/Auth/typed-client guides when touched.
3. `docs/analytics-and-recommendation-policy.md`: configured telemetry, accepted coverage, and current enablement policy.
4. `apps/web/src/components/watch/watch-role.ts`: current pattern or planned addition named by the unit.
5. `apps/web/src/lib/watch-audience-config.ts`: current pattern or planned addition named by the unit.
6. `apps/web/src/lib/watch-audience-config.test.ts`: current pattern or planned addition named by the unit.
7. `apps/web/src/components/watch/watch-role.test.tsx`: current pattern or planned addition named by the unit.
8. `apps/web/src/components/watch/WatchRoleTabs.tsx`: current pattern or planned addition named by the unit.
9. `apps/web/src/components/watch/WatchRoleJourney.tsx`: current pattern or planned addition named by the unit.

## Grep These

- `U1.`
- `U2.`
- `WatchSectionRenderer|WatchHomeExperiencePage|WEB_USER_PRINCIPAL|watchSetting|watchAudience`

## What To Build

### U1. Shared role preference and serializable definitions

**Goal:** Establish the stable audience/configuration boundary for stage 1.

**Requirements:** R1–R3; KTD1–KTD4.

**Dependencies:** None.

**Files:** New `apps/web/src/components/watch/watch-role.ts`, `apps/web/src/lib/watch-audience-config.ts`, `apps/web/src/lib/watch-audience-config.test.ts`, `apps/web/src/components/watch/watch-role.test.tsx`.

**Approach:** Separate copy/rules from icons and rendering. Define role, question, option and action IDs plus action kind/target, integer weights, and stable order. Validate code definitions with the same invariants needed by stage 6. Use a hydration-safe external store with explicit initialization and reliable storage-event recomputation.

**Patterns:** Existing Watch preference stores and route builders in `apps/web/src/lib/routes.ts`; prototype `apps/web/src/components/watch/watch-role.ts` is behavior reference only.

**Test scenarios:**

1. A valid explicit role wins over a saved different role; malformed hints fall back to a valid saved role, then Explore.
2. A blocked localStorage access still allows switching for the current session without hydration mismatch.
3. A second-tab storage update changes the role; deleting the saved preference restores Explore.
4. Each role has exactly three questions; dangling action IDs and malformed weights fail definition validation.
5. Equal scores preserve authored action order and cannot index outside the action set.

**Verification:** All four role definitions validate; no identity/token or questionnaire answers enter persistent role storage.

### U2. Integrate the audience frame on home and video

**Goal:** Deliver the first PR's complete user-visible shared frame.

**Requirements:** R1–R4, R10, R13; AE1; KTD1–KTD5.

**Dependencies:** U1.

**Files:** New `apps/web/src/components/watch/WatchRoleTabs.tsx`, `apps/web/src/components/watch/WatchRoleJourney.tsx`, `apps/web/src/components/watch/WatchNextSteps.tsx`, `apps/web/src/components/home/WatchHomeRoleBand.tsx`; modify `apps/web/src/components/home/WatchHomeExperiencePage.tsx`, `apps/web/src/components/watch/WatchSectionRenderer.tsx`; optional minimal chip integration in `apps/web/src/components/FloatingSearchProvider.tsx`; new colocated `apps/web/src/components/watch/WatchRoleTabs.test.tsx`, `apps/web/src/components/watch/WatchRoleJourney.test.tsx`, `apps/web/e2e/watch-audience.spec.ts`.

**Approach:** Integrate the existing home/video body boundaries without transcribing the old renderer. Reuse current playable route context and working share/download/language controls. Stage-1 actions use canonical JESUS/conversation-starters/current-film routes, existing history/language pages, and reviewed external resource hubs. No `href="#"`, fabricated local resource route, chat staffing promise, future-stage control, or mock gate remains. One tab panel owns its IDs/focus; all tabs support arrow/Home/End navigation and labelled controls. Keep unavailable later tools out of stage-1 imports.

**Execution note:** Characterize current source-block/manifests and player behavior before editing this heavily changed renderer.

**Test scenarios:**

1. Covers AE1. All roles run the same three-question flow on home and video, with back/change/reset and a real result action.
2. Switching roles resets answers while preserving playback, source block identity and recommendation placement.
3. Keyboard tab selection updates `aria-selected` and the associated panel without duplicate DOM IDs.
4. Unavailable film/language context omits the action rather than yielding a dead link.
5. A direct non-English entry and client navigation retain canonical audio-language URLs and configured analytics.
6. A matched production-build cold entry does not fetch later course/finder chunks or account state before intent.

**Verification:** Desktop and 390px mobile behavior, canonical/page-source parity, player continuity, and initial-load comparison are recorded for both surfaces.

## Constraints

The linked plan governs all KTDs and R-IDs cited above. Preserve the original dirty prototype and recovery outputs. No production migration, live content publication, merge or deployment. No simulated authentication/community or new paid inference route. Before delegation run `agent-quota`; before every worktree/branch, fetch/install/build or broad test use `agent-io-guard -- <foreground command>` and never bypass or nest it. Retain existing auth/download/SEO/language/analytics contracts.

## Verification

Use the linked Verification Contract and the unit-specific scenarios above. Record real behavior, cross-layer checks where applicable, and a page-load comparison against the preceding stack parent. Run formatter and applicable lint/typecheck/build/schema drift checks before PR publication. Update this ticket to in-progress when implementation starts and complete only after the scoped implementation and checks finish; completion does not claim deployment.
