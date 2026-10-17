---
id: "feat-729"
title: "Share film kits and practical ideas"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-10-17"
duration: 4
depends_on:
  - "feat-728"
blocks:
  - "feat-730"
tags:
  - "web"
  - "watch"
---

## Problem

Deliver stage 3 of the six-stage audience stack. The prototype is evidence only; this ticket records the implemented scope and verification.
The governing scope, product requirements, technical decisions, verification and completion contract are in [2026-10-17-0010-feat-watch-audience-stack-plan](../../plans/2026-10-17-0010-feat-watch-audience-stack-plan.md).
This ticket covers U5 only; keep a separate PR whose base is the preceding stage PR.

## Entry Points — Read These First

1. `docs/plans/2026-10-17-0010-feat-watch-audience-stack-plan.md`: Goal Capsule, Product Contract, this stage's U-IDs, Verification Contract and Definition of Done.
2. `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`; also Admin/Auth/typed-client guides when touched.
3. `docs/analytics-and-recommendation-policy.md`: configured telemetry, accepted coverage, and current enablement policy.
4. `apps/web/src/components/watch/WatchShareIdeas.tsx`: current pattern or planned addition named by the unit.
5. `apps/web/src/components/watch/WatchShareKit.tsx`: current pattern or planned addition named by the unit.
6. `apps/web/src/lib/watch-share-kit.ts`: current pattern or planned addition named by the unit.
7. `apps/web/src/lib/watch-share-kit.test.ts`: current pattern or planned addition named by the unit.
8. `apps/web/e2e/watch-share-kit.spec.ts`: current pattern or planned addition named by the unit.
9. `apps/web/src/lib/share.ts`: current pattern or planned addition named by the unit.

## Grep These

- `U5.`
- `WatchSectionRenderer|WatchHomeExperiencePage|WEB_USER_PRINCIPAL|watchSetting|watchAudience`

## What To Build

### U5. Share ideas and film kits

**Goal:** Make the Share audience useful beyond the initial links.

**Requirements:** R6; KTD2–KTD3.

**Dependencies:** U2; assembled as PR 3 after PR 2.

**Files:** New `apps/web/src/components/watch/WatchShareIdeas.tsx`, `apps/web/src/components/watch/WatchShareKit.tsx`, colocated tests, `apps/web/src/lib/watch-share-kit.ts`, `apps/web/src/lib/watch-share-kit.test.ts`, `apps/web/e2e/watch-share-kit.spec.ts`; reuse `apps/web/src/lib/share.ts` and current Share controls.

**Approach:** Use the current film and recipient audio choice to compose a copyable canonical link and invitation. Include factual conversation prompts, host-a-gathering guidance and real source PDFs/pages. A downloadable kit may be an accessible print view of the selected film/link/prompts, with native print/save; do not advertise an unbuilt ZIP or email delivery. Home offers an existing collection until a film is selected.

**Test scenarios:**

1. Recipient language changes link audio without changing the sender's page language.
2. Missing authored study prompts use explicitly original editorial suggestions, never claims that a guide exists.
3. Clipboard/share API refusal offers selectable text and preserves the kit.
4. Print view includes title, link, source attribution and prompts with no hidden controls or private answers.
5. All guide/film actions resolve, and unavailable resources are removed without breaking Share.

**Verification:** Mobile/desktop copy/native-share/print behavior and language URLs work with real local catalog data.

## Constraints

The linked plan governs all KTDs and R-IDs cited above. Preserve the original dirty prototype and recovery outputs. No production migration, live content publication, merge or deployment. No simulated authentication/community or new paid inference route. Before delegation run `agent-quota`; before every worktree/branch, fetch/install/build or broad test use `agent-io-guard -- <foreground command>` and never bypass or nest it. Retain existing auth/download/SEO/language/analytics contracts.

## Verification

Use the linked Verification Contract and the unit-specific scenarios above. Record real behavior, cross-layer checks where applicable, and a page-load comparison against the preceding stack parent. Run formatter and applicable lint/typecheck/build/schema drift checks before PR publication. Update this ticket to in-progress when implementation starts and complete only after the scoped implementation and checks finish; completion does not claim deployment.
