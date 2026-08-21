---
id: "feat-412"
title: "Transactional verified-email playlist authorship"
owner: "unassigned"
priority: "P1"
status: "not-started"
start_date: "2026-08-22"
duration: 5
depends_on:
  - "feat-411"
blocks: []
tags:
  - "auth"
  - "web"
  - "security"
  - "email"
  - "ugc"
---

## Problem

Email/password consumers can sign in, but playlist authoring is limited to
verified Google and Apple identities because Forge has no transactional email
verification channel. Countries that cannot meet the social-provider threshold
therefore cannot enter the playlist-authoring cohort safely.

## Entry Points — Read These First

1. `apps/auth/src/auth/config.ts` — Better Auth email/password configuration.
2. `apps/auth/src/app/api/auth/[...all]/route.ts` — signup, signin, and callback
   request boundaries.
3. `apps/auth/src/services/oauth-policy.service.ts` — server-owned playlist
   scope eligibility.
4. `apps/auth/src/services/consumer-eligibility.service.ts` and
   `consumer-lifecycle-outbox.service.ts` — persisted activation and Admin
   lifecycle delivery.
5. `apps/web/src/app/[locale]/[htmlLang]/playlists/page.tsx` — current
   ineligible-account recovery UI.

## Grep These

- `emailAndPassword|emailVerified` in `apps/auth/src`.
- `playlistAuthorEligible|playlist:write|playlist:share` in `apps/auth/src`.
- `verified-provider|author-eligible` in `apps/web/src`.

## What To Build

1. Configure a production transactional mail provider through validated Auth
   environment variables; fail closed when delivery is unavailable.
2. Issue single-use, expiring verification challenges without storing raw
   tokens, and apply resend/IP/account throttles plus non-enumerating responses.
3. Treat only the persisted server-verified email timestamp as password-account
   author eligibility; never accept verification, role, status, or scope input
   from the browser.
4. On first verification, emit the versioned `ACTIVE` lifecycle transition and
   permit fresh Web grants to mint the exact playlist scopes. Existing grants
   remain unchanged until reauthorization.
5. Replace the social-only eligibility message with verified-email delivery,
   resend, expiry, success, and recovery states while retaining Google/Apple
   linking.

## Constraints

- Do not create an Admin user or grant editorial/Manager permissions.
- Matching an address must not merge provider accounts or prove ownership.
- Never log raw verification tokens, passwords, email bodies, or capability
  links.
- Preserve existing Google/Apple author eligibility and Firebase migration
  behavior.

## Verification

- Run focused Auth signup, verification, eligibility, OAuth-policy, lifecycle,
  enumeration, replay, expiry, and throttle tests.
- Run Web playlist eligibility component and route tests at desktop and phone
  widths.
- Run Auth and Web format, lint, typecheck, and package tests.
- In staging, prove one delivery, one expired/replayed denial, exact playlist
  scopes after reauthorization, and zero Admin access.
