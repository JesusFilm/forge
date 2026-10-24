---
title: "fix: Manager coverage region images"
type: fix
status: completed
date: 2026-06-05
branch: fix/manager-coverage-region-images
roadmap:
  - docs/roadmap/platform/feat-166-manager-coverage-region-image-assets.md
related_docs:
  - docs/roadmap/platform/feat-114-manager-tailwind-design-system-migration.md
---

# fix: Manager coverage region images

## Problem

Production Manager coverage language picker cards render broken image icons for
region tiles. Live verification on 2026-06-05 shows
`https://manager.jesusfilm.org/region-africa.png` returns 404, while
route-backed shell assets such as `/jesusfilm-sign.svg` return 200. The region
cards currently feed `next/image` root public paths like `/region-africa.png`.

## Scope

In scope:

- `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`
- Region artwork under `apps/manager/public/region-*.png`
- Focused Manager typecheck, lint, build, and browser smoke.

Out of scope:

- Language picker redesign.
- Coverage data/API behavior.
- Public asset deployment changes outside Manager.
- New artwork or color token changes.

## Approach

Use Next static image imports for the six region PNGs and store those imported
asset objects in the existing `REGION_THEMES` map. This makes `next/image`
resolve the cards through build-traced `/_next/static/media/...` assets instead
of runtime root public URLs that currently 404 in production.

This follows the existing app's bias toward production-safe Manager assets while
keeping the user-facing picker behavior unchanged.

## Implementation Unit

### U1: Bind region cards to traced image assets

Files:

- Modify `apps/manager/src/features/coverage/LanguageGeoSelector.tsx`

Test scenarios:

- The TypeScript type for `REGION_THEMES.image` accepts the imported static
  assets and rejects accidental plain root public strings.
- A production build emits card image references under `/_next/static/media`
  rather than `/region-africa.png`.
- The coverage page still renders and the language picker region cards show
  artwork locally.

Verification:

- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager build`
- Local browser smoke for `/dashboard/coverage?languageId=cmokkxw5v03uyqsccis58pea6`
