---
title: "Fix Watch public share origin"
type: "fix"
status: "completed"
date: "2026-07-23"
---

# Fix Watch public share origin

## Summary

Resolve Watch share links through one client-safe helper so local and private app origins produce a public standalone Watch URL, while public deployment origins remain intact.

## Problem Frame

`ShareModal` currently displays and copies `http://localhost:3000/...` when `NEXT_PUBLIC_CANONICAL_ORIGIN` uses its development default. The modal also disables Facebook and X and tells the user sharing only works after deployment, even though the app already has a public Watch-origin fallback for another Share entry point.

## Requirements

- R1. Copy Link must emit a public absolute Watch URL when the configured origin is localhost, loopback, RFC1918, `.local`, or otherwise rejected by the existing lexical origin policy.
- R2. Facebook and X share intents must remain enabled in local development and target the same resolved URL shown by Copy Link.
- R3. Public preview and production origins must remain unchanged when they are already shareable.
- R4. Every resolved link must use the standalone `/watch/{video}.html/{public-language-slug}.html` identity, including when the page was reached through a contextual collection route.
- R5. Series Share must use its resolved public audio-language slug rather than an internal message-catalog locale.
- R6. The existing lazy modal boundary, embed behavior, modal lifecycle, and contextual navigation URL must remain unchanged.

## Key Technical Decisions

- KTD1. Add the origin resolution and standalone URL composition to `apps/web/src/lib/share.ts`; all Watch Share entry points should consume the same helper instead of maintaining separate fallback logic.
- KTD2. Use `WATCH_PUBLIC_METADATA_ORIGIN` from `apps/web/src/lib/routes.ts` as the fallback host so Share, canonical metadata, structured data, and sitemaps agree on `https://www.jesusfilm.org`.
- KTD3. Normalize valid HTTP(S) configuration through `URL.origin`; preserve non-local hostnames without attempting a client-side DNS or crawler reachability probe, and send literal local or private hosts to the indexed public fallback.
- KTD4. Remove the modal’s disabled social-button state and deployment warning without changing locale catalogs; the existing translated keys may remain unused to avoid an unrelated all-catalog cleanup.

## Assumptions

- A locally authored slug may not exist publicly yet, but Share should still produce the public destination requested by the user rather than a localhost-only link; successful public resolution is content-dependent.
- No API, GraphQL, database, route-shape, or metadata changes are required.

## Implementation Units

### U1. Track the scoped Watch Share fix

- **Goal:** Create the next platform roadmap ticket and mark it in progress before code changes.
- **Files:** `docs/roadmap/platform/feat-301-watch-public-share-origin.md`
- **Patterns:** Follow `docs/roadmap/platform/feat-160-watch-public-metadata-origin.md` and the roadmap frontmatter rules.
- **Test scenarios:** The ticket names the localhost symptom, public standalone URL contract, resolved-language requirement, and unchanged lazy-loading and contextual-route boundaries.
- **Verification:** Confirm the ticket is discoverable by its ID and its status is `in-progress`.

### U2. Centralize public Share URL resolution

- **Goal:** Make Copy Link and every social Share entry point resolve the same usable standalone URL.
- **Files:** `apps/web/src/lib/share.ts`, `apps/web/src/lib/share.test.ts`, `apps/web/src/lib/url.ts`, `apps/web/src/lib/routes.ts`, `apps/web/src/components/watch/ShareModal.tsx`, `apps/web/src/components/watch/WatchPageClient.tsx`, `apps/web/src/components/sections/BibleQuotesCarousel.tsx`
- **Patterns:** Reuse `tryAsContentSlug`, `tryAsLocaleSlug`, `watchVideoPath`, `WATCH_BASE_PATH`, and `WATCH_PUBLIC_METADATA_ORIGIN`; preserve the dynamic ShareModal boundary in `WatchPageClient`.
- **Test scenarios:**
  - A localhost, loopback, RFC1918, or `.local` configured origin resolves to `https://www.jesusfilm.org/watch/{video}.html/{language}.html`.
  - A public configured HTTP(S) URL is normalized to its origin and remains the URL origin.
  - Invalid video or language slugs return `null` without emitting a bare origin or malformed Watch path.
  - Copy Link, Facebook, X, the non-modal Share fallback, and Bible-quotes Share use the same resolved URL.
  - A contextual collection page still shares the standalone video path.
- **Verification:** Focused helper, modal, page-client navigation, route, and metadata tests pass.

### U3. Preserve public language identity and prove the rendered flow

- **Goal:** Pass the resolved series language slug into Share and verify user-visible local behavior.
- **Files:** `apps/web/src/components/watch/SeriesPageClient.tsx`, `apps/web/src/components/watch/__tests__/ShareModal.test.tsx`, `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`, `apps/web/src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
- **Patterns:** Follow `apps/web/AGENTS.md` public audio-language slug guidance and the existing page-owned Share modal contract.
- **Test scenarios:**
  - A series rendered with internal locale `en` and resolved language `english` shares an `english.html` URL.
  - Under localhost configuration, the modal input and clipboard receive the public URL, Facebook and X render as links, and the deployment warning is absent.
  - Facebook and X keep their accessible names, expected tab order, and keyboard activation without stale unavailable semantics.
  - When the shared resolver returns `null`, the modal preserves Close and a valid Embed action while suppressing the link input, Copy, Facebook, X, and the non-modal fallback href.
  - Existing public-origin behavior, embed tabs, clipboard failure handling, close behavior, and hidden-when-closed behavior remain covered.
- **Verification:** Run focused tests, Web typecheck and lint, then open Share from representative standalone, contextual, and series routes under localhost configuration. Confirm the public standalone URL, enabled and accessible social intents, absent deployment warning, Copy Link result, resolved series language slug, and close behavior without changing the page URL. Require a successful public response only for representative content known to exist on the public host.

## Scope Boundaries

- No change to public Watch route shapes, contextual navigation, canonical metadata ownership, or embed-player URLs.
- No new Share providers, modal redesign, initial-bundle import, API work, or locale-catalog additions.
- No removal of now-unused translated warning keys in this fix.

## Sources and Research

- `apps/web/AGENTS.md` defines public audio-language slug requirements for user-visible Watch links.
- `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md` defines the standalone public route contract.
- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` requires seam-level verification for Share URL changes.
- `docs/solutions/ui-bugs/watch-video-hero-share-action-placement.md` keeps Share identity and modal lifecycle in `WatchPageClient`.
- `docs/solutions/performance-issues/watch-staged-client-loading-20260611.md` preserves ShareModal as a user-intent chunk.
