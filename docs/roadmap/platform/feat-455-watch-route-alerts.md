---
id: "feat-455"
title: "Surface Watch route 404 alerts"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-09-04"
completed_date: "2026-09-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "mastra"
  - "admin"
  - "manager"
  - "analytics"
  - "watch"
---

## Problem

GA4 shows substantial `/watch/*` page-not-found traffic, but no automated
control loop distinguishes broken supported routes from malformed external
URLs or makes the actionable failures visible to operators. The explicit
`page_not_found` event currently has no rows, so the system also needs to expose
when it is relying on the existing page-title fallback instead of pretending
the source is complete.

## Entry Points — Read These First

1. `docs/plans/2026-09-04-1506-feat-watch-route-alerts-plan.md`
2. `apps/mastra/src/services/google-analytics-client.ts`
3. `apps/mastra/src/services/support-research/watch-validator.ts`
4. `apps/admin/src/services/watch-route-manifest.service.ts`
5. `apps/admin/src/app/api/seo/ingest/route.ts`
6. `apps/admin/src/graphql/types/managerSeo.ts`
7. `apps/manager/src/app/dashboard/seo/page.tsx`
8. `apps/manager/src/features/shell/manager-shell.tsx`

## Grep These

- `page_not_found`
- `Page not found`
- `watch-route-manifest`
- `verifySeoWorkloadRequest`
- `managerSeo`
- `dashboard/seo`

## What To Build

1. Add an idempotent, daily Mastra workflow that queries GA4 for new Watch
   not-found evidence, validates exact route admission and live HTTP behavior,
   and sends bounded results to Admin.
2. Add Admin-owned run and alert lifecycle storage with a narrow signed
   claim/completion endpoint and authenticated Manager GraphQL read model.
3. Add `/dashboard/alerts` to Manager with summary, source health, traffic,
   classification, and evidence for surfaced issues.
4. Prefer the explicit GA4 event when available and visibly label the current
   all-Watch-path fallback as heuristic. Partial evidence must never resolve an
   existing alert, and open alerts must be explicitly re-probed for recovery.

## Constraints

- The master is a deterministic workflow, not a model agent.
- Do not enable GA collection or decide the unresolved Web consent policy.
- Do not change Watch routes, sitemap, canonicals, or content availability.
- Do not share Mastra storage with Manager or add broad service credentials.
- Only fixed-host, bounded GET validation is allowed; persist no bodies,
  headers, cookies, IPs, or raw provider payloads.
- Every GA4 property requires one explicit production-origin mapping; never
  infer a target from a host allowlist.
- GA monitoring is post-request detection. A literal before-first-viewer
  guarantee requires a separate deploy-time synthetic route gate.
- Production deploys follow the normal PR-to-main flow.

## Verification

- Admin: 401 test files passed, 6,109 tests passed; typecheck and lint passed.
- Mastra: full test suite passed; focused workflow/client/probe coverage,
  typecheck, and lint passed.
- Manager: 150 test files and 1,173 tests passed; typecheck, lint, and the
  production Next.js build passed.
- Shared Watch URL policy: generated localized-title drift check, 75 tests,
  typecheck, and lint passed. The Web catalog parity test passed.
- Prisma schema format, validation, and client generation passed. Admin GraphQL
  schema and gql.tada introspection were regenerated successfully.
- Browser verification covered populated/unavailable report rendering, 390px
  horizontal overflow, Alerts navigation, and an axe scan with zero violations.

## Resolution

Implemented a default-off daily Mastra workflow that reads the explicit GA4
`page_not_found` event and the generated localized-title fallback as separate
quality lanes, classifies normalized `/watch/*` paths against a fresh Admin
route manifest, and attaches bounded allowlisted live-probe evidence. Admin now
owns idempotent run claims, progress, alert episodes, retention, and a strict
versioned completion report. Manager exposes the resulting operator report at
`/dashboard/alerts` with source health, impact, evidence, lifecycle, and cursor
pagination.

The monitor remains post-request detection and is disabled until receiver-first
deployment and a reviewed dry run. Explicit Web not-found telemetry and any
deploy-time zero-viewer route gate remain follow-up work in `feat-456`.
