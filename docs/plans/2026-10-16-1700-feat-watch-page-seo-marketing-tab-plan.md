---
title: "feat: Add an admin-only SEO marketing tab to Watch video pages"
type: "feat"
status: "active"
date: "2026-10-16"
artifact_contract: "ce-unified-plan/v1"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
roadmap: "docs/roadmap/platform/feat-712-watch-page-seo-marketing-tab.md"
---

# feat: Add an admin-only SEO marketing tab to Watch video pages

## Goal Capsule

Put the approved SEO and marketing workspace inside each real Watch video page
for active Admins only. It must help humans and AI agents understand search
rankings, reach, viewing depth, CTA outcomes, referrals, page content, crawler
behavior, warnings, and next experiments using attributable stored evidence.
The public Watch experience remains visually, behaviorally, and operationally
unchanged until an authorized Admin deliberately opens the tab.

## Requirements

- R1. Standalone and contextual Watch video pages expose one `SEO & Marketing`
  tab below the existing body only to a server-verified active `ADMIN`.
- R2. Anonymous users, ordinary Web users, Viewer, Editor, revoked Admin, and
  authorization failure see no tab, placeholder, reserved space, or private
  evidence.
- R3. Static Watch rendering and shared caching remain public and
  identity-independent; capability and evidence resolve through private,
  no-store endpoints after hydration. The Watch panel is masked from Datadog
  RUM capture and never hosts a privileged write.
- R4. The panel uses the actual Watch content rail, Montserrat typography,
  stone palette, brand-red actions, responsive breakpoints, and accessible tab
  semantics. It does not recreate the page shell or invent public navigation.
- R5. The read model identifies the standalone search canonical, contextual
  route, video, dub/language, source, reporting window, freshness, and coverage
  state for each metric family.
- R6. Search ranking history is presented in plain language, where a smaller
  position number is better, with query, clicks, impressions, CTR, position,
  comparison window, and unknown/partial distinctions.
- R7. Reach includes stored Watch/GA4 page and CTA outcomes, watch-depth
  milestones, AI-assistant referrals, and video-search measurements where
  available. No source is synthesized from another and absent data is never
  represented as zero.
- R8. Content and crawler sections reuse live metadata/structured-data
  generation and stored observations. They label direct HTTP, bot visits,
  caching, and indexing evidence according to what each source can actually
  prove.
- R9. Social and chat previews are deterministic presentations of the current
  canonical URL, title, description, and image, with source provenance.
- R10. Warnings and opportunities state evidence, expected impact, confidence,
  and the exact action. Apply and Decline open an Admin-origin confirmation
  bound to immutable proposal version/digest. The confirmed decision is
  attributed to a live Admin and protected by a single-use server nonce; Apply
  may create a draft or ticket but never directly publish or deploy.
- R11. Detailed query evidence obeys the existing 29-day compaction policy and
  never exposes provider payloads, credentials, headers, cookies, signed URLs,
  or model chain-of-thought.
- R12. Existing Watch analytics, recommendation slots, transcript behavior,
  hero/player activation, language navigation, and Datadog RUM remain intact.

## Assumptions

- “Admin only” means the Admin database's active `ADMIN` role, not dashboard
  admission, Manager Operator membership, or possession of a Watch account.
- The prototype is a content and interaction reference. Its sample metrics,
  custom page shell, Inter font, and invented Details/Transcript tabs are not
  production contracts.
- Provider collection remains owned by Mastra and existing telemetry paths.
  This work reads durable observations; it does not introduce live provider
  calls from Web or Admin page rendering.
- The first complete release may show explicit unavailable cards for metric
  families not yet persisted per page. That is complete behavior, not mocked
  data, and follow-up ingestion can populate the same versioned contract.
- Watch shares an origin with WordPress, so a same-origin script can read a
  Watch CSRF value. Privileged decisions therefore remain on Admin's separate
  origin; moving them inline requires a separate owner-approved security trade.

## Scope Boundaries

### In scope

- Strict Admin capability exchange and per-request enforcement.
- A bounded per-page read model and Admin-origin proposal decision bridge.
- Deferred Watch UI matching the existing video-page design.
- Ranking, reach, watch depth, CTA, AI referral, preview, content, crawler,
  warning, and opportunity states using real stored evidence.
- Focused tests, production-build browser proof, and load-performance evidence.

### Deferred to follow-up work

- New provider ingestion or schema work required for a metric family that has
  no durable per-page source after the read-model audit.
- Generalizing the capability or workspace to Editor or Manager roles.
- Bulk cross-page SEO portfolio views; Manager remains the home for those.

### Out of scope

- Direct publish, deploy, Railway action, or unrestricted content mutation.
- Privileged Apply/Decline POSTs from the Watch origin.
- Live GSC/GA4/Firecrawl/Datadog calls during a Watch request.
- Replacing the existing Manager SEO workspace or run audit pages.
- Changing public Watch navigation or rendering the tab to non-Admins.

## High-Level Technical Design

These sketches describe boundaries and flow; exact types and names follow local
patterns during implementation.

### Component and trust boundary

```text
static Watch page
  -> existing Watch body
  -> tiny client capability gate
       -> Web private session endpoint
            -> Admin authoritative capability REST exchange
       -> authorized selection
            -> deferred SEO workspace chunk
            -> Web private SEO endpoint
                 -> Admin bounded read model
                 -> stored SEO/analytics observations

opportunity action
  -> Admin-origin confirmation
  -> live Admin role + immutable version/digest + single-use nonce
  -> shared canonical proposal decision core
  -> draft/ticket materialization (never publish/deploy)
```

### Authorization and data sequence

```text
browser        Web API             Admin authority          ledger
  | session?      |                       |                    |
  |-------------->| verify identity       |                    |
  |                | service key + user token ---------------->|
  |                |<------ ADMIN/deny ----|                    |
  |<-- null/tab ---|                       |                    |
  | open tab       |                       |                    |
  |-------------->| reverify + read ------>| bounded query ---->|
  |<--------------| typed coverage states |<-------------------|
```

### Evidence-state lifecycle

```text
unavailable -> available -> stale -> compacted
       \           |
        -> partial-+

unknown is a measured absence/coverage state; it never silently becomes zero.
```

### Decision points

```text
not ADMIN?        render nothing
ADMIN, unopened?  render only the tab affordance; load no workspace/data
ADMIN, opened?    load bounded evidence
proposal current? open Admin confirmation for Apply/Decline
proposal stale?   refresh and explain; do not retry a decision blindly
```

## Key Technical Decisions

- KTD1. Keep identity out of the static route and authorize through a dedicated
  post-hydration Admin REST capability exchange with a separate service key,
  strict Web token, and live role read. (session-settled: user-approved — chosen
  over making Watch dynamic because the public page must keep its existing
  design and load behavior.) Governs R1-R4 and R12.
- KTD2. Load the workspace chunk and evidence only after an authorized Admin
  selects the tab. (session-settled: user-approved — chosen over eager loading
  because the feature is invisible to almost every visitor.) Governs R2-R4.
- KTD3. Read durable observations and show explicit coverage states rather than
  making provider calls or inventing prototype metrics. (session-settled:
  user-directed — chosen over mocked production data because the user asked to
  pull analytics and other real sources.) Governs R5-R9 and R11.
- KTD4. Keep the one-click opportunity affordances on Watch, but complete the
  decision on Admin's separate origin. Extract the transaction core of
  `decideProposal`; Manager retains its signed assertion check, while Admin
  supplies the live session actor and a single-use server nonce. (session-
  settled: user-approved — chosen over a privileged Watch-origin POST because
  WordPress shares that origin and can defeat a Watch-local CSRF token.) The
  decision is final; an editorial draft can later be discarded, while a ticket
  outbox entry cannot be retracted. Governs R10-R11.
- KTD5. The panel extends the actual Watch body instead of recreating the hero,
  header, or page shell. (session-settled: user-directed — chosen after the
  standalone mockup was rejected as not using the Jesus Film Watch design.)
  Governs R1, R4, and R12.

## Implementation Units

### U1 — Authoritative Watch SEO capability

- Goal: prove active Admin authority without changing the static page or
  widening consumer/Web-user permissions.
- Files: Admin auth/API contract, Web private session/capability adapter, and
  their focused tests.
- Approach: after the existing account session probe reports signed in,
  exchange a separate Watch SEO service key plus the user's access token through
  a narrow Admin REST contract. Require a Web client (never TV), exact issuer,
  active token, production environment claim, subject-to-user identity (or a
  callback-recorded binding), and a live `role === ADMIN` read. Never resolve by
  request email or Manager membership. Return only capability state; keep only
  a negative result in the tab's in-memory state.
- Requirements: R1-R3, R11; KTD1.
- Test scenarios:
  - Active Admin session returns `canViewWatchSeo=true` without exposing role
    internals or credentials.
  - Anonymous, Web user, Viewer, Editor, revoked Admin, forged token, timeout,
    and malformed response all fail closed.
  - A session without an access token, TV token, other-environment token,
    production token with no environment binding, inactive token, email-only
    match, subject/binding conflict, service-key-only request, and token-only
    request all fail closed.
  - The consumer bearer alone cannot mint the capability, and a stale Admin
    session cookie cannot override a downgraded database role.
- Execution note: add or strengthen failing boundary tests before production
  implementation.

### U2 — Bounded per-page evidence and decision contracts

- Goal: return safe, source-attributed evidence for one canonical Watch video
  and accept immutable proposal decisions.
- Files: Admin services/API or GraphQL contract, schemas/presenters, generated
  contracts if used, and focused tests.
- Approach: compose existing ledger, run, observation, and current page
  metadata into a versioned DTO with per-family coverage. Use a bounded lookup
  for evidence JSON or add an indexed projection; never scan unbounded reports.
  Extract `decideProposal`'s transaction core so the existing Manager assertion
  path and the new Admin-hosted path share version/digest, conflict,
  idempotency, materialization, and no-publish behavior.
- Requirements: R5-R11; KTD3-KTD4.
- Test scenarios:
  - A page with complete stored observations returns bounded ranking, reach,
    viewing, referral, content/crawler, and proposal sections with provenance.
  - Missing provider rows return `unknown` or `unavailable`, never numeric zero.
  - Partial/stale/expired evidence remains typed and retains safe aggregate
    fields only.
  - Valid Admin confirmation records one canonical decision; stale
    version/digest, nonce replay, unauthorized actor, and unsupported direct-
    publish intent fail.
- Execution note: characterize current ledger joins and proposal decision
  behavior before extending them.

### U3 — Private Web read adapter

- Goal: expose U2 only to an Admin browser without leaking private evidence into
  static HTML, RSC, shared caches, or client credentials.
- Files: Web API routes, server-only adapters/schemas, and route tests.
- Approach: verify the Watch session and U1 capability on every request; proxy
  only validated U2 DTOs; use `private, no-store`, bounded inputs, and safe
  failures.
- Requirements: R2-R3, R5, R10-R11; KTD1, KTD3-KTD4.
- Test scenarios:
  - Authorized reads return the typed DTO and no-store headers.
  - Direct anonymous/revoked/forged access returns a denial with no upstream
    evidence body.
  - Invalid content identity and Admin timeout return bounded typed failures.
  - No Watch route accepts proposal-decision writes.

### U4 — Watch integration and deferred workspace

- Goal: add the tab to the actual video page without changing public behavior
  or initial-load cost.
- Files: Watch body/section integration, capability hook/provider, deferred
  workspace boundary, styles, and focused component/route tests.
- Approach: mount a null-rendering boundary after the required recommendation
  slot that immediately follows the existing Watch body;
  display one accessible tab affordance only after U1 confirms Admin; import the
  workspace and request U3 only on selection. Reset on video/dub/context change.
- Requirements: R1-R4, R12; KTD1-KTD2, KTD5.
- Test scenarios:
  - All non-Admin and indeterminate states render byte-equivalent surrounding
    Watch sections with no gap, tab, workspace chunk trigger, or data request.
  - Admin sees the tab on standalone and contextual video routes and can use it
    with pointer and keyboard.
  - Opening loads once; changing video/language/context cancels stale work and
    resets the selected evidence.
  - Existing download, questions, transcript, recommendation, navigation, and
    player tests remain green.
- Execution note: use proof-first component tests; do not add the workspace to
  Watch idle warming.

### U5 — Evidence workspace presentation

- Goal: make the approved information understandable within the Watch visual
  system on desktop and mobile.
- Files: deferred workspace components, presenters, styles, accessibility and
  interaction tests.
- Approach: group Overview, Search, Audience, Content & Crawlers, Previews, and
  Opportunities within the existing content rail. Explain ranking direction,
  add watch-depth milestones, label CTA clicks and sources, and keep warnings
  and actions concise.
- Requirements: R4-R10; KTD2-KTD5.
- Test scenarios:
  - Ranking graph clearly states that position 1 is best and represents missing
    days as gaps.
  - Watch depth and CTA outcomes show denominators/windows and distinguish zero
    from unavailable.
  - Social/chat previews use current canonical metadata and remain responsive.
  - Opportunity cards explain impact; Apply/Decline open the Admin confirmation
    with immutable identity and expose stale, expired, already-decided,
    conflict, replay, rejected, and retryable-error states accessibly.
  - Long localized copy and narrow mobile width do not overflow.

### U6 — Integrated verification and documentation

- Goal: prove authority, correctness, accessibility, responsiveness, and no
  public load regression; leave durable operating guidance.
- Files: browser fixtures/tests, performance evidence, roadmap/plan status, and
  a solution note after verification.
- Approach: run focused tests first, then guarded package checks and a
  production-build browser comparison. Capture source/coverage limitations and
  follow-up ingestion work explicitly.
- Requirements: R1-R12.
- Test scenarios:
  - Desktop and mobile production-build smoke cover Admin open/read/action and
    non-Admin absence.
  - Anonymous before/after request counts, initial JS/RSC bytes, LCP, and player
    readiness stay within normal variance with no SEO chunk/request.
  - Admin mount-window layout shift is measured and the panel reserves stable
    space while loading.
- Test expectation: verification/documentation uses the behavior tests from
  U1-U5 plus recorded browser and performance evidence.

## System-Wide Impact

- Web gains private capability/evidence routes but its public route remains
  statically cached.
- Admin gains one narrow REST authority/read-model surface and an Admin-hosted
  decision confirmation; consumer bearer, generic Web-user permissions, and
  the GraphQL schema remain unchanged.
- Manager remains the portfolio/audit workspace and source of signed decision
  patterns; it is not replaced.
- Mastra remains provider-ingestion owner. A missing durable per-page source is
  a follow-up ingestion requirement, not a reason for Web to call providers.

## Risks and Mitigations

- Authorization confusion: distinguish Watch identity, Admin role, and Manager
  membership; deny every ambiguous case.
- Static-cache regression: prohibit request identity in the page/layout and
  prove private requests occur only after hydration and intent.
- Sensitive evidence leakage: version, bound, validate, no-store, and retain
  query detail under the existing compaction policy.
- Misleading analytics: show source/window/freshness/coverage and never coerce
  missing data to zero.
- Bundle/layout regression: dynamic import after authorized selection and
  measure both initial load and mount-window CLS.
- Unsafe “one click”: Watch performs no privileged write. Admin-hosted,
  version/digest-bound, single-use decisions may create drafts/tickets only;
  stale/replayed actions fail closed.

## Verification Contract

1. Run focused U1-U5 tests after each unit, with red/characterization evidence
   recorded before behavior changes where practical.
2. Run affected Web, Admin, and Manager typechecks, lint, and tests one heavy
   command at a time through `/home/lado/.local/bin/agent-io-guard --`.
3. Verify the REST design leaves `apps/admin/schema.graphql` and
   `packages/admin-graphql` unchanged.
4. Run a production build and T3 collaborative-browser smoke at desktop and
   mobile widths with controlled Admin and non-Admin fixtures.
5. Record initial-load request/byte/timing evidence and deferred mount CLS; a
   screenshot alone is insufficient.
6. Run cross-provider code review for authorization, privacy, API, data
   semantics, UI accessibility, and performance; resolve every validated
   finding before completion.
7. Check formatting for every changed source and Markdown file and inspect the
   final diff for unrelated or unowned changes.

## Definition of Done

- R1-R12 are implemented or a named requirement is explicitly moved to a
  follow-up ticket because repository evidence proves its durable source does
  not exist.
- The tab is part of the real Watch video page and is absent for every
  unauthorized state.
- All displayed values are real stored observations or visibly typed as
  unavailable/partial/unknown; no prototype data ships.
- Apply/Decline hand off to canonical Admin-hosted, version/digest-bound,
  single-use decisions and never publish or deploy.
- Focused and package-level checks pass, generated contracts are synchronized,
  browser and load evidence are recorded, and cross-provider review is clear.
- `feat-712` is marked complete and durable learnings are captured under
  `docs/solutions/`.

## Sources and Research

- User-approved prototype and feedback in this thread: integrate into the real
  Watch page; add watch depth; make CTA outcomes informative; repair opportunity
  blocks; include social/chat previews, rankings, referrals, content/crawler
  views, alerts, and Apply/Decline.
- Repository research of Watch route composition, static caching, auth session,
  SEO ledger/run audit, proposal decisions, metadata/structured data, analytics
  policy, and frontend performance convention on 2026-10-16.
- Independent T3 subagent passes using OpenAI Sol 6.1 High and Claude Sonnet 5.5
  High across US/NZ Team-seat profiles; no metered API billing.
