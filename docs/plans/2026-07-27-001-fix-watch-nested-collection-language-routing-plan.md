---
title: Watch Nested Collection Language Routing - Plan
type: fix
date: 2026-07-27
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Nested Collection Language Routing - Plan

## Goal Capsule

Ensure a parent collection renders only nested collection and series cards that are admitted in the active Watch audio language, and make an unavailable top-level series language return 404 instead of silently redirecting to another language.

---

## Product Contract

### Summary

Use the existing Watch route manifest as the authority for nested-container availability, preserving normal episode cards and public Watch URL formats.

### Requirements

- R1. A nested collection or series card is rendered only when its standalone route is admitted for the parent page's selected audio language.
- R2. Normal playable episode cards remain visible and retain contextual routes.
- R3. A requested top-level series language that is absent from its direct-child language inventory returns the Watch 404 surface without redirecting to another language.
- R4. Nested container cards communicate their collection or series role rather than being labeled as episodes.

### Scope Boundaries

- Do not add a child-dub GraphQL fan-out or a new route-admission source.
- Do not substitute a fallback language for an unavailable nested container.
- Do not change contextual episode URL behavior.

---

## Planning Contract

### Key Technical Decisions

- KTD-1. Filter nested container children on the server using the existing exact route-manifest index; this reuses the proxy's admission authority and avoids serializing per-child dub lists. (session-settled: user-directed — chosen over a visible fallback link: unavailable nested collections must be hidden.)
- KTD-2. Treat a requested series language with no exact child-language identity as not found; do not redirect to the first available language. (session-settled: user-directed — chosen over a silent fallback redirect: unavailable English must show 404.)
- KTD-3. Keep a container card's existing standalone route but change its visual role and affordance from episode/playback to collection or series/open.

## Implementation Units

### U1. Enforce exact series language availability and nested container visibility

- **Files:** `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`, `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- **Approach:** Stop passing a fallback identity to server-side series language resolution; call `notFound()` when the requested language is absent. Filter only `collection` and `series` children against the exact standalone route manifest before passing the record to structured data and `SeriesPageClient`.
- **Test scenarios:** unavailable English returns not-found; a nested container missing English is omitted while an admitted nested container and normal episode remain.

### U2. Make nested container cards semantic

- **Files:** `apps/web/src/components/watch/SeriesEpisodeCard.tsx`, `apps/web/src/components/watch/__tests__/SeriesEpisodeCard.test.tsx`
- **Approach:** Preserve standalone container navigation while using collection/series labels and a non-playback affordance; leave episode runtime and play treatment unchanged.
- **Test scenarios:** collection and series cards use their matching labels and no play control; episode cards retain `Episode N` and playback presentation.

### U3. Record delivery state

- **Files:** `docs/roadmap/platform/feat-247-watch-nested-series-language-availability.md`
- **Approach:** Mark the roadmap item complete only after verification succeeds.

## Verification Contract

| Unit  | Commands                                                                                                                                                           | Done signal                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| U1-U2 | `pnpm --filter @forge/web test -- src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx src/components/watch/__tests__/SeriesEpisodeCard.test.tsx` | New routing and card regressions pass. |
| U1-U2 | `pnpm --filter @forge/web typecheck`                                                                                                                               | No type errors.                        |
| U1-U2 | `pnpm --filter @forge/web lint`                                                                                                                                    | No lint errors.                        |

## Definition of Done

- The unavailable English Grow Your Faith route reaches 404 rather than Afrikaans.
- Nested containers unavailable in the active language do not appear in the parent grid.
- Available nested containers remain navigable through standalone Watch URLs with collection or series semantics.
- The targeted tests, typecheck, and lint pass.
