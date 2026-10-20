---
id: "feat-742"
title: "Partner real-account library and download tools"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-10-17"
duration: 6
depends_on:
  - "feat-741"
blocks:
  - "feat-743"
tags:
  - "web"
  - "auth"
  - "i18n"
---

## Problem

Deliver stage 4 of the six-stage audience stack. The prototype is evidence only; this ticket records the implemented scope and verification.
The governing scope, product requirements, technical decisions, verification and completion contract are in [2026-10-17-0010-feat-watch-audience-stack-plan](../../plans/2026-10-17-0010-feat-watch-audience-stack-plan.md).
This ticket covers U6, U7 only; keep a separate PR whose base is the preceding stage PR.

## Entry Points — Read These First

1. `docs/plans/2026-10-17-0010-feat-watch-audience-stack-plan.md`: Goal Capsule, Product Contract, this stage's U-IDs, Verification Contract and Definition of Done.
2. `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`; also Admin/Auth/typed-client guides when touched.
3. `docs/analytics-and-recommendation-policy.md`: configured telemetry, accepted coverage, and current enablement policy.
4. `apps/web/src/components/watch/WatchPartnerResources.tsx`: current pattern or planned addition named by the unit.
5. `apps/web/src/components/watch/WatchPartnerAccount.tsx`: current pattern or planned addition named by the unit.
6. `apps/web/src/lib/watch-partner-resources.ts`: current pattern or planned addition named by the unit.
7. `apps/web/src/lib/watch-partner-resources.test.ts`: current pattern or planned addition named by the unit.
8. `apps/web/src/components/watch/AccountControl.tsx`: current pattern or planned addition named by the unit.
9. `apps/web/src/app/api/auth/session/route.ts`: current pattern or planned addition named by the unit.

## Grep These

- `U6.`
- `U7.`
- `WatchSectionRenderer|WatchHomeExperiencePage|WEB_USER_PRINCIPAL|watchSetting|watchAudience`

## What To Build

### U6. Real account entry and Partner resource library

**Goal:** Connect Partner presentation to real identity without creating a second auth system.

**Requirements:** R7, R10–R11; AE3; KTD7.

**Dependencies:** U2; assembled as PR 4 after PR 3.

**Files:** New `apps/web/src/components/watch/WatchPartnerResources.tsx`, `apps/web/src/components/watch/WatchPartnerAccount.tsx`, colocated tests, `apps/web/src/lib/watch-partner-resources.ts`, `apps/web/src/lib/watch-partner-resources.test.ts`; reuse `apps/web/src/components/watch/AccountControl.tsx`, `apps/web/src/app/api/auth/session/route.ts`; new `apps/web/e2e/watch-partner-account.spec.ts`.

**Approach:** Show library metadata and public links honestly. Real account entry is a normal hosted Auth login/signup link with a safe return target; only supported hosted methods appear. Use any real signed-in account to enable the account tools under KTD7. Include resource categories, source language, source date, destination and optional PDF. Never import prototype `use-watch-account.ts`, `WatchPartnerSignup`, SMS/access-code UI, or modified prototype DownloadButton.

**Test scenarios:**

1. Covers AE3. Login and cancel/error return preserve the page and audience without claiming an account was created.
2. `unlocked=1`, forged local storage, and simulated browser events leave the real session unchanged.
3. Expiry/logout switches tools back to signed-out state; public resource links remain real external links.
4. Resource filtering and a missing PDF show the source page rather than a false download.
5. Session/network failure cannot unlock account-only tools and never disrupts the player.

**Verification:** Real local/approved Auth test-account round trip, sign-out and expiry evidence; no new provider credentials or public-account bypass.

### U7. Partner language selection and bulk-download tools

**Goal:** Use existing catalog and queue capabilities for ministry use.

**Requirements:** R7; KTD7.

**Dependencies:** U6.

**Files:** New `apps/web/src/components/watch/WatchPartnerDownloadTools.tsx`, `apps/web/src/components/watch/WatchPartnerDownloadTools.test.tsx`; reuse/extend `apps/web/src/components/watch/LanguageCombobox.tsx`, `apps/web/src/lib/search-language-actions.ts`, `apps/web/src/lib/watch-collection-download-actions.ts`, `apps/web/src/components/watch/collection-download-options.ts`, `apps/web/src/components/watch/collection-download-queue.ts` and their tests; extend `apps/web/e2e/watch-partner-account.spec.ts`.

**Approach:** Load language options on intent, then lazily resolve selected collection/language downloads and use the sequential queue with cancellation/retry. Keep opaque IDs, actual availability, Terms, filenames, account-gate rollout, safe download resolver and existing limits. Multiple selected languages become ordered queue groups; do not fetch the entire catalog's assets. Describe initiated/failed/cancelled states accurately and explain the browser's multiple-download permission if it intervenes.

**Test scenarios:**

1. Two selected languages generate only eligible ordered downloads and retain canonical relation order.
2. Cancel stops future initiation; failed-item retry does not restart already initiated items.
3. A language lacking downloads yields a clear unavailable state rather than a stream URL used as a file.
4. A direct anonymous request still follows the existing download rollout flag; audience state cannot override it.
5. Public PDF URLs never enter the media proxy/allowlist, and a disallowed supplied URL is rejected.

**Verification:** Local small-fixture bulk flow preserves existing download security and accurately labels browser initiation rather than saved-file completion.

## Constraints

The linked plan governs all KTDs and R-IDs cited above. Preserve the original dirty prototype and recovery outputs. No production migration, live content publication, merge or deployment. No simulated authentication/community or new paid inference route. Before delegation run `agent-quota`; before every worktree/branch, fetch/install/build or broad test use `agent-io-guard -- <foreground command>` and never bypass or nest it. Retain existing auth/download/SEO/language/analytics contracts.

## Verification

Use the linked Verification Contract and the unit-specific scenarios above. Record real behavior, cross-layer checks where applicable, and a page-load comparison against the preceding stack parent. Run formatter and applicable lint/typecheck/build/schema drift checks before PR publication. Update this ticket to in-progress when implementation starts and complete only after the scoped implementation and checks finish; completion does not claim deployment.
