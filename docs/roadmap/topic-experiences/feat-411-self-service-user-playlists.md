---
id: "feat-411"
title: "Self-service user playlists"
owner: "unassigned"
priority: "P1"
status: "in-progress"
start_date: "2026-08-21"
duration: 10
depends_on: []
blocks:
  - "feat-412"
  - "feat-413"
  - "feat-414"
  - "feat-415"
tags:
  - "auth"
  - "admin"
  - "web"
  - "graphql"
  - "experiences"
  - "security"
  - "ugc"
---

## Problem

Watch visitors cannot yet turn a regular self-service account into a personal
Experience assembled from existing Jesus Film media. Reusing the editorial
`Experience` lifecycle would let user-authored presentation data leak into
portfolio organization, search, embeddings, manifests, and canonical public
routes. Anonymous link sharing also creates capability-link, abuse, moderation,
and crawler-indexing risks that must be addressed before launch.

## Entry Points — Read These First

1. `docs/plans/2026-08-21-1213-feat-self-service-user-playlists-plan.md` — product, security, implementation, and verification contracts.
2. `apps/auth/src/app/api/auth/[...all]/route.ts` and `apps/auth/src/services/oauth-policy.service.ts` — self-signup activation and user-delegated OAuth policy.
3. `apps/auth/src/domain/scopes.ts`, `apps/auth/src/domain/apps.ts`, and `apps/web/src/auth/oauth-client.ts` — first-party Web scope declarations.
4. `apps/admin/src/auth/web-user-token.ts`, `apps/admin/src/auth/principal.ts`, and `apps/admin/src/auth/permissions.ts` — scoped consumer principal and coarse authorization.
5. `apps/admin/prisma/schema.prisma` — separate user-owned playlist, report, and moderation persistence.
6. `apps/admin/src/services/watch-progress.service.ts` — subject-derived own-data service precedent.
7. `apps/admin/src/services/experience-preview.service.ts` and `apps/web/src/app/(preview)/preview/experience/[token]/page.tsx` — capability read, public DTO, no-store, and noindex precedent.
8. `apps/web/src/lib/search-actions.ts`, `apps/web/src/components/sections/index.tsx`, and `apps/web/src/components/watch/AccountControl.tsx` — media picker, renderer, and signed-in entry point.
9. `apps/auth/src/services/account-deletion.service.ts` and `apps/admin/src/app/api/internal/watch-progress/route.ts` — strict cross-service account erasure.

## Grep These

- `membershipStatus`
- `WEB_DEFAULT_SCOPES`
- `usableWebUserSubject`
- `WEB_USER_PERMISSIONS`
- `createUserAdminClient`
- `ExperiencePreviewService`
- `ExperienceSectionRenderer`
- `watchSearch`
- `account_deletion_admin_erasure`

## What To Build

1. Upgrade the deployed Next.js apps and Better Auth to patched compatible versions before exposing the new public/authenticated surface.
2. Make self-service signups eligible as regular consumer accounts without creating Admin users or granting editorial scopes; require a verified identity for playlist writes.
3. Add exact Web-only playlist OAuth scopes and retain verified scopes on the Admin consumer principal so TV/watch-event tokens cannot inherit playlist writes.
4. Add a separate `UserPlaylist` aggregate whose owner comes only from the token subject and whose bounded blocks reference eligible existing media IDs without mutating portfolio entities.
5. Add owner-only GraphQL create/list/read/update/delete/share/unshare/rotate operations with SQL-level ownership predicates, quotas, optimistic concurrency, and generated typed-client updates.
6. Add a focused Web playlist library and composer for bounded plain text, media collections, and video carousels using existing Watch search and section renderers.
7. Add durable, high-entropy unlisted share links with purpose-built public DTOs, `no-store`, `noindex`, `X-Robots-Tag`, no-referrer, sitemap/search exclusion, revocation, and indistinguishable 404s.
8. Add anonymous reporting, Admin takedown/audit controls, a community-content label, a public-read kill switch, suspension enforcement, and strict account-erasure integration.
9. Gate each external country/locale cohort on verified-provider access, eligible-catalog/task readiness, and a privacy-minimized pilot with predeclared continuation criteria.

## Constraints

- Never create an Admin `User` row or grant `experience:*`, media-write, publish, or portfolio permissions to a regular account.
- Never reuse editorial `Experience`, `ExperienceLocale`, `Collection`, or Carousel persistence for user playlists.
- Do not accept owner, role, moderation, visibility, or share-token fields from user mutation input.
- V1 excludes uploads, arbitrary image/media/stream URLs, external links, raw HTML/Markdown, iframe/embed/quiz blocks, custom CSS/JavaScript, Watch-home-only blocks, collaboration, public discovery, and geofencing.
- Possession of a share link grants read access only. It never grants mutation rights and is not represented as privacy.
- Crawlers must be allowed to fetch share pages so `noindex` can be observed; do not add a `robots.txt` disallow.
- If the Admin Pothos schema changes, regenerate `apps/admin/schema.graphql` and `packages/admin-graphql` outputs in the same PR; never hand-edit generated env declarations.
- Production deployment remains on the normal PR-to-main path.

## Verification

- Cross-principal tests cover anonymous, owner, another Web user, TV/watch-only token, suspended user, editor, and admin behavior for every owner/public operation.
- Boundary tests prove playlist mutations leave editorial Experience, Collection, Carousel, Video, Media, search, embeddings, and route-manifest organization unchanged.
- Auth tests prove role injection is rejected, unverified identities cannot write, consumer signup cannot enter Admin, and exact OAuth client/audience/scope/status checks hold.
- Service tests cover quotas, limit-plus-one rejection, stale versions, media eligibility, share rotation/revocation, reports, takedown, suspension, and transactional account erasure.
- Web tests cover signed-out redirects, media selection, block ordering, save conflicts, community attribution, 404 behavior, crawler headers/metadata, sitemap absence, and robots crawlability.
- Package-scoped format, lint, typecheck, and tests pass for Auth, Admin, Admin GraphQL, and Web; frontend performance checks show no request-time regression on ordinary Watch routes.
- Browser smoke covers desktop and phone signup/sign-in, create/edit/share/view/report/unshare/rotate/delete, cross-user denial, and Admin takedown.
- External rollout stays disabled until a named country/locale passes provider-access, eligible-catalog, representative-task, aggregate-use, and structured creator-interview thresholds.
