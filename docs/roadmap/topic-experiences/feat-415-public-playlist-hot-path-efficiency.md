---
id: "feat-415"
title: "Public playlist hot-path efficiency"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: "2026-08-22"
duration: 4
depends_on:
  - "feat-411"
blocks: []
tags:
  - "web"
  - "admin"
  - "graphql"
  - "performance"
  - "ugc"
---

## Problem

The fail-closed unlisted-playlist boundary currently resolves the complete
public playlist once in the Web proxy and again at the React data boundary.
Video hydration then uses a fixed 20-alias GraphQL document per batch, which
can execute up to 500 independent video resolver trees for a maximum-size
playlist. These choices preserve immediate revocation and eligibility checks,
but make the anonymous hot path too expensive to enable at meaningful traffic.

## Entry Points - Read These First

1. `apps/web/src/proxy.ts` and
   `apps/web/src/lib/user-playlist-public-boundary.ts` - anonymous preflight and
   sealed internal rewrite.
2. `apps/web/src/lib/user-playlist.ts` and
   `apps/web/src/lib/user-playlist-public-operations.ts` - authoritative render
   resolve and media hydration.
3. `apps/admin/src/graphql/types/user-playlist.ts` and
   `apps/admin/src/services/user-playlist.service.ts` - capability, lifecycle,
   moderation, media-eligibility, and public DTO predicates.
4. `docs/runbooks/user-playlist-sharing.md` - public-read launch gates and
   privacy-sensitive measurement rules.

## What To Build

1. Add a narrow anonymous availability operation for proxy preflight. It must
   enforce the same capability, lifecycle, moderation, sharing, and rollout
   predicates as the render resolve while returning only a closed decision and
   minting no report intent or public DTO.
2. Keep the second authoritative render-time check so capability rotation,
   unsharing, takedown, and lifecycle suspension remain immediately effective.
3. Replace per-video alias fan-out with one bounded Admin projection accepting
   at most 20 unique IDs and returning each eligible Watch video card once.
   Preserve existing country, visibility, HLS, locale, and privacy rules.
4. Use operation-specific Prisma `select` projections so public reads never
   load capability ciphertext or owner-only policy fields they do not consume.
5. Dynamically load the playlist proxy handler only for `/p/*`, and reuse the
   already-verified owner-page session where possible without weakening host,
   scope, CSRF, rate-limit, or signed-context checks.
6. Add load and query-count budgets for 1-, 20-, 21-, 100-, and 500-item
   playlists, including dependency failures and revoked links.

## Constraints

- Do not cache away the second authoritative access check or broaden the
  capability's read-only authority.
- Do not expose owner identity, capability material, internal media state,
  report intent inputs, or eligibility reasons in the preflight response.
- A partial or malformed hydration response remains a 503-class dependency
  failure, never an empty or partially rendered playlist.
- Keep public reads disabled until this work and every feat-414 production
  control are verified.

## Verification

- A successful proxy preflight performs no block projection, report-intent
  minting, or video hydration query.
- Each hydration batch performs one bounded server operation and returns no
  duplicate cards; a 500-item playlist stays within the recorded query budget.
- Rotation, unshare, moderation block, lifecycle suspension, and media
  ineligibility take effect at the render boundary without a cache delay.
- Ordinary Watch routes do not load playlist crypto/Redis/GraphQL modules.
- Desktop and phone measurements record request count, server duration, and
  response bytes without placing a capability in logs, traces, or artifacts.
