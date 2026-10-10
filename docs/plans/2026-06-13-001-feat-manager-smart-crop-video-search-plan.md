---
title: "Manager Smart Crop video title and slug search"
type: "feat"
status: "completed"
date: "2026-06-13"
origin: "docs/roadmap/media-generation/feat-173-smart-crop-video-reframing.md"
---

# Manager Smart Crop video title and slug search

## Summary

Add a searchable source-video picker to the Smart Crop canonical crop plan form
so operators can find a video by title or slug and fill the Mux asset ID without
leaving Manager. Keep manual Mux asset entry as the escape hatch.

## Problem Frame

The Smart Crop canonical form currently requires operators to paste a raw Mux
asset ID. That is correct for the job API but slow at the UI boundary, because
operators usually know a video title or public slug first. Manager already has a
video coverage read model and an admin video dispatch lookup used by Shorts
Studio; Smart Crop should reuse those instead of adding a separate catalogue
contract.

## Requirements

- R1. The canonical Smart Crop form lets an operator search videos by title or
  slug.
- R2. Selecting a search result resolves the admin video to the source Mux asset
  ID and fills the existing `Mux Asset ID` field.
- R3. Manual Mux asset entry continues to work when a video is not in the
  catalogue or the lookup is unavailable.
- R4. Search results expose enough identity to disambiguate similar titles:
  title, slug, label/type, and core ID.
- R5. Videos without an admin-resolved Mux asset surface a modal row-level
  reason and do not fill the canonical form.
- R6. The Smart Crop job creation API contract stays unchanged:
  `/api/smart-crop/jobs` still receives `kind`, `muxAssetId`, optional
  `assetId`, optional `playbackId`, and `cropMode`.
- R7. The implementation remains local to Manager UI/read-model code and does
  not change Admin schema, generated GraphQL outputs, crop-worker, or Mastra.

## Key Technical Decisions

- Reuse `/api/videos` as the picker list source: This endpoint already
  authenticates Manager callers and caches the Manager video coverage read
  model. It needs to include `slug` and `coreId` in each item so clients can
  search by slug and resolve by core ID.
- Add a Smart Crop-specific resolution route: A new
  `GET /api/smart-crop/videos/{coreId}` should call
  `lookupVideosByCoreIdFromAdmin` and return `muxAssetId` eligibility. Reusing
  `/api/shorts/videos/{coreId}` would couple Smart Crop to Shorts' public
  playback restriction and duration logic.
- Keep playback resolution in the existing Smart Crop create route: The
  canonical form only needs to fill `muxAssetId`. The create route already calls
  `getMuxAsset` when `playbackId` is absent, preserving today's validation and
  error behavior.
- Use client-side filtering for the first slice: `/api/videos` is already a
  bounded, cached dashboard list. Client-side title/slug/core-ID filtering
  matches the Shorts picker precedent and avoids a new query shape.
- Keep search in a modal, not the form card: the canonical form should stay
  compact, and the video library needs enough width for thumbnail, title, slug,
  type, and resolution state.

## Implementation Units

### U1. Extend the Manager video list response

- **Goal:** Return stable searchable identity from `/api/videos` without
  breaking existing consumers.
- **Files:** `apps/manager/src/app/api/videos/route.ts`,
  `apps/manager/src/app/api/videos/route.mock.test.ts`,
  `apps/manager/src/features/shorts/shorts-create-screen.tsx`.
- **Patterns:** Follow the current `toVideoItem` mapper in
  `apps/manager/src/app/api/videos/route.ts` and keep extra fields additive.
- **Test Scenarios:** `/api/videos` includes `slug` and `coreId` for collection,
  child, and standalone rows; slug fallback for title still works; Shorts picker
  continues to compile against the additive response.

### U2. Add Smart Crop video resolution API

- **Goal:** Resolve a selected core ID to the source Mux asset ID using the
  existing admin lookup envelope.
- **Files:** `apps/manager/src/app/api/smart-crop/videos/[coreId]/route.ts`,
  `apps/manager/src/app/api/smart-crop/videos/[coreId]/route.test.ts`.
- **Patterns:** Mirror auth, core ID shape validation, admin lookup error
  mapping, and `missing_mux_asset` handling from
  `apps/manager/src/app/api/shorts/videos/[coreId]/route.ts`, but omit Shorts
  duration/public-playback checks.
- **Test Scenarios:** Unauthorized callers are rejected; malformed core IDs are
  rejected before admin lookup; missing videos return `video_not_found`; admin
  config/network failures map to 503/502; videos without Mux assets return an
  ineligible resolution; videos with Mux assets return an eligible resolution.

### U3. Add the canonical-form search picker

- **Goal:** Let operators search and select videos while preserving raw Mux ID
  entry.
- **Files:** `apps/manager/src/features/smart-crop/smart-crop-screen.tsx`,
  `apps/manager/src/app/globals.css`.
- **Patterns:** Reuse the Shorts picker flow in
  `apps/manager/src/features/shorts/shorts-create-screen.tsx`: load
  `/api/videos`, flatten collections plus standalone rows, filter client-side,
  keep per-row resolution issues, and render results in a Studio-style modal
  list rather than an inline table.
- **Test Scenarios:** Clicking the source-video search trigger opens a focused
  modal; search matches by title and slug; selecting an eligible result fills
  `Mux Asset ID`; ineligible or failed rows show a row-level reason; manual Mux
  ID editing remains possible and keeps the submit button behavior tied to the
  field value.

## Acceptance Examples

- AE1. Given the canonical form has loaded the video library, when an operator
  clicks `Search by title or slug` and searches `a-new-beginning`, then the
  standalone video with that slug appears in a modal and can be selected.
- AE2. Given a selected video resolves to `mux-1`, when the operator clicks the
  row, then `Mux Asset ID` becomes `mux-1` and the canonical job button enables.
- AE3. Given admin returns a video with no Mux asset, when the operator selects
  it, then the row shows a missing-Mux reason and the existing Mux field is not
  overwritten.
- AE4. Given the library search fails, when the operator knows the Mux ID, then
  they can still type it directly and start the canonical job.

## Scope Boundaries

- No localized-job picker in this slice. The user pointed at the canonical crop
  plan form, and localized jobs need different identity: localized Mux asset,
  approved canonical asset, and language.
- No Smart Crop job API shape change. This is a UI lookup improvement above the
  existing create route.
- No Admin schema or generated `packages/admin-graphql` changes.
- No server-side search endpoint until the cached coverage payload becomes too
  large for the dashboard.

## Verification

- `pnpm --filter @forge/manager test -- src/app/api/videos/route.mock.test.ts src/app/api/smart-crop/videos/[coreId]/route.test.ts`
- `pnpm --filter @forge/manager test -- src/features/smart-crop/smart-crop-presenter.test.ts`
- `pnpm --filter @forge/manager typecheck`
- Browser smoke with Helium/agent-browser against `/dashboard/smart-crop` in
  mock mode: search a seeded slug, select it, confirm the Mux field fills, and
  confirm manual entry still works.

## Sources

- `docs/roadmap/media-generation/feat-173-smart-crop-video-reframing.md`
- `docs/plans/2026-06-09-002-feat-smart-crop-plan.md`
- `apps/manager/AGENTS.md`
- `apps/manager/CLAUDE.md`
- `apps/manager/src/features/smart-crop/smart-crop-screen.tsx`
- `apps/manager/src/features/shorts/shorts-create-screen.tsx`
- `apps/manager/src/app/api/videos/route.ts`
- `apps/manager/src/app/api/shorts/videos/[coreId]/route.ts`
- `apps/manager/src/lib/admin-video-lookup.ts`
