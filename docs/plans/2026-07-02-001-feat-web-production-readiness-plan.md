---
title: Web Production Readiness Gates
type: feat
status: active
date: 2026-07-02
---

# Web Production Readiness Gates

## Overview

Make `apps/web` production readiness explicit and repeatable. The work is not a
new user-facing feature; it is the launch gate that proves Web can build, boot,
serve public Watch routes, refresh published content, and emit enough
observability to operate safely after launch.

## Problem Frame

The repo has already landed major Watch production foundations: admin GraphQL as
the data source, public URL canonicalization, route/data-cache invalidation,
Datadog RUM/APM/log hooks, performance hardening, and URL parity probes. The
remaining risk is coordination drift: readiness knowledge is distributed across
completed roadmap tickets, operation docs, package notes, and a pending
YouVersion prod-like smoke TODO. This plan consolidates those pieces into one
evidence-producing gate for the site.

## Requirements Trace

- R1. Local code gates for Web must pass: generated UI locale check, tests,
  typecheck, lint, and production build.
- R2. The production build must boot under the same shape Railway uses and serve
  `/watch` through the configured base path.
- R3. Required production env vars and optional feature integrations must be
  documented with expected defaults and failure behavior.
- R4. Public Watch route behavior must be validated against production/preview
  parity and canonical URL expectations.
- R5. Revalidation must prove both rendered route output and cached resolver
  data can be invalidated after admin changes.
- R6. Observability must cover outside-in availability, server-side failures,
  client RUM, APM/log forwarding, and source maps for the deployed commit.
- R7. Gated integrations, especially YouVersion Bible Quotes, must have
  prod-like smoke evidence before production traffic sees them.

## Scope Boundaries

- This plan does not redesign Watch UI, URL shape, GraphQL schema, or cache
  topology.
- This plan does not enable Cloudflare HTML caching by itself; it records the
  current app-side readiness gate and leaves edge-cache policy as a separate
  operational decision.
- This plan does not rotate or reveal secrets.

### Deferred to Separate Tasks

- Edge HTML caching policy: use the performance evidence from this gate to file
  a separate Cloudflare/platform ticket if needed.
- Strapi-era preview migration: `STRAPI_PREVIEW_SECRET` remains part of the
  current `/api/preview` surface until a separate admin-preview migration.

## Context & Research

### Relevant Code and Patterns

- `apps/web/package.json` already exposes the core gates:
  `test`, `typecheck`, `lint`, `build`, `probe:watch-urls`, and
  `datadog:sourcemaps`.
- `apps/web/railway.toml` declares Railpack build, Datadog tracer preload in
  `startCommand`, `/watch` healthcheck, and monorepo watch patterns.
- `apps/web/src/env.ts` has required always-on Web data vars
  (`ADMIN_GRAPHQL_URL`, `WEB_ADMIN_API_KEYS`, `REVALIDATION_SECRET`) and optional
  integrations for LaunchDarkly, YouVersion, Algolia, OpenRouter, Datadog, and
  Mux Data.
- `apps/web/src/lib/watch-url-probe.ts` and
  `apps/web/scripts/probe-watch-urls.ts` provide a preview-vs-production route
  parity gate.
- `docs/operations/watch-datadog-availability-incidents.md` defines the
  availability incident shape: public canaries plus corroborating server logs,
  not RUM alone.

### Institutional Learnings

- `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`:
  a per-service `railway.toml` is dead config unless Railway's Config-as-code
  Path points at it; verify `configFile`, start command, and dashboard
  overrides.
- `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`:
  required schema-load env vars can brick Railway deploys; only make vars
  required when the default production path consumes them.
- `docs/solutions/web/nextjs-headers-defeats-route-cache.md`: cacheable Watch
  routes must avoid `headers()`, `cookies()`, and other dynamic APIs in page
  routes.
- `docs/solutions/performance-issues/watch-non-cloudflare-performance-hardening-20260611.md`:
  app-side cold-path work is mostly landed; remaining cold TTFB may require edge
  cache or admin-cache topology evidence.
- `docs/solutions/architecture-patterns/canonical-server-search-analytics-supplemental-rum-pattern.md`:
  server-side logs are canonical for product analytics; RUM is supplemental.

## Key Technical Decisions

- Readiness will be represented as a committed runbook/checklist plus captured
  command and smoke evidence, not only as a conversational checklist.
- The route parity probe should be the default public URL gate because it
  compares final path and status class instead of merely checking `200`.
- Railway config verification is a first-class gate because past incidents show
  committed `railway.toml` can be silently ignored.
- YouVersion passage rendering depends on Admin until a prod-like environment
  proves Admin `YOUVERSION_APP_KEY`, the code-approved language slug/Core id
  version table, and fallback behavior.

## Open Questions

### Resolved During Planning

- Should this use an existing roadmap ticket? No. Existing candidate tickets are
  either stale onboarding (`feat-004`) or completed production slices. A new P0
  platform ticket, `feat-229`, is the right umbrella.
- Is external framework research required? No. The current work is dominated by
  repo-specific deployment, env, cache, and observability contracts with strong
  local prior art.

### Deferred to Implementation

- Exact production and preview origins for parity probing: depends on the
  deployed Railway/Cloudflare environment the operator chooses for the launch
  candidate.
- Exact Datadog monitor IDs and source-map release version: read from Datadog
  and deployment metadata during the production smoke.
- Whether Cloudflare HTML cache should be enabled before broader launch: decide
  from measured TTFB/Lighthouse evidence after the app gate passes.

## Implementation Units

- [x] **Unit 1: Readiness Runbook**

**Goal:** Add a durable checklist that maps each production gate to commands,
expected results, evidence paths, and owner/operator notes.

**Requirements:** R1, R2, R3, R4, R5, R6, R7

**Dependencies:** None

**Files:**

- Create: `docs/operations/web-production-readiness.md`
- Modify: `apps/web/CLAUDE.md`
- Test: none

**Approach:**

- Keep the runbook operator-focused and evidence-producing.
- Include required env matrix, optional integration matrix, launch flag defaults,
  and secret-safe verification language.
- Cross-link the Datadog availability runbook and YouVersion TODO rather than
  duplicating their full contents.

**Patterns to follow:**

- `docs/operations/watch-datadog-availability-incidents.md`
- `docs/operations/watch-search-analytics-datadog.md`

**Test scenarios:**

- Test expectation: none -- documentation-only unit.

**Verification:**

- A new operator can follow the runbook without needing session history or
  scattered completed roadmap tickets.

- [x] **Unit 2: Local Web Gate**

**Goal:** Run and record the local production-readiness commands for Web.

**Requirements:** R1

**Dependencies:** Unit 1 for evidence location, but commands can run earlier.

**Files:**

- Modify: `docs/operations/web-production-readiness.md`
- Test: existing `apps/web/src/**/*.test.*`

**Approach:**

- Run `pnpm --filter @forge/web test`, `typecheck`, `lint`, and `build`.
- Capture failures as concrete follow-up items rather than masking them.
- Include `git diff --check` because this repo relies on clean markdown and
  generated-file diffs staying readable.

**Patterns to follow:**

- Existing verification blocks in `docs/roadmap/platform/feat-172-watch-cache-invalidation-hardening.md`
- Existing package scripts in `apps/web/package.json`

**Test scenarios:**

- Happy path: all Web tests pass with generated UI locales current.
- Error path: any command failure is recorded with command, failing target, and
  next action.

**Verification:**

- The runbook has dated command results for the current candidate commit.

- [ ] **Unit 3: Build/Boot And Railway Contract**

**Goal:** Prove the production build boots with the intended Railway shape and
that the live service honors the committed deployment config.

**Requirements:** R2, R3

**Dependencies:** Unit 2 build success.

**Files:**

- Modify: `docs/operations/web-production-readiness.md`
- Inspect: `apps/web/railway.toml`
- Inspect: `apps/web/src/env.ts`
- Test: `apps/web/src/env.test.ts`, `apps/web/src/instrumentation.test.ts`

**Approach:**

- Run `pnpm --filter @forge/web build`, then `cd apps/web && pnpm start` for a
  local production-build smoke.
- Curl `/watch` through the local server and confirm the app responds through
  the base path.
- In Railway, verify the production deployment's `configFile`, effective build
  command, effective start command, healthcheck path, and required env vars.

**Patterns to follow:**

- `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`
- `apps/web/CLAUDE.md` Datadog observability section

**Test scenarios:**

- Happy path: production build serves `/watch` locally.
- Error path: missing required always-on env vars fail before launch, with the
  missing var named.
- Integration: Railway deployment metadata proves `apps/web/railway.toml` is
  effective, or the dashboard override is documented as canonical.

**Verification:**

- The runbook contains local boot evidence and Railway config evidence for the
  launch candidate.

**Status note (2026-07-02):** Local production-build boot evidence is captured.
Live Railway config verification remains open because production service
metadata was not available in this workspace.

- [ ] **Unit 4: Public URL, Cache, And Revalidation Gate**

**Goal:** Validate public route behavior, cacheability assumptions, and
admin-triggered freshness.

**Requirements:** R4, R5

**Dependencies:** Unit 3 boot success; deployed preview/prod origins available.

**Files:**

- Modify: `docs/operations/web-production-readiness.md`
- Inspect: `apps/web/src/lib/watch-url-probe.ts`
- Inspect: `apps/web/src/app/api/revalidate/route.ts`
- Test: `apps/web/src/lib/watch-url-probe.test.ts`
- Test: `apps/web/src/app/api/revalidate/route.test.ts`
- Test: `apps/web/src/lib/watch-cache-tags.test.ts`

**Approach:**

- Run URL parity against representative production and preview origins.
- Search app routes for `headers()`, `cookies()`, or `draftMode()` imports in
  cacheable page routes.
- Send authorized representative revalidation payloads and confirm the next
  request does not serve stale route/data-cache output.

**Patterns to follow:**

- `docs/solutions/web/nextjs-headers-defeats-route-cache.md`
- `docs/roadmap/platform/feat-172-watch-cache-invalidation-hardening.md`

**Test scenarios:**

- Happy path: known Watch URLs preserve status class and final path between
  production and preview.
- Edge case: expected 404s remain 404s and do not become redirects or resolved
  pages.
- Integration: revalidation clears both route output and data-cache tags for
  representative semantic payloads.

**Verification:**

- `output/watch-url-parity.json` or equivalent evidence shows no hard
  regressions.
- Revalidation smoke evidence names payloads used and first post-webhook result.

- [ ] **Unit 5: Observability, Source Maps, And Gated Integrations**

**Goal:** Prove the launch candidate can be operated after release and that
optional features are either safely disabled or prod-smoked.

**Requirements:** R6, R7

**Dependencies:** Deployed candidate with Datadog/Railway access.

**Files:**

- Modify: `docs/operations/web-production-readiness.md`
- Inspect: `docs/operations/watch-datadog-availability-incidents.md`
- Inspect: `docs/operations/watch-search-analytics-datadog.md`
- Inspect: `todos/006-pending-p1-youversion-app-key-smoke.md`
- Test: `apps/web/src/components/__tests__/DatadogRum.test.tsx`
- Test: `apps/web/src/observability/datadog-logs.test.ts`
- Test: `apps/admin/src/services/scripture-passage.service.test.ts`

**Approach:**

- Verify Datadog service/env/version tags, APM/log forwarding, RUM init, and
  source-map upload for the deployed commit.
- Verify availability monitor installation and composite gate behavior from the
  runbook.
- Keep optional features in their documented default-off or graceful-degrade
  state until prod-like smokes pass.
- Complete the YouVersion prod-like smoke before relying on
  `BibleCitation.passage` for production traffic.

**Patterns to follow:**

- `docs/operations/watch-datadog-availability-incidents.md`
- `docs/solutions/architecture-patterns/canonical-server-search-analytics-supplemental-rum-pattern.md`
- `todos/006-pending-p1-youversion-app-key-smoke.md`

**Test scenarios:**

- Happy path: RUM, APM, server logs, source maps, and availability canaries are
  all tied to the deployed version.
- Error path: Datadog log/source-map delivery failure does not break Web
  requests.
- Integration: YouVersion panel renders server-side passage text only when the
  flag and app key are present, and no browser request exposes the app key.

**Verification:**

- The runbook records Datadog monitor/source-map evidence and either completed
  YouVersion smoke evidence or an explicit launch blocker.

## System-Wide Impact

- **Interaction graph:** Web depends on Admin GraphQL, Admin revalidation
  webhooks, Railway deploy config, Cloudflare routing, Datadog Agent/RUM, and
  optional third-party APIs.
- **Error propagation:** Required always-on env/config failures block launch;
  optional integrations should degrade visibly but not brick boot.
- **State lifecycle risks:** ISR route output and data-cache entries must both
  refresh after admin changes; process-local manifest caches rely on TTLs or
  webhook fan-out.
- **API surface parity:** Public `/watch` URLs and SEO canonical URLs must remain
  stable across preview/prod parity checks.
- **Integration coverage:** Unit tests alone do not prove Railway config,
  Datadog monitor install, source-map upload, or real YouVersion app-key access.
- **Unchanged invariants:** Admin remains the data source through
  `@forge/admin-graphql`; server secrets stay server-only; browser RUM is not an
  availability trigger.

## Risks & Dependencies

| Risk                                                   | Mitigation                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Railway ignores `apps/web/railway.toml`                | Verify deployment `configFile` and effective commands before launch.             |
| Env drift only appears after deploy                    | Treat `apps/web/src/env.ts` plus Railway variables as a launch gate, not a note. |
| Cacheable route accidentally becomes dynamic           | Search page routes for dynamic APIs and inspect build route output.              |
| Preview/prod route drift breaks SEO or links           | Use `probe:watch-urls` status-class/final-path parity.                           |
| Observability exists in code but not in Datadog        | Verify monitors, logs, APM, RUM, and source maps against the deployed commit.    |
| Optional feature flag exposes an un-smoked integration | Keep defaults off until prod-like smoke evidence is attached.                    |

## Documentation / Operational Notes

- Store launch evidence under `output/` or in the readiness runbook with dates,
  commands, origins, and commit/version identifiers.
- Do not paste secret values into docs. Record only presence, source, and
  environment.
- If the readiness gate discovers work outside this launch scope, create a
  follow-up roadmap ticket rather than widening this ticket indefinitely.

## Sources & References

- Roadmap ticket: `docs/roadmap/platform/feat-229-web-production-readiness.md`
- Web guide: `apps/web/CLAUDE.md`
- Railway config: `apps/web/railway.toml`
- Web env schema: `apps/web/src/env.ts`
- Datadog availability runbook: `docs/operations/watch-datadog-availability-incidents.md`
- YouVersion TODO: `todos/006-pending-p1-youversion-app-key-smoke.md`
- Railway config learning: `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`
- Env-var deploy learning: `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
- Cacheability learning: `docs/solutions/web/nextjs-headers-defeats-route-cache.md`
