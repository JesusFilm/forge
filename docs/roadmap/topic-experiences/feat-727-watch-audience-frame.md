---
id: "feat-727"
title: "Watch audience frame and three-question journeys"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 5
depends_on: []
blocks:
  - "feat-728"
tags:
  - "web"
  - "watch"
---

## Problem

Deliver stage 1 of the six-stage audience stack. The shared frame and all four three-question journeys are implemented; the prototype remains read-only evidence.
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

## Local completion evidence — 2026-10-17

- U1: 42 focused role/configuration tests passed. U2/integration: 298 Web tests and 23 feature-flag tests passed; Web lint/typecheck, feature-flag typecheck and production build passed.
- Browser: all ten named scenarios passed (nine in the first run, Spanish navigation/reload case passed after warming Admin and refreshing the isolated local cache). Both surfaces, all roles, 390px keyboard/overflow and canonical Spanish audio navigation are covered.
- Matched production cold entries: three runs per route and viewport, twelve parent and twelve stage samples. No median LCP/player-readiness increase; maximum added CLS 0.00932. Existing account-header session request occurs once in both builds; audience adds no account/finder/course work before intent.
- Native real playback: same video element remained playing across a role change; source block keys, authored order and manifests remain characterized by regression tests. Public HTML retains ISR cache headers and sets no cookie.
- Durable raw receipts and comparison: /home/lado/.local/share/forge-watch-stack-20261017/stage1-\*. No deployment, production write or shipping claim. Configured GA/Datadog integration tests pass; local external telemetry is not configured. Existing local recommendation admission worker is unavailable in both control and changed builds.

## Rollout assumption

Autonomous implementation keeps `forge.watch.audience` default-off across the six stages. R1 describes the enabled frame. The release owner enables it after normal deployment and release verification; implementation completion does not deploy or change LaunchDarkly. Review advisory #9 is recorded without changing behavior.

## Review regression verification (2026-10-17)

Rollout advisory recorded without changing the default-off behavior; implementation does not enable the flag or deploy.

Detailed commands, red/green logs, real runtime proof, limits and six-stage reassembly receipts: `/home/lado/.local/share/forge-watch-stack-20261017/debug-review-r1/`.
