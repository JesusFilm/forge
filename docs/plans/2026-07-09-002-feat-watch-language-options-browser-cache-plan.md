---
title: "feat: Cache Watch language options in browser storage"
type: "feat"
status: "active"
date: "2026-07-09"
---

# feat: Cache Watch language options in browser storage

## Summary

Add a browser-storage-backed cache for Watch language picker options so the modal can render a previously loaded language list immediately when the viewer opens it again for the same video.

## Problem Frame

The Watch page already lazy-loads language picker options when the language modal opens, and `watch-interaction-loader` keeps those options in an in-memory map. That cache disappears across page reloads and new client lifecycles, so returning to the same Watch video still waits for the server action before the modal list can appear.

## Requirements

- R1. Opening the language modal for a video with a stored language-options list should show that list immediately without waiting for the server action.
- R2. A successful language-options load should persist a versioned payload under a per-video browser-storage key.
- R3. Invalid, unavailable, or schema-incompatible storage data should fail closed and fall back to the existing server-action load.
- R4. Existing in-memory request dedupe and per-video cache behavior should remain intact.
- R5. The initial Watch page payload should stay slim; this change must not reintroduce language options into server-rendered page props.
- R6. The platform roadmap should capture the work before code changes begin and finish with a complete status after implementation.

## Key Technical Decisions

- **Use `sessionStorage` for the browser-backed cache:** It keeps the instant reopen behavior within a browser session without creating a long-lived language catalog that can drift after Admin content changes.
- **Keep the cache inside `apps/web/src/lib/watch-interaction-loader.ts`:** `WatchPageClient` already asks this module for cached options before opening the modal, so centralizing storage there preserves the current component boundary.
- **Version the serialized payload:** A small envelope with a version and `variants` array lets future shape changes invalidate old entries without special migration code.
- **Treat storage as provisional:** Parse failures, missing browser APIs, quota errors, or malformed payloads should be ignored. Valid stored options can render immediately, but opening the modal should still start a nonblocking server refresh so the server-action path remains the source of truth.

## Implementation Units

### U1. Preserve Roadmap Traceability

- **Goal:** Add the required platform roadmap ticket before implementation and complete it after validation.
- **Requirements:** R6
- **Dependencies:** None
- **Files:** `docs/roadmap/platform/feat-244-watch-language-options-browser-cache.md`, `docs/roadmap/README.md`
- **Approach:** Create the next platform roadmap ticket with status `in-progress` before code edits, pointing at the loader, Watch page client boundary, and focused tests. Update it to `complete` only after implementation and validation finish.
- **Patterns to follow:** Completed language picker tickets such as `docs/roadmap/platform/feat-169-watch-language-picker-search-ranking.md` and `docs/roadmap/platform/feat-196-watch-mobile-language-modal-layout.md`.
- **Test scenarios:** Test expectation: none -- roadmap traceability is documentation-only, with verification through file review.
- **Verification:** Roadmap entry exists in the platform lane, appears in `docs/roadmap/README.md`, and has the correct status for the current phase.

### U2. Add Browser Storage Cache to the Language Options Loader

- **Goal:** Read and write a versioned per-video language-options cache through `sessionStorage`, while preserving the existing in-memory maps and request dedupe.
- **Requirements:** R1, R2, R3, R4, R5
- **Dependencies:** U1
- **Files:** `apps/web/src/lib/watch-interaction-loader.ts`, `apps/web/src/lib/watch-interaction-loader.test.ts`
- **Approach:** Add a storage key builder scoped to Watch language options and the video slug. `getCachedWatchLanguageOptions` should first return the in-memory result, then hydrate the in-memory map from valid `sessionStorage` data when available. `loadWatchLanguageOptionsForVideo` should continue to dedupe concurrent loads, and after a successful server-action response, store the variants in both memory and `sessionStorage`. When the modal opens with storage-hydrated options, keep those options visible and start a nonblocking refresh that replaces memory and storage on success; if refresh fails, keep the cached options visible and avoid showing a blocking error state.
- **Patterns to follow:** Existing guarded browser API usage in `scheduleWatchInteractionWarmup`; existing malformed-storage tolerance in `apps/web/src/lib/watch-progress-client.ts`.
- **Test scenarios:** A cached storage payload for `jesus` is returned by `getCachedWatchLanguageOptions("jesus")` without invoking the loader. A successful `loadWatchLanguageOptionsForVideo("jesus")` writes a versioned storage payload and remains deduped on the next call. Malformed JSON and wrong-version payloads are ignored and replaced by a successful server-action load. Storage write failures do not reject the language-options load. Test cleanup clears `sessionStorage` or removes the new Watch language-option keys so cases cannot leak storage state.
- **Verification:** Focused Vitest coverage proves storage hydrate, storage write, invalid storage fallback, and existing in-memory dedupe behavior.

### U3. Prove Instant Modal Rendering from Cached Options

- **Goal:** Cover the user-facing modal path so cached options are not only present in the loader but visible immediately when the language modal opens.
- **Requirements:** R1, R3, R5
- **Dependencies:** U2
- **Files:** `apps/web/src/components/watch/WatchPageClient.tsx`, `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- **Approach:** Adjust the Watch page language-options state so storage-hydrated options render as ready while a refresh can run in the background. Add a component-level test around `openLanguage` proving cached options appear immediately rather than a loading-only state, and that a refresh failure keeps the cached list visible.
- **Patterns to follow:** Existing modal callback mocks and lazy loader mocks in `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`.
- **Test scenarios:** With cached language options available, clicking the language modal trigger renders the modal with those options and `languageOptionsLoading` false on the first modal render. If the background refresh rejects after cached options are visible, the modal keeps the cached options and does not switch into the retry-only error state. With no valid cache, the existing loading and retry/error behavior remains unchanged.
- **Verification:** Focused Watch page client test coverage proves the instant cached-list path and the invalid/no-cache fallback path.

## Scope Boundaries

- Keep this change local to the browser-side Watch language-options loading path.
- Do not change language switching, subtitle selection, route generation, Admin GraphQL operations, or generated GraphQL artifacts.
- Do not add durable localStorage persistence or a manual invalidation UI in this slice.

## Risks & Dependencies

- Browser storage can be unavailable or throw in privacy modes; the implementation must catch those paths and fall back to the server action.
- Cached language lists can drift during a session after Admin updates; `sessionStorage` bounds that risk to the current tab/session, and the modal-open background refresh should replace the stored payload when Admin returns a newer list.

## Sources & Research

- `apps/web/src/lib/watch-interaction-loader.ts` already owns lazy modal chunk loading, language-option server action calls, in-memory dedupe, and cached result reads.
- `apps/web/src/components/watch/WatchPageClient.tsx` already checks `getCachedWatchLanguageOptions(videoSlug)` before setting the modal to loading state.
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md` records the language picker UI and verification expectations.
