---
title: Admin Core Consumer Migration
type: feat
status: active
date: 2026-04-22
origin: docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md
roadmap: docs/roadmap/platform/feat-104-admin-core-consumer-migration-plan.md
---

# Admin Core Consumer Migration

## Overview

Plan the migration path that moves public content consumers from Strapi-backed
GraphQL to the admin app GraphQL API. This plan assumes "core migration" means
the consumer cutover layer after the admin app foundation: Core-sourced video
and experience data already syncs into `apps/admin`, and the next strategic
question is how `apps/web`, `apps/mobile`, and `apps/tv` can safely read that
new API without a big-bang Strapi decommission.

This is a planning artifact only. Runtime code changes should happen in follow-up
implementation tickets.

## Problem Frame

The repo currently has two content planes:

- Strapi remains the production content API for public consumers through
  `packages/graphql`.
- `apps/admin` is the long-term replacement with Yoga + Pothos + Prisma,
  Core sync, Better Auth, permissions, editorial flows, and pgvector support.

The risky part is not standing up another API; that work exists. The risky part
is preserving the public consumer contract while switching data source, auth
posture, cache behavior, block shapes, and generated GraphQL types. The migration
needs a measured path: inventory, contract decision, parity harness, one vertical
slice, then app-by-app rollout.

## Requirements Trace

- Origin R1-R5: keep the admin app as the sole new API surface and preserve
  service-layer boundaries.
- Origin R13-R20: preserve PUBLIC access as an explicit tier, keep endpoint
  security default-deny, and do not expose vector columns.
- Origin R24-R29: experiences, blocks, videos, media, draft/publish, and
  embeddings are the content surface that consumers will eventually read.
- Origin R31-R35: Core-sourced video data comes through admin Core sync while
  Strapi continues in parallel during transition.
- Roadmap `feat-104`: planning only; define contract, rollout flags, parity
  checks, and rollback before implementation.

## Scope

In scope:

- Public read migration strategy for `apps/web`, `apps/mobile`, and `apps/tv`
- `packages/graphql` contract strategy
- Admin PUBLIC query readiness and schema parity requirements
- Feature flags and fallback behavior
- Parity harness for comparing Strapi and admin responses
- Follow-up roadmap split for implementation phases

Out of scope:

- Strapi decommission
- `apps/manager` migration
- Write-path migration from public apps
- Reworking Core sync internals unless a parity gap blocks consumer reads
- Regenerating or hand-editing generated GraphQL output during planning

## Context & Patterns

Read these before implementation:

- `apps/admin/AGENTS.md` and `apps/admin/CLAUDE.md` — admin architecture, PUBLIC tier, service boundaries, Core-sourced authority rules
- `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md` — original admin foundation sequence and decisions
- `docs/handoffs/2026-04-14-admin-app-v1-handoff.md` — consumer migration adapter listed as P1 follow-up
- `packages/graphql/AGENTS.md` and `packages/graphql/CLAUDE.md` — generated client rules and no hand-edited output
- `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` — web must read through `packages/graphql`
- `apps/mobile/CLAUDE.md` and `apps/tv/CLAUDE.md` — SDUI renderers depend on typed query result shapes plus thin normalizers
- `docs/solutions/cms/admin-app-data-model-decisions.md` — admin model decisions, especially blocks, Core provenance, and naming
- `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md` — why parity must avoid reproducing Strapi relation behavior blindly
- `docs/solutions/integration-issues/mobile-relative-image-url-no-base-origin-20260408.md` — consumer URL handling must remain explicit for native clients

## Key Decisions

- **Use a phased dual-source migration, not direct replacement.** Consumers keep
  a Strapi fallback until parity metrics and route-level rollout prove admin is
  safe.
- **Prefer a dual-client contract in `packages/graphql` for the first phase.**
  Keep the existing Strapi gql.tada environment intact and add an admin-specific
  typed client namespace rather than regenerating the current package wholesale.
  This limits blast radius and lets consumers migrate operation-by-operation.
- **Do not build a permanent Strapi-compatibility schema in admin.** Admin field
  names should stay close where already planned, but avoid cloning Strapi plugin
  shapes just to make migration easy. Use adapter functions in consumers for
  temporary shape normalization.
- **PUBLIC access remains explicit.** Admin GraphQL stays default-deny; every
  consumer-facing query and field must declare PUBLIC eligibility and have tests.
- **First vertical slice should be one read-only experience route.** The best
  candidate is the web watch experience read path because it exercises blocks,
  videos, media URLs, metadata, and ISR/caching without native release risk.
- **Parity is response-level, not schema-only.** Tests should compare normalized
  route data for representative slugs/core IDs, including missing content and
  unpublished content cases.

## Open Questions

- Which production route should be the first vertical slice if `/watch/[slug]`
  has active unrelated edits when implementation starts?
- Should public web/mobile eventually use unauthenticated PUBLIC GraphQL reads,
  an API-token principal, or both? Plan assumes PUBLIC for published content and
  API-token only for server-only preview/admin-like reads.
- Does `apps/tv` cut over with mobile or after web proves the block adapter? Plan
  treats TV as its own later unit because remote-control UX magnifies missing
  media and focus-state regressions.

## Implementation Units

### Unit 1: Consumer Query and Shape Inventory

**Goal:** Build a precise inventory of every Strapi GraphQL operation and the
runtime shape each consumer expects.

**Files:**

- Read: `apps/web/src/lib/content.ts`
- Read: `apps/web/src/lib/fragments/`
- Read: `apps/mobile/src/lib/queries.ts`
- Read: `apps/mobile/src/lib/normalizer.ts`
- Read: `apps/tv/src/lib/queries.ts`
- Read: `apps/tv/src/lib/normalizer.ts`
- Create: `docs/admin-core-migration/query-inventory.md`

**Approach:**

- Group operations by domain: experience pages, video detail, home/library
  sections, search/discovery, language/reference data, and preview-only paths.
- Record each operation's variables, public/private access expectation, cache
  behavior, and renderer dependencies.
- Mark each field as direct admin parity, adapter-required, missing, or
  intentionally deprecated.

**Test scenarios to specify:**

- Inventory includes every `graphql(` operation in web, mobile, and TV.
- Inventory maps every section/block `__typename` used by consumers to the admin
  block union in `apps/admin/src/domain/blocks.ts`.
- Inventory identifies preview-only operations that must not become PUBLIC.

**Verification:**

- `rg "graphql\\(" apps/web/src apps/mobile/src apps/tv/src`
- Manual cross-check against `docs/admin-core-migration/query-inventory.md`

### Unit 2: Admin PUBLIC Schema Readiness

**Goal:** Define the admin GraphQL additions or hardening needed before any
consumer points at it.

**Files:**

- Read/modify later: `apps/admin/src/graphql/types/experience.ts`
- Read/modify later: `apps/admin/src/graphql/types/video.ts`
- Read/modify later: `apps/admin/src/graphql/queries/search.ts`
- Read/modify later: `apps/admin/src/auth/permissions.ts`
- Read/modify later: `apps/admin/src/services/experience.service.ts`
- Read/modify later: `apps/admin/src/services/video.service.ts`
- Test later: `apps/admin/src/graphql/schema.security.test.ts`
- Test later: `apps/admin/src/auth/permissions.test.ts`

**Approach:**

- For each consumer operation from Unit 1, decide whether admin should expose a
  first-class PUBLIC query or whether the consumer should compose existing admin
  queries.
- Keep preview/draft reads authenticated.
- Ensure Core-sourced video fields required by consumers are readable without
  exposing editor-only state or embedding vectors.
- Add schema snapshot coverage for PUBLIC fields so future admin edits cannot
  accidentally change public shapes.

**Test scenarios to specify:**

- Anonymous principal can read only published experience locales and published
  Core-sourced video data.
- Anonymous principal cannot read drafts, content revisions, internal workflow
  state, embeddings, or admin-only user data.
- Querying a published experience returns all block data required by current
  renderers.
- Querying a video by Core ID or slug returns locale, image, dub/download, and
  subtitle fields needed by current consumers.

**Verification:**

- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin typecheck`

### Unit 3: `packages/graphql` Dual-Client Contract

**Goal:** Introduce a typed admin GraphQL contract alongside the current Strapi
contract, without breaking existing imports.

**Files:**

- Read/modify later: `packages/graphql/package.json`
- Read/modify later: `packages/graphql/src/`
- Read/modify later: `packages/graphql/tsconfig.json`
- Generated later: `packages/graphql/src/graphql-env.d.ts` stays Strapi-owned
- Generated later: `packages/graphql/src/admin-graphql-env.d.ts` or equivalent
- Test later: `packages/graphql/src/*.test.ts`

**Approach:**

- Keep current `graphql()` export pointed at Strapi during the first migration
  phase.
- Add an explicit admin namespace, for example `adminGraphql()` and
  `AdminResultOf`, generated from the admin schema.
- Add scripts that can introspect either schema deterministically.
- Document that consumers must opt into admin operations explicitly; no silent
  global schema switch.

**Test scenarios to specify:**

- Existing Strapi operations typecheck unchanged.
- A sample admin operation typechecks against the admin environment.
- Importing `graphql` and `adminGraphql` in the same file does not mix result
  types.
- Generated files are reproducible from clean checkout plus running the documented
  generation commands.

**Verification:**

- `pnpm --filter @forge/graphql generate`
- `pnpm --filter @forge/graphql typecheck`
- `pnpm --filter @forge/graphql test`

### Unit 4: Response Parity Harness

**Goal:** Build an executable comparison tool that proves admin responses can
replace Strapi responses for selected public routes.

**Files:**

- Create later: `packages/graphql/src/parity/normalize-strapi.ts`
- Create later: `packages/graphql/src/parity/normalize-admin.ts`
- Create later: `packages/graphql/src/parity/compare.ts`
- Create later: `packages/graphql/src/parity/fixtures/`
- Test later: `packages/graphql/src/parity/compare.test.ts`
- Optional CLI later: `scripts/compare-content-api-parity.ts`

**Approach:**

- Compare normalized route data, not raw GraphQL JSON.
- Include deterministic checks for IDs, slugs, locale, section order, block
  fields, image URLs, video Core IDs, subtitles, and published-state behavior.
- Produce structured diff output that can become PR evidence.
- Start with fixtures; add live comparison only after env/auth setup is stable.

**Test scenarios to specify:**

- Same published experience in Strapi/admin normalizes to equal route data.
- Admin missing a required block field produces a targeted diff.
- Unpublished or missing content does not normalize as published.
- Relative image URLs are normalized in the same way expected by native clients.

**Verification:**

- `pnpm --filter @forge/graphql test`
- Fixture diffs are stable across repeated runs.

### Unit 5: Web Vertical Slice Behind Feature Flag

**Goal:** Migrate one web route read path to admin behind a reversible flag.

**Files:**

- Modify later: `apps/web/src/lib/content.ts`
- Modify later: `apps/web/src/lib/fragments/`
- Modify later: `apps/web/src/app/**/loading.tsx` if the selected route lacks one
- Modify later: `apps/web/src/app/**/error.tsx` if the selected route lacks one
- Test later: colocated tests near the selected route and `apps/web/src/lib/content.test.ts`
- Env later: `FORGE_CONTENT_API=strapi|admin|dual-read`

**Approach:**

- Add a small content-source selector around existing data access, not inside UI
  components.
- Support `strapi`, `admin`, and `dual-read` modes. `dual-read` serves Strapi
  but logs/admin-compares the admin normalized response.
- Keep metadata generation and ISR/revalidation behavior explicit.
- Fall back to Strapi on admin outage only while the feature flag is not fully
  cut over; once stable, decide whether fallback remains.

**Test scenarios to specify:**

- Default env reads Strapi and produces unchanged rendered data.
- Admin flag reads admin operation and produces equivalent normalized data.
- Dual-read mode serves Strapi while recording an admin parity result.
- Admin errors do not break Strapi mode.
- Metadata and not-found behavior remain equivalent across sources.

**Verification:**

- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web test`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`

### Unit 6: Mobile and TV Adapter Plan

**Goal:** Define the native and TV rollout after web proves the route contract.

**Files:**

- Modify later: `apps/mobile/src/lib/queries.ts`
- Modify later: `apps/mobile/src/lib/normalizer.ts`
- Modify later: `apps/mobile/src/lib/validateUrl.ts`
- Modify later: `apps/tv/src/lib/queries.ts`
- Modify later: `apps/tv/src/lib/normalizer.ts`
- Test later: `apps/mobile/src/lib/normalizer.test.ts`
- Test later: `apps/tv/src/lib/normalizer.test.ts`

**Approach:**

- Keep renderer props stable; translate admin query results in the normalizer.
- Preserve native URL validation and absolute URL handling.
- Treat mobile and TV as separate flags because release cadence, cache
  persistence, and focus/media behavior differ.
- Add fixture-driven tests before trying live admin data.

**Test scenarios to specify:**

- Admin block results normalize to the same `kind` union the renderers already
  consume.
- Existing renderer tests pass without changing renderer prop contracts.
- Relative media URLs are rejected or expanded according to current native rules.
- Apollo cache keys remain stable or are intentionally versioned.

**Verification:**

- `pnpm --filter @forge/mobile typecheck`
- `pnpm --filter @forge/mobile test`
- `pnpm --filter @forge/tv typecheck`
- `pnpm --filter @forge/tv test`

### Unit 7: Rollout, Observability, and Rollback

**Goal:** Make the migration operable before any public traffic depends on it.

**Files:**

- Create later: `docs/admin-core-migration/rollout-runbook.md`
- Modify later: `apps/admin/src/app/dashboard/system-status/page.tsx`
- Modify later: `apps/admin/src/graphql/queries/sync-status.ts`
- Modify later: selected consumer logging/metrics surfaces

**Approach:**

- Define rollout stages: local fixtures, live staging dual-read, web canary,
  web full, mobile preview, mobile release, TV preview, TV release.
- Define rollback as flipping a content-source env var and clearing affected
  caches, not redeploying a code revert.
- Track admin Core sync freshness, parity diff rate, missing content rate,
  GraphQL error rate, and route-level render failures.
- Add a go/no-go checklist for moving each consumer from Strapi to admin.

**Test scenarios to specify:**

- Rollback flag restores Strapi reads without code changes.
- Stale admin Core sync status blocks rollout in the runbook.
- Parity diff above threshold blocks rollout.
- Public admin GraphQL rate limit does not reject normal route traffic in staging.

**Verification:**

- Runbook contains exact env vars, cache-clearing steps, monitoring links/placeholders,
  and owner sign-off checkpoints.
- Dry-run rollback succeeds in staging before production canary.

## Follow-Up Roadmap Split

After this planning ticket, implementation should be split into separate PR-sized
roadmap items:

- Admin PUBLIC schema readiness and schema snapshot hardening
- `packages/graphql` dual-client generation
- Consumer parity harness
- Web first-route dual-read cutover
- Mobile cutover
- TV cutover
- Final Strapi read-path decommission planning

## Risks

- **Schema drift disguised as compatible names:** Admin and Strapi may share
  query names while returning different nullability or nested relation behavior.
  Mitigation: response-level parity harness.
- **PUBLIC auth surface expansion:** Consumer reads can tempt broad anonymous
  access. Mitigation: explicit permission tests and schema security tests.
- **Generated client churn:** Regenerating the existing gql.tada env from admin
  too early could break all consumers at once. Mitigation: dual-client namespace.
- **Block-shape mismatch:** Admin JSONB blocks are intentionally not Strapi
  dynamic zones. Mitigation: adapter layer plus fixture parity tests.
- **Mobile cache persistence:** Native clients may hold old normalized data.
  Mitigation: version cache keys if admin shapes differ materially.

## Ready-To-Implement Checklist

- [ ] Query inventory document exists and covers web/mobile/TV.
- [ ] Contract strategy accepted: dual-client first, no wholesale regeneration.
- [ ] First vertical slice route selected.
- [ ] PUBLIC admin schema gaps are listed as concrete implementation tasks.
- [ ] Parity harness fixture set chosen.
- [ ] Rollback env var and cache behavior documented.
- [ ] Follow-up roadmap tickets created for implementation phases.
