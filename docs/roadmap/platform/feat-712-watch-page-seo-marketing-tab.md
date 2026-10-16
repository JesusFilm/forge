---
id: "feat-712"
title: "Add an admin-only SEO marketing tab to Watch video pages"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-10-16"
duration: 8
depends_on:
  - "feat-344"
  - "feat-355"
blocks: []
tags:
  - "platform"
  - "watch"
  - "admin"
  - "seo"
  - "analytics"
---

## Problem

Administrators deciding what to improve on a Watch video must currently move
between the public page, Manager's SEO ledger, analytics providers, and audit
reports. The approved prototype unifies that evidence, but it looks like a
standalone application and uses illustrative values. The production feature
must live inside the actual Jesus Film Watch page, use authoritative stored
data, explain unavailable or partial evidence, and remain completely absent for
people without Admin authority.

## Entry Points — Read These First

1. `docs/plans/2026-10-16-1700-feat-watch-page-seo-marketing-tab-plan.md` — implementation and verification contract.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — static standalone and contextual Watch routes.
3. `apps/web/src/components/watch/WatchPageClient.tsx` and `WatchSectionRenderer.tsx` — current Watch client boundary and section order.
4. `apps/web/src/components/watch/WatchBody.tsx` and `watch-section-styles.ts` — the visual surface this feature must extend.
5. `apps/web/src/auth/web-session.ts`, `lib/auth-session.ts`, and `app/api/auth/session/route.ts` — identity without current Admin authorization.
6. `apps/admin/src/graphql/types/managerSeo.ts`, `services/seo-experiment.service.ts`, and `auth/permissions.ts` — SEO authority, permissions, and signed decisions.
7. `apps/manager/src/features/seo/` and `apps/manager/src/lib/seo-proposal-decision-route.ts` — existing presentation and approval patterns.
8. `docs/solutions/architecture-patterns/mastra-seo-experiment-ledger-boundary.md` and `bounded-versioned-admin-owned-agent-job-audit-report.md` — trust and retention boundaries.
9. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — mandatory frontend load proof.

## Grep These

- `WatchBody`
- `SyntheticBlock`
- `force-static`
- `verifyAuthSession`
- `createUserAdminClient`
- `CONSUMER_BEARER_PERMISSIONS`
- `read:manager-seo`
- `managerSeoWorkspace`
- `managerSeoRun`
- `approveManagerSeoProposal`
- `rejectManagerSeoProposal`
- `SeoEvidenceObservation`
- `watchVideoStructuredDataJson`
- `WATCH_ANALYTICS_CONTRACT_VERSION`

## What To Build

1. Add an authoritative, server-verified `canViewWatchSeo` capability for a
   currently active Admin. Identity alone, Watch OAuth scopes, and the Web
   consumer bearer never imply this capability.
2. Add a bounded, versioned per-Watch-page SEO read model backed by Admin's
   stored ledger and observations. It must label source, reporting window,
   freshness, and `available`, `partial`, `unavailable`, or `unknown` state.
3. Add a private, no-store Watch API that rechecks authorization on every read
   and mutation. Provider credentials and raw provider payloads remain server
   side.
4. Insert an `SEO & Marketing` tab below the existing Watch body for standalone
   videos and contextual episodes. Preserve the Jesus Film Watch layout,
   typography, content rail, hero, chapters, transcript, and recommendations.
5. Load the tab code and data only after an authorized Admin selects it. For
   anonymous, ordinary signed-in, pending, revoked, and failed authorization,
   render no tab, placeholder, spacing, or privileged data.
6. Present plain-language ranking history, search reach, video watch depth,
   CTA clicks, AI-assistant referrals, social/chat previews, content analysis,
   crawler visits/cache observations, warnings, and opportunities. Never turn
   missing measurements into zero or a fabricated number.
7. Make opportunity outcomes explicit. Apply uses the existing versioned,
   replay-protected approval/materialization path and never directly publishes;
   Decline records the canonical human decision. Show what each action changes
   and its observed or expected click outcome.

## Constraints

- `ADMIN` is the initial eligible role. Editor, Viewer, Manager Operator,
  consumer bearer, and Web user are denied unless a later decision changes the
  contract.
- Keep the public Watch route static and shared-cacheable. Do not call
  `cookies()` or fetch private evidence from its server render.
- Do not widen `WEB_ADMIN_API_KEYS` or treat the consumer bearer as Admin
  authority.
- Do not call GSC, GA4, Firecrawl, Datadog, or another provider on page render.
  Display only stored observations or an explicit unavailable state.
- Keep query-level audit detail within its 29-day retention boundary. Never
  expose credentials, headers, cookies, raw provider bodies, signed URLs, or
  model reasoning.
- Keep standalone search canonical identity distinct from contextual route and
  playback identity.
- Cross-app reuse happens through contracts, not source imports.
- Preserve configured GA and Datadog integrations per
  `docs/analytics-and-recommendation-policy.md`.

## Verification

- Authorization tests cover anonymous, Web user, Viewer, Editor, active Admin,
  revoked Admin, forged identity, upstream failure, and direct API access.
- Contract tests cover available, partial, unavailable, expired, stale, and
  unknown evidence without raw JSON pass-through.
- Component and route tests prove the tab is absent from public SSR/RSC and
  ordinary clients, keyboard accessible for Admins, responsive, and reset when
  the video/language/context changes.
- Decision tests prove Apply/Decline use immutable proposal version/digest and
  signed authorization, reject replay/stale input, and never publish directly.
- Production-build browser checks cover desktop and mobile. Compare anonymous
  before/after JS and RSC bytes, requests, LCP, and player readiness; prove the
  workspace chunk and data request are absent before authorized intent, then
  measure layout shift across panel mount.
- Run focused Web/Admin/Manager tests, typechecks, lint, formatting, schema and
  generated-client sync where touched. Wrap every heavy command with
  `/home/lado/.local/bin/agent-io-guard --`.
