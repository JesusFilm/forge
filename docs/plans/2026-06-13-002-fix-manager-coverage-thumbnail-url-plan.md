---
title: "Fix Manager coverage thumbnail URLs"
type: fix
status: completed
date: 2026-06-13
origin: docs/roadmap/platform/feat-187-manager-coverage-thumbnail-url-normalization.md
---

# Fix Manager Coverage Thumbnail URLs

## Summary

Restore Manager Coverage hover/detail thumbnails by normalizing Admin-provided
video image URLs before they cross the Manager read-model boundary. The UI
already renders `imageUrl` in the hover panel, selected stack, and flyer
animation; the issue is that some Admin image rows contain bare Cloudflare Image
Delivery URLs without a variant suffix.

## Problem Frame

The visible symptom is a broken image icon and alt text inside the Coverage
hover panel for episode rows. Admin dashboard code already uses
`normalizeVideoThumbnailUrl()` to append `/public` to bare
`imagedelivery.net/<account>/<image-id>` URLs, but
`ManagerReadModelService.getVideoCoverage()` currently returns
`video.images[0]?.url` directly.

## Requirements

- Manager coverage payloads expose browser-loadable thumbnail URLs.
- Bare Cloudflare Image Delivery URLs gain `/public`.
- Already-variant Cloudflare URLs and other absolute URLs stay unchanged.
- Missing or blank image values stay `null`.
- No GraphQL schema, generated type, or Manager UI payload shape changes.

## Scope Boundaries

In scope:

- Admin Manager read-model `imageUrl` behavior.
- Focused Admin service regression coverage.
- Manager Coverage browser smoke when local auth/mock setup allows it.

Out of scope:

- Coverage layout redesign.
- Coverage count aggregation changes.
- Manager-side fallback image generation.
- Core sync image ingestion changes.

## Implementation Units

### 1. Normalize Read-Model Image URLs

Touch:

- `apps/admin/src/services/manager-read-model.service.ts`
- `apps/admin/src/services/manager-read-model.service.test.ts`

Add or reuse a small normalization helper in the Admin service layer that
matches the existing dashboard behavior: trim, return `null` for blanks, append
`/public` only for bare `imagedelivery.net` paths with two path parts, and
leave all other URLs untouched. Apply it when building
`ManagerVideoCoverage.imageUrl`.

Tests:

- A bare Cloudflare URL becomes `.../public`.
- A URL with an existing variant remains unchanged.
- A non-Cloudflare URL remains unchanged.
- A blank image URL becomes `null`.

## Verification Plan

Run:

- `pnpm --filter @forge/admin test -- --run src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin typecheck`

Then run Manager locally and use Helium/browser smoke on
`/dashboard/coverage?languageId=529`: hover an episode tile or row and verify
the preview panel image loads instead of showing broken alt text. If local auth
or mock image hosts block visual proof, record the blocker and rely on the
service regression plus generated payload inspection.

Completed verification:

- `pnpm --filter @forge/admin test -- --run src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin exec eslint src/services/manager-read-model.service.ts src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- Helium/`agent-browser` local smoke loaded Manager Coverage at
  `http://localhost:3002/dashboard/coverage?languageId=529`, hovered an
  episode tile, and confirmed the hover panel renders the API-provided
  thumbnail element. The default mock image host returns a broken demo asset
  (`https://images.jesusfilm.org/mock/episode-1.jpg`), so image loading itself
  is covered by the Admin read-model URL normalization regression.

## Risks And Defaults

- Keep the normalization server-side so all Manager consumers benefit from the
  same fixed read model.
- Avoid importing from `apps/admin/src/app/dashboard/video-library-utils.ts`
  unless it is already an accepted service dependency; a tiny service-local
  helper is safer than coupling a read model to dashboard route utilities.
