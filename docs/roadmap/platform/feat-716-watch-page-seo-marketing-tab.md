---
id: "feat-716"
title: "Add an admin-only SEO marketing tab to Watch video pages"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-10-16"
duration: 8
depends_on:
  - "feat-344"
  - "feat-355"
blocks:
  - "feat-717"
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
- `resolveAdminUser`
- `resolveManagerUser`
- `createUserAdminClient`
- `CONSUMER_BEARER_PERMISSIONS`
- `read:manager-seo`
- `managerSeoWorkspace`
- `managerSeoRun`
- `approveManagerSeoProposal`
- `rejectManagerSeoProposal`
- `decideProposal`
- `AccountControl`
- `DatadogRum`
- `SeoEvidenceObservation`
- `watchVideoStructuredDataJson`
- `WATCH_ANALYTICS_CONTRACT_VERSION`

## What To Build

1. Add an authoritative, server-verified `canViewWatchSeo` capability for a
   currently active Admin. A dedicated Admin REST endpoint verifies a separate
   Watch SEO service key, strictly checks the user-delegated Web token, maps its
   subject to an Admin-owned user identity, and reads the live `ADMIN` role.
   Identity alone, Watch OAuth scopes, Manager membership, and the Web consumer
   bearer never imply this capability.
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
7. Make opportunity outcomes explicit. Apply/Decline on Watch opens an
   Admin-origin confirmation bound to the proposal version and digest. The
   Admin action rechecks the live role and binds the decision to the immutable
   proposal version and digest. Its nonce provides audit uniqueness; the unique
   proposal-version decision under a Serializable transaction is the effective
   replay/idempotency guard. The shared decision core creates a draft or ticket.
   Show what each action
   changes and its observed or expected click outcome.

## Constraints

- `ADMIN` is the initial eligible role. Editor, Viewer, Manager Operator,
  consumer bearer, and Web user are denied unless a later decision changes the
  contract.
- Keep the public Watch route static and shared-cacheable. Do not call
  `cookies()` or fetch private evidence from its server render.
- Do not widen `WEB_ADMIN_API_KEYS` or treat the consumer bearer as Admin
  authority.
- Use a separate optional Watch SEO service-key list, include it in the
  cross-list disjointness boot check, and deploy Admin before Web. Existing
  Admins whose User.id differs from their Auth subject must sign in after the
  Admin deploy to create the subject binding before Web is deployed. The
  feature fails closed when it is unset.
- Watch-origin pages never perform privileged writes. They may open an
  Admin-origin confirmation; only Admin's current session and database role may
  authorize the decision.
- Do not add a Watch SEO permission to the generic `WEB_USER` role and do not
  change the Admin GraphQL schema or shared GraphQL client for this REST-owned
  contract.
- Do not call GSC, GA4, Firecrawl, Datadog, or another provider on page render.
  Display only stored observations or an explicit unavailable state.
- Keep query-level audit detail within its 29-day retention boundary. Never
  expose credentials, headers, cookies, raw provider bodies, signed URLs, or
  model reasoning.
- Keep standalone search canonical identity distinct from contextual route and
  playback identity.
- Mask the panel from Datadog RUM collection with the existing privacy
  attribute. Query-level detail remains on Admin rather than the WordPress-
  shared Watch origin.
- Cross-app reuse happens through contracts, not source imports.
- Preserve configured GA and Datadog integrations per
  `docs/analytics-and-recommendation-policy.md`.

## Verification

- The Web evidence route retains `locale` as part of its UI request contract
  even though Admin resolves content by public language slug. Change it only
  with the route, boundary, and parity tests together.
- Before changing the Firecrawl exact-canonical-URL JSON predicate or adding an
  expression index, run `EXPLAIN (ANALYZE, BUFFERS)` against a production-shaped
  database and smoke-test URL normalization. No local database was available
  during this implementation to establish either change safely.

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

## Implementation closeout — 2026-10-16

The Admin authority, retained read model, private Web adapters, embedded Watch
workspace, and Admin-origin decision flow are integrated on this branch.

- `apps/web/src/lib/watch-seo-read-model-adapter.ts` emits controlled,
  query-free opportunity summaries for every proposal state. The private Web
  route accepts only the retained Admin contract, preventing presentation DTOs
  from bypassing that projection. Admin's read model retains current detail but
  suppresses query-bearing proposal prose and diffs at the strict 29-day
  boundary using both the version and source-run creation times.
- Confirmation navigation uses the validated public
  `NEXT_PUBLIC_ADMIN_GRAPHQL_URL` origin independently of private Railway
  transport. Production requires HTTPS; invalid/private navigation fails closed.
- Thresholded, overlapping GSC selection windows produce explicit unavailable
  daily history and page totals. They are never summed, averaged, or assigned
  to observation dates as daily measurements.
- Repeated tab selection preserves ready evidence and makes no extra request.
  Preview text/canonicals match the real Watch metadata helpers for known
  fields; missing snippet/image resolution inputs remain unavailable. Crawler
  rendering mode is preserved only when explicitly stored, otherwise unknown.
- Validation: the integrated suites passed 246 Admin tests and 95 Web tests.
  The final admission correction passed 110 focused Admin tests and 39 focused
  Web tests. Full Admin and Web typechecks, changed-file ESLint, formatting,
  frontmatter validation, and documentation-claim validation passed using
  existing installed tooling. All heavy checks used the disk guard.
- Load-boundary evidence: zero SEO requests before sign-in, one capability
  request before selection, and one evidence request after selection, unchanged
  after repeated activation. Capability results are cached for 30 seconds per
  browser session, while Admin applies broad per-IP admission plus a verified-
  subject quota. The public page, route composition, warmup paths, and dynamic
  import remain unchanged.

Production-shaped PostgreSQL query plans, URL-normalization smoke tests, and
before/after browser timing remain deployment gates tracked by `feat-717`.
No provider integration or generated GraphQL contract was widened.

The local production build could not complete in this managed environment:
Turbopack cannot bind its internal worker port, and the Webpack fallback reaches
compilation but fails on the pre-existing `node:crypto` import in
`recommendation-consent.ts`. Full Web typechecking remains green; `feat-717`
retains the production-build and browser-performance gate.
