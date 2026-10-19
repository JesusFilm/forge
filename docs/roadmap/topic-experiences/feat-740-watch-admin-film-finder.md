---
id: "feat-740"
title: "Admin-backed Explore film finder"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-10-17"
duration: 5
depends_on:
  - "feat-739"
blocks:
  - "feat-741"
tags:
  - "web"
  - "graphql"
  - "search"
---

## Problem

Deliver stage 2 of the six-stage audience stack. The prototype is evidence only; this ticket records the implemented scope and verification.
The governing scope, product requirements, technical decisions, verification and completion contract are in [2026-10-17-0010-feat-watch-audience-stack-plan](../../plans/2026-10-17-0010-feat-watch-audience-stack-plan.md).
This ticket covers U3, U4 only; keep a separate PR whose base is the preceding stage PR.

## Entry Points — Read These First

1. `docs/plans/2026-10-17-0010-feat-watch-audience-stack-plan.md`: Goal Capsule, Product Contract, this stage's U-IDs, Verification Contract and Definition of Done.
2. `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`; also Admin/Auth/typed-client guides when touched.
3. `docs/analytics-and-recommendation-policy.md`: configured telemetry, accepted coverage, and current enablement policy.
4. `apps/admin/src/services/watch-film-finder.service.ts`: current pattern or planned addition named by the unit.
5. `apps/admin/src/services/watch-film-finder.service.test.ts`: current pattern or planned addition named by the unit.
6. `apps/admin/src/services/watch-film-finder.service.db.test.ts`: current pattern or planned addition named by the unit.
7. `apps/admin/src/graphql/types/watch-film-finder.ts`: current pattern or planned addition named by the unit.
8. `apps/admin/src/graphql/types/watch-film-finder.test.ts`: current pattern or planned addition named by the unit.
9. `apps/admin/src/graphql/context.ts`: current pattern or planned addition named by the unit.

## Grep These

- `U3.`
- `U4.`
- `WatchSectionRenderer|WatchHomeExperiencePage|WEB_USER_PRINCIPAL|watchSetting|watchAudience`

## What To Build

### U3. Bounded Admin film-finder projection

**Goal:** Replace the harvested film display inventory with an authoritative query.

**Requirements:** R5; KTD6.

**Dependencies:** U1's semantic lane IDs; no UI dependency.

**Files:** New `apps/admin/src/services/watch-film-finder.service.ts`, `apps/admin/src/services/watch-film-finder.service.test.ts`, `apps/admin/src/services/watch-film-finder.service.db.test.ts`, `apps/admin/src/graphql/types/watch-film-finder.ts`, `apps/admin/src/graphql/types/watch-film-finder.test.ts`; modify `apps/admin/src/graphql/context.ts`, `apps/admin/src/graphql/schema.ts`; regenerate `apps/admin/schema.graphql` and `packages/admin-graphql/src/admin-graphql-env.d.ts`.

**Approach:** Map the prototype's eight collection slugs to stable allowlisted lane IDs in Admin code. Read canonical relation order and a bounded candidate window, then apply published/nondeleted/nonrestricted Watch visibility and exact playable audio selection. Accept lane IDs, public language slug, duration bucket, and cursor; cap lane IDs at 8 and returned cards at 24 per page. Return localized title/poster/duration and Video/Dub identity without every Dub/download. Deduplicate by Video ID. Keep subtitle-only fallback explicit rather than pretending it is requested audio. Add the public query through normal service/context/Pothos registration.

**Patterns:** `apps/admin/src/services/search-watchability.ts`, `apps/admin/src/services/video.service.ts`, `apps/admin/src/graphql/loaders.ts`, existing collection/download resolvers.

**Test scenarios:**

1. Published collection children retain canonical relationship order and current localized fields after a catalog change.
2. Hidden, deleted, unpublished and Watch-restricted intermediate/leaf nodes cannot enter results.
3. Exact audio and duration filter exclude a too-long or unavailable Dub; empty supply returns valid empty data.
4. Duplicate membership yields one card, and cursors/page bounds do not skip eligible cards within the declared candidate window.
5. An unknown lane or oversized input is rejected before a catalog fan-out.
6. DB-backed fixture proves the resolver reaches the service's actual visibility path and does not fetch thousands of Dubs.

**Verification:** Typed query/codegen and DB contract pass; existing public video/search clients retain their contracts.

### U4. Explore finder over the same-origin Watch API

**Goal:** Deliver a working optional finder after the stage-1 questionnaire.

**Requirements:** R4–R5; AE2; KTD6.

**Dependencies:** U2, U3.

**Files:** New `apps/web/src/lib/watch-film-finder.ts`, `apps/web/src/lib/watch-film-finder.test.ts`, `apps/web/src/app/api/film-finder/route.ts`, `apps/web/src/app/api/film-finder/route.test.ts`, `apps/web/src/components/watch/WatchFindFlow.tsx`, `apps/web/src/components/watch/WatchFindFlow.test.tsx`, `apps/web/src/components/watch/WatchFindLauncher.tsx`, `apps/web/e2e/watch-film-finder.spec.ts`; modify `apps/web/src/proxy.ts` only if the existing `/watch/api/*` mapping needs an explicit entry.

**Approach:** Define gql.tada operations in the Web data module. Expose a bounded GET with the current API rewrite, validate inputs, keep bearer handling server-only, and use no-store browser responses. Load finder code/data on open; represent loading, retry, empty and partial outcomes honestly. Carry selected audio and time filter, cancel obsolete requests, and derive links through canonical route helpers. Remove harvested titles/artwork/runtimes and the prototype's fake timed matching beat.

**Test scenarios:**

1. Covers AE2. A Spanish request returns current Spanish-playable cards and correctly built links.
2. Changing filters rapidly cannot display a stale earlier response.
3. Admin timeout shows retry while player and questionnaire remain usable.
4. Empty/partial inventory is distinguishable from server failure and offers a working catalog destination.
5. The client bundle/response contains no Admin bearer or raw download URL.
6. Closing/reopening and keyboard navigation restore focus without a new search URL.

**Verification:** Real local Admin query → Web GET → finder → playable route proof; finder chunks/network work begin only after opening.

## Constraints

The linked plan governs all KTDs and R-IDs cited above. Preserve the original dirty prototype and recovery outputs. No production migration, live content publication, merge or deployment. No simulated authentication/community or new paid inference route. Before delegation run `agent-quota`; before every worktree/branch, fetch/install/build or broad test use `agent-io-guard -- <foreground command>` and never bypass or nest it. Retain existing auth/download/SEO/language/analytics contracts.

## Verification

Use the linked Verification Contract and the unit-specific scenarios above. Record real behavior, cross-layer checks where applicable, and a page-load comparison against the preceding stack parent. Run formatter and applicable lint/typecheck/build/schema drift checks before PR publication. Update this ticket to in-progress when implementation starts and complete only after the scoped implementation and checks finish; completion does not claim deployment.
