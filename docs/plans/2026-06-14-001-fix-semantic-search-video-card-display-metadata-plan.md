---
title: Semantic Search Video Card Display Metadata Fix Plan
type: fix
date: 2026-06-14
---

# Semantic Search Video Card Display Metadata Fix Plan

## Summary

Fix semantic-search video cards so the public card surface uses video-level display metadata instead of raw semantic evidence. The implementation should hydrate missing thumbnails and playback ids for the final result page while preserving semantic ranking, match timecodes, and existing experience-result behavior.

---

## Problem Frame

The web Semantic Search surface shows some video tiles without cover images and renders transcript-like text with literal markup under the title. The web `VideoCard` component is mostly a presenter: it renders `imageUrl`, `playbackId`, and `snippet` from the search-result contract. The likely fix belongs at the admin hybrid-search result boundary, where fused semantic evidence is currently exposed as card display text and sparse retriever projections are not hydrated into final card fields.

---

## Requirements

- R1. Video search cards must prefer localized video description metadata for `snippet` when a published locale row exists.
- R2. Semantic evidence such as scene descriptions or transcript chunks may remain available as fallback text, but it must not override video-level display metadata.
- R3. Video search cards must receive a cover image when one exists on the video image records, even when the semantic retriever row did not project an image.
- R4. Video search cards must receive a playable Mux `playbackId` when one exists on a published playable dub, even when the semantic retriever row did not project it.
- R5. Existing card pill fields, including label, duration, and child count, must keep their current behavior.
- R6. Experience search results must continue to use experience-level metadata and must not be affected by video hydration.
- R7. The fix must be covered by a focused regression test that reproduces transcript-like evidence text, missing image data, and missing playback data.

---

## Key Technical Decisions

- KTD1. Hydrate display fields after fusion and pagination: the final page is already batched for video card pill data, so extending that pass avoids duplicating lateral joins across semantic and keyword retrievers.
- KTD2. Treat semantic text as match evidence, not primary card copy: retrievers can continue using transcript or scene evidence for ranking and `startSeconds`, while the public `snippet` contract prefers video locale metadata.
- KTD3. Preserve sparse-result resilience: hydration is display-only, so failures should keep returning search results with sparse fields rather than failing the full search endpoint.
- KTD4. Keep the web card component contract stable: the web app should not need to infer whether a snippet is display metadata or evidence text.

---

## Implementation Units

### U1. Admin Hybrid-Search Display Hydration

- **Goal:** Extend the existing post-fusion video hydration pass to fill video-level `snippet`, `imageUrl`, and `playbackId` along with existing pill fields.
- **Files:** `apps/admin/src/services/hybrid-search.service.ts`.
- **Patterns:** Follow the current batched `prisma.video.findMany` hydration used for label, duration, and child count.
- **Test scenarios:** A semantic video row with transcript-like evidence and null media fields is returned with localized description, image URL, Mux playback id, label, duration, and child count after hydration. A row without locale/image/playback metadata keeps the retriever fallback fields.
- **Verification:** Unit tests cover hydrated and fallback paths without requiring a real database.

### U2. Search Contract and Documentation

- **Goal:** Align the public search-result contract wording with the display metadata behavior.
- **Files:** `apps/admin/src/graphql/queries/hybrid-search.ts`, `apps/admin/schema.graphql`, `docs/search-api-guide.md`.
- **Patterns:** Keep generated schema output in sync with Pothos field descriptions and keep docs focused on consumer-visible behavior.
- **Test scenarios:** Schema tests pass after the description update, and docs describe `snippet` as display metadata with fallback evidence only when video metadata is unavailable.
- **Verification:** GraphQL schema tests and diff review confirm the generated schema matches the source description.

### U3. Web Contract Regression Coverage

- **Goal:** Verify the web search/card layer remains compatible with the improved admin result contract.
- **Files:** `apps/web/src/lib/search-actions.test.ts`, `apps/web/src/components/search/VideoCard.test.tsx`.
- **Patterns:** Reuse existing tests for result mapping and card rendering rather than changing presentation behavior.
- **Test scenarios:** Existing web tests continue to pass with hydrated `snippet`, `imageUrl`, and `playbackId` values, showing no web-side contract break.
- **Verification:** Focused web tests and web typecheck pass.

---

## Acceptance Examples

- AE1. Given a semantic match whose evidence text is a transcript fragment with markup, when the matching video has a published locale description, then the card snippet is the description rather than the transcript fragment.
- AE2. Given a semantic match with no projected image URL, when the video has usable image variants, then the card receives an image URL.
- AE3. Given a semantic match with no projected playback id, when a published playable dub has a Mux playback id, then the card receives the playback id.
- AE4. Given an experience search result, when display hydration runs, then its metadata remains unchanged.

---

## Scope Boundaries

- This plan does not redesign search ranking, fusion, or semantic evidence selection.
- This plan does not change the web card layout or image rendering policy.
- This plan does not add a browser screenshot requirement because the fix is at the admin search-result contract boundary and can be verified with focused contract tests.

---

## Sources and Research

- `apps/web/src/components/search/VideoCard.tsx` renders card display fields from the `SearchResult` contract.
- `apps/admin/src/services/hybrid-search.service.ts` maps fused retriever rows into public search results and performs post-fusion video hydration.
- `docs/roadmap/content-discovery/feat-172-forge-algolia-search-modal.md` identifies the Forge modal as the active web search surface and keeps semantic search as the flag-off path.
