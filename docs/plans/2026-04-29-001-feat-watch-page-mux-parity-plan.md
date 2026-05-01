---
title: "feat: Dedicated Watch Page on Mux Ecosystem with Hybrid Video+Experience Resolver"
type: feat
status: active
date: 2026-04-29
deepened: 2026-04-29
origin: docs/brainstorms/2026-04-29-watch-page-mux-parity-requirements.md
---

# feat: Dedicated Watch Page on Mux Ecosystem with Hybrid Video+Experience Resolver

> **v3 revision (2026-04-29)** addressed P0/P1 from round-2 review:
>
> - **P0:** HeroPlayer wiring contract redesigned — synthetic-only slot, reject Strapi-typed player blocks at merge time with explicit editor error (was structurally inert).
> - **P1:** Split `GetWatchVideo` into two variables (`$i18nLocale: I18NLocaleCode!` + `$languageSlug: String!`); URL `[locale]` is the language slug, `$i18nLocale` is fixed `'en'` for v1.
> - **P1:** Dropped `/watch/` literal from in-app `Link` / `router.push` hrefs (basePath auto-prepends).
> - **P1:** Added `@mux/mux-player-react` + `@mux/mux-video-react` deps to `packages/video-player/package.json` (not just apps/web).
> - **P1:** Committed to boolean env-var flag (`FORGE_WATCH_PLAYER_MIGRATION=true|false`); dropped the 10%/50% percentage-rollout fiction (Railway has no native primitive). Rollout is now dev → staging-flip → prod-flip.
> - **P1:** Added `NEXT_PUBLIC_CANONICAL_ORIGIN` to `apps/web/src/env.ts` schema.
> - **P1:** Scoped middleware matcher to precise paths (`/:slug/:video/:locale` and `/:slug/:video/:locale/embed`), not `/watch/*` catchall — preserves existing `[slug]` Experience routes.
> - **P1:** WatchStudyQuestions chevron removed (was false-affordance signal).
> - **P1:** "Tap to Unmute" pill carries a muted-speaker icon to visually distinguish from "Play with Sound".
> - **P2:** `citation-format.ts` adds branch for `chapterEnd != null && verseEnd === null`.
> - **P2:** `download-allowlist.ts` adds `protocol === 'https:'` check.
> - **P2:** `MUX_API_NOTES.md` inlined as comment in spike test.
> - **P2:** typed-routes `as Route` cast noted in U6/U10.
> - **P2:** `apps/web/src/lib/fragments/index.ts` re-export added to U2.

## Summary

Add a new App Router route at `apps/web/src/app/[slug]/[video]/[locale]/page.tsx` (served at `/watch/[collection]/[video]/[locale]` because `apps/web` has `basePath: '/watch'`) that renders a multi-language video viewing experience mirroring `jesusfilm.org/watch/...`. Powered by `@mux/mux-player-react` for the watch surface and `@mux/mux-video-react` for hero/inline. Migrate `apps/web`'s `VideoHero`/`Video`/`CarouselVideo` from `@forge/video-player`/`video.js` to `@mux/mux-video-react` behind a boolean env-var flag; `apps/manager`'s review player stays on `video.js` for v1.

---

## Problem Frame

`jesusfilm.org/watch` ships a polished, multi-language, study-context-rich video viewing experience built on a fixed-template Pages Router app. Forge `apps/web` has the building blocks (`BibleQuotesCarousel`, `RelatedQuestions`, `VideoHero`, `CarouselVideo`), the `resolveWatchPage()` resolver from feat-047, and the full Strapi `Video` schema (study questions, Bible citations, downloads, parents, variants per language) — but no dedicated watch route or Mux ecosystem player chrome that JFP's reference page delivers. See origin: `docs/brainstorms/2026-04-29-watch-page-mux-parity-requirements.md`.

---

## Requirements

Inherited from origin R1–R24 with R20/R21 reframed and R1/R8/R22 corrected.

- R1. Route at `apps/web/src/app/[slug]/[video]/[locale]/page.tsx` (3-segment dynamic), served at `/watch/[collection]/[video]/[locale]` via `basePath: '/watch'`. The `[slug]` param IS the collection slug; this co-exists with existing `[slug]/page.tsx` (1-segment) and `[slug]/[locale]/page.tsx` (2-segment) without collision.
- R2. Hybrid resolver: Experience override merges per-block-type with auto-template defaults. **Slot type-restriction:** the HeroPlayer slot accepts ONLY synthetic `HeroPlayer` blocks (the watch-page Mux Player). Experience-supplied Strapi-typed player blocks (e.g., `ComponentSectionsVideoHero`) targeting the HeroPlayer slot are rejected at merge time with an explicit editor-facing GraphQL warning. Other slots accept either synthetic types or Strapi-typed blocks.
- R3. Route exports `generateMetadata()` for SEO from `Video.title`, `snippet`, `images[0].url`, `noIndex`.
- R4. Watch page mounts `@mux/mux-player-react` as the single player.
- R5. Player initializes muted/looped/autoplay with chrome hidden via CSS Custom Properties; "Play with Sound" overlay button. Autoplay-blocked fallback: render Mux poster image with the pill still functional.
- R6. On pill click: synchronous unmute + `play()` inside the click handler (no awaited work before `play()`), restart from `currentTime = 0`, reveal full chrome (audio-track, subtitle, playback-rate, AirPlay, PiP, fullscreen, quality where supported); `play()` rejection (NotAllowedError) falls back to "Tap to Unmute" pill (muted-speaker icon, distinct from "Play with Sound" pill) which only sets `player.muted = false`.
- R7. Player consumes `Video.variant.hls` plus in-stream WebVTT subtitle tracks via Mux Player's native captions menu. Mounting with `?t=N` URL param: after `loadedmetadata`, clamp to `Math.min(N, duration - 1)` before seek.
- R8. Language picker modal lists every `Video.variants[].language` (filtered to `published === true && hls != null`); selection navigates to `/[collection]/[video]/[selectedLanguageSlug]?t=<currentTime>` where `selectedLanguageSlug` is `Video.variants[].language.slug` (e.g., `english`, `spanish`). **Note:** `/watch/` prefix is omitted from in-app `router.push` because `basePath: '/watch'` auto-prepends.
- R9. Active locale visually indicated in the picker.
- R10. Two-column body: left = `Video.label` + title + description + Download button (hidden when `variant.downloads[]` is empty); right = Study Questions list (sorted by `studyQuestion.order` ASC) + "Ask Yours" CTA. Mobile DOM order: left column first, right column second.
- R11. Sibling carousel labeled `{ParentCollectionTitle} · Clip {N} of {Total}` from canonical parent's `children[]`; current video highlighted; auto-scrolls active item into viewport on load. Hidden when no parent matches the URL `[collection]` slug or `children.length < 2`. In-app sibling `<Link href>` uses `/${parent.slug}/${child.slug}/${currentLocale}` (no `/watch/` prefix).
- R12. Bible Quotes section renders cards from `Video.bibleCitations[]` (joined with `bibleBook` relation; `name` is plain `String`) plus a "Free Resources / Join Our Bible Study" promo card and a Share button. Hidden when `bibleCitations[]` is empty.
- R13. Download modal: lists `variant.downloads[]` quality options sorted by quality enum priority (see Key Decisions), each with formatted file size; requires Terms-of-Use checkbox AND quality selection before Download enables. Click validates `download.url` against the JFP origin allowlist (https-only) before triggering download.
- R14. Share modal: Copy Link (canonical URL constructed from `${NEXT_PUBLIC_CANONICAL_ORIGIN}/watch/[c]/[v]/[l]`, no query params) + Copy Embed Code (`<iframe>` snippet pointing to embed route, also using `NEXT_PUBLIC_CANONICAL_ORIGIN`).
- R15. Ask-Yours panel: "Chat with a person" → `https://issuesiface.com/talk?utm_source=forge-watch`; "Ask a Bible question" → `https://issuesiface.com/bible-question?utm_source=forge-watch` (placeholder URL — confirm exact path with content team in U10's PR description before merge); both anchors carry `rel="noreferrer"`.
- R16. Embed route at `/watch/[c]/[v]/[l]/embed` (Next.js segment: `apps/web/src/app/[slug]/[video]/[locale]/embed/page.tsx`) renders standalone `@mux/mux-player-react` (no Forge chrome) with brand-neutral "Video unavailable. Visit jesusfilm.org to watch." fallback. CSP set via middleware (see U3).
- R17. `VideoHero`, `CarouselVideo`, inline `Video` migrate from current player implementations to `@mux/mux-video-react`. Each component preserves its existing scroll-pause, custom mute button, autoplay-on-viewport. Migration is gated behind boolean env-var flag `FORGE_WATCH_PLAYER_MIGRATION` for staged rollout (dev → staging → prod, no percentage rollout).
- R18. `@forge/video-player` exports BOTH `useVideoPlayerCore` (continues to wrap `video.js` for `apps/manager`) AND new wrappers `MuxPlayer` and `MuxVideo` (for `apps/web`). The package documents the dual contract in `packages/video-player/CLAUDE.md`. **`packages/video-player/package.json` declares `@mux/mux-player-react` + `@mux/mux-video-react` as dependencies** so the wrappers can resolve their imports under pnpm strict resolution. Sunset criterion: when `apps/manager` migrates off `useVideoPlayerCore`, drop the video.js exports and the dual API collapses.
- R19. `video.js` is removed from `apps/web/package.json` after R17 lands AND `FORGE_WATCH_PLAYER_MIGRATION=true` has run in production for one stable release. `packages/video-player/package.json` retains `video.js` until `apps/manager` migrates separately.
- R20. **No Strapi schema migration required.** `Video.studyQuestions`, `Video.bibleCitations`, `Video.parents`, `VideoVariant.downloads` already exist (apps/cms/schema.graphql:3416–3905). `VideoStudyQuestion` has `value` and `order` only — no `answer` field; the watch page renders questions as a reflection-prompt list, not an accordion (no chevron icon, per design feedback).
- R21. **No Strapi schema migration required.** `Video.parents` (many-to-many) is the canonical-parent source. Resolver picks the parent whose `slug` matches the URL `[collection]` segment; 404 if none.
- R22. `packages/graphql/` extends with `WatchVideoFragment` projecting:
  - `documentId, slug, title, snippet, description, noIndex, label, imageAlt`
  - `images { url }`
  - `primaryLanguage { coreId, bcp47 }`
  - `parents { documentId, slug, title, children(sort: ["order:asc"]) { documentId, slug, title, label, images { url } } }`
  - `variants { documentId, slug, published, hls, language { coreId, bcp47, slug, name }, downloads { documentId, quality, size, url }, muxVideo { playbackId } }`
  - `studyQuestions(sort: ["order:asc"]) { documentId, value, order }`
  - `bibleCitations(sort: ["order:asc"]) { documentId, chapterStart, chapterEnd, verseStart, verseEnd, order, osisId, bibleBook { documentId, name } }`

  New operation **`GetWatchVideo($i18nLocale: I18NLocaleCode!, $collectionSlug: String!, $videoSlug: String!, $languageSlug: String!)`** — split-variable shape:
  - `$i18nLocale` (Strapi i18n locale, fixed `'en'` for v1 since UI copy isn't translated by URL position)
  - `$collectionSlug`, `$videoSlug` (URL params for Video lookup)
  - `$languageSlug` (URL `[locale]` param mapped to `Video.variants[].language.slug` for variant filtering)

  Filter shape: `videos(filters: { slug: { eq: $videoSlug }, parents: { slug: { eq: $collectionSlug } } }, locale: $i18nLocale)`. Variant selection done resolver-side after fetch (see U3) — keeps Strapi query simple. All variables required (avoids `codegen-strips-optional-graphql-variables`). Existing `GetRouteVideo` left in place. New fragment is re-exported via `apps/web/src/lib/fragments/index.ts`.

- R23. Mux Data enabled on the watch-page Mux Player with `metadata.player_name = "forge-web-watch"`, `metadata.video_title` from `Video.title`, `metadata.viewer_user_id` from a localStorage-backed pseudo-session UUID. Hero/inline `@mux/mux-video-react` instances run with `disableTracking={true}` until JFP confirms Mux plan headroom (re-enable trigger documented in Documentation/Operational Notes; gated on `FORGE_WATCH_PLAYER_MIGRATION === true` to avoid skewed metrics during rollout).
- R24. Mux Player runs with `disableCookies={true}`; `viewer_user_id` is a localStorage pseudo-session UUID, not a cookie identifier. GDPR lawful basis: legitimate interest for QoE diagnostics (balancing test documented in cookie-banner follow-up ticket). Flag system MUST NOT pass `viewer_user_id` as the flag-evaluation user-key (use anonymous/sessionId-based keys to avoid extending the GDPR basis to a second processor).

**Origin actors:** A1 (End viewer), A2 (Content editor / CMS), A3 (JFP outreach volunteer / off-Forge), A4 (Embedding partner)
**Origin flows:** F1 (Hero → Watch transition), F2 (Audio language switching), F3 (Download with Terms-of-Use), F4 (Share with embed code), F5 (Ask-Yours outbound)
**Origin acceptance examples:** AE1 (covers R5, R6), AE2 (covers R7), AE3 (covers R8), AE4 (covers R13), AE5 (covers R2, R10, R12), AE6 (covers R15), AE7 (covers R16), AE8 (covers R17)

---

## Scope Boundaries

- Migration of jesusfilm.org/watch to Forge as canonical surface (Forge runs in parallel — origin "Out").
- Video.js v10 adoption (revisit at GA — origin "Out").
- Building chat / Bible-question services in Forge (link to existing JFP infra — origin "Out").
- DASH playback, DRM, LL-HLS (origin "Out").
- React Native player (apps/mobile + apps/tv stay on expo-video — origin "Out").
- Collection landing pages at `/watch/[collection]` (origin "Out"; v1 only renders the leaf video page).

### Deferred to Follow-Up Work

- **`apps/manager` `useVideoPlayerCore` migration** — separate `manager`-scoped ticket. Sunset criterion: when manager's review-player swaps to `@mux/mux-player-react` with chapter/transcript/embedding ports, the dual `@forge/video-player` API collapses.
- **Embed signed-playback URLs / Mux DRM** — separate ticket; v1 embed uses public Mux URLs.
- **Mux Data full instrumentation on hero/inline blocks** — separate ticket gated on (a) `FORGE_WATCH_PLAYER_MIGRATION === true` in prod for one release AND (b) JFP Mux plan headroom confirmation 30 days post-flag-flip.
- **Distribution: routing CMS Experiences and share links to Forge URLs** — separate strategic ticket.
- **Cookie banner UI + GDPR balancing test documentation** — separate ticket.
- **Embed-route hardening** — `Permissions-Policy` and `script-src` CSP additions are separate.
- **Anti-phishing affordance in embed** — small "Watch on JesusFilm →" overlay; defer to v1.1.
- **Per-block override suppression mechanism** — sentinel block-type for editors to fully suppress an auto-template block; defer to v2.
- **Hardcoded promo card → CMS** — `chore:` ticket to move "Free Resources / Join Our Bible Study" to a Strapi singleton; current copy ships hardcoded in v1.
- **Percentage-rollout flag infrastructure** — if JFP later wants per-user-percentage rollout, that's a separate platform ticket (install LaunchDarkly/Unleash, replace boolean env var). v1 ships boolean.
- **download-allowlist redirect-chain validation** — current allowlist validates initial URL hostname only, not redirect chains. Editorial control: VideoVariantDownload URLs must point directly to CDN, not redirect intermediaries. Documented in Risks; harden in follow-up if redirect intermediaries become common.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/next.config.mjs:12` — **`basePath: '/watch'`**. Critical: route folders do NOT carry `/watch/` literal; in-app `Link`/`router.push` hrefs MUST drop `/watch/` (auto-prepended).
- `apps/web/next.config.mjs:13-15` — **`experimental: { typedRoutes: true }`**. Template-literal hrefs need `as Route` cast + `import type { Route } from "next"`.
- `apps/web/src/env.ts` — `@t3-oss/env-nextjs` strict env schema. Undeclared env vars resolve to undefined at runtime.
- `apps/web/src/app/[slug]/page.tsx` and `[slug]/[locale]/page.tsx` — existing 1- and 2-segment routes; Next.js distinguishes from new 3-segment route by segment count.
- `apps/web/src/lib/content.ts:432-436` — `resolveWatchPage(locale, slug)` returns `{ kind: "experience" | "video-template", … }`. Extends here.
- `apps/web/src/lib/content.ts:278-297` — `selectPlayableVariant(video)` filters `published & hls`, prefers primary language. Reuse + extend with language.slug match.
- `apps/web/src/lib/locale.ts:3` — `SUPPORTED_LOCALES = ['en', 'es', 'fr', 'pt', 'de']`. The watch-page URL `[locale]` segment uses `Video.variant.language.slug` (different namespace).
- `apps/web/src/components/sections/index.tsx:43-113` — `ExperienceSectionRenderer` switch on Strapi `__typename`. Watch-page synthetic block types do NOT enter this dispatch.
- `apps/web/src/components/sections/BibleQuotesCarousel.tsx` — existing block. Reuse with inline shape adapter inside `BibleQuotesSection`.
- `apps/web/src/components/sections/RelatedQuestions.tsx` — existing block (CMS Q&A pairs with `question + answer`). NOT reused for watch-page study questions.
- `apps/web/src/components/sections/VideoHero.tsx:33-136` — direct `videojs(videoEl, options)` instantiation. Migration target for U12.
- `apps/web/src/components/sections/Video.tsx`, `apps/web/src/components/sections/CarouselVideo.tsx` — both use `useVideoPlayerCore`. Migration target for U12.
- `apps/web/src/components/ui/dialog.tsx` — `@base-ui/react/dialog` wrapper. Reuse for all watch-page modals.
- `apps/web/src/components/ui/carousel.tsx` — embla wrapper exposing `setApi` callback prop (NOT imperative ref). U6 must thread embla API to a parent state for `scrollTo`.
- `apps/web/src/components/sections/VideoRecommendations.tsx` — example of typed-routes `as Route` cast pattern: `import type { Route } from "next"`; `\`/demo-recommendations/${slug}/${locale}\` as Route`.
- `packages/video-player/src/useVideoPlayerCore.ts` — the hook to wrap-and-keep for `apps/manager`. NOT retired in v1.
- `apps/manager/src/features/jobs/review-player/review-player-card.tsx:5-7` — active consumer of `useVideoPlayerCore`; do not break.
- `apps/cms/schema.graphql:3416-3454` (`Video`), `:3863-3905` (`VideoVariant`, `VideoVariantDownload`), `:3720-3732` (`VideoStudyQuestion`), `:77-92` (`BibleCitation`), `:16` (`BibleBook.name: String`), `:1937` (`scalar I18NLocaleCode`), `:2126` (`Language.slug: String`), `:2540-2554` (`MuxVideo.playbackId`).

### Institutional Learnings

- `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md` — `resolveWatchPage()` extension pattern.
- `docs/solutions/design-patterns/react-strictmode-dom-wrapping-widget-teardown-20260424.md` — video.js StrictMode dance; Mux Player wrapper exempts.
- `docs/solutions/web/nextjs16-cachecomponents-isr.md` — Do NOT use `cacheComponents: true` / `"use cache"`. Keep `revalidate = 60` + webhook.
- `docs/solutions/web/nextjs-headers-defeats-route-cache.md` — `headers()`/`cookies()` opts route out of Full Route Cache.
- `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md` — Keep `graphql()` constants in shared `*.ts` files.
- `docs/solutions/cms/codegen-strips-optional-graphql-variables.md` — Codegen strips DocumentNodes with only optional variables. All `GetWatchVideo` variables required.
- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` — Run codegen against live Strapi before commit.
- `docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md` — Throw `GraphQLError` directly.

### External References

- `@mux/mux-player-react@^3.12`, `@mux/mux-video-react@^0.30`
- Mux Player core functionality: https://www.mux.com/docs/guides/player-core-functionality
- Mux Player API reference (React): https://www.mux.com/docs/guides/player-api-reference/react
- Mux Player CSS Parts: https://github.com/muxinc/elements/blob/main/packages/mux-player/REFERENCE.md

---

## Key Technical Decisions

- **Route shape: 3-segment under existing `[slug]`.** Route file at `apps/web/src/app/[slug]/[video]/[locale]/page.tsx` with `basePath: '/watch'` produces URL `/watch/[collection]/[video]/[locale]`. Coexists with existing 1- and 2-segment routes by segment count.
- **In-app navigation drops `/watch/` literal.** `<Link href>` and `router.push` use `/${parent.slug}/${video.slug}/${locale}` (basePath auto-prepends). `as Route` cast + `import type { Route } from "next"` required because `typedRoutes: true`. Only canonical-URL builds (Share modal, embed snippet) include `/watch/` because they start from `${NEXT_PUBLIC_CANONICAL_ORIGIN}` (bare origin).
- **Modal library: existing `@base-ui/react` Dialog via `apps/web/src/components/ui/dialog.tsx`.** Headless UI is NOT added.
- **Hybrid resolver = per-block-type override merge with slot type-restriction.** When an Experience exists, Experience-supplied blocks fill matching slots; auto-template defaults from Video fields fill the remainder. **The HeroPlayer slot is type-restricted to synthetic `HeroPlayer` blocks only.** Strapi-typed player blocks (e.g., `ComponentSectionsVideoHero`) targeting the HeroPlayer slot are rejected at merge time with an explicit editor error: "HeroPlayer slot accepts only the watch-page Mux Player; use the auto-template HeroPlayer or override a different slot." This eliminates the structurally-inert wiring contract from v2 — the watch-page player is non-overridable to guarantee Mux Data attribution.
- **Synthetic block types stay out of `ExperienceSectionRenderer`.** A new `WatchSectionRenderer` dispatches the 6 synthetic types; for any Strapi-typed (`ComponentSections*`) blocks the Experience supplies (excluding HeroPlayer), it delegates to `ExperienceSectionRenderer`. The shared renderer's switch stays Strapi-typed only.
- **Empty-state default: hide section.** When `Video.studyQuestions`, `Video.bibleCitations`, `variant.downloads`, or canonical parent `children[]` is empty/null, the corresponding section/button is hidden. Two-column body collapses to single-column when right column is empty.
- **iOS user-activation safety: synchronous play() in click handler.** "Play with Sound" `onClick` runs `player.muted = false; player.currentTime = 0; player.play()` **with no awaited work before `play()`**. Promise handlers (`.then`/`.catch`) are async and may run after the click task — the constraint is on the _call_ to `play()`, not on the resolution. If `play()` rejects (NotAllowedError), the player stays muted and the pill swaps to "Tap to Unmute" with a muted-speaker icon.
- **"Tap to Unmute" pill visual differentiation.** Uses a muted-speaker SVG icon (e.g., `IconVolumeMuted`) prefixed before the label, in the same overlay slot as "Play with Sound" (which uses an unmuted-speaker icon). Same background color and border, different icon. This distinguishes the degraded iOS-fallback state from the normal pill.
- **`?t=` clamping.** When the route mounts with `?t=N`, the player listens for `loadedmetadata`, then seeks to `Math.min(N, duration - 1)` to handle audio variants with different durations.
- **Strapi schema is provisioned; planning work is fragment extension only.** `VideoStudyQuestion` has `value` and `order`, no `answer`. `BibleBook.name: String` (plain). `MuxVideo.playbackId` is the Mux Player input.
- **VideoStudyQuestion → reflection-prompt list, no chevron.** Questions render as a static list with bullet markers (no chevron, no expand). Existing `RelatedQuestions` block (CMS Q&A pairs) is NOT reused; a new `WatchStudyQuestions` component handles this surface.
- **GraphQL operation split: `$i18nLocale` + `$languageSlug`.** `GetWatchVideo($i18nLocale: I18NLocaleCode!, $collectionSlug: String!, $videoSlug: String!, $languageSlug: String!)`. URL `[locale]` is the language slug (`english`/`spanish`); `$i18nLocale` is fixed `'en'` for v1. Variant selection by language slug is done resolver-side after the fetch returns Video with all variants.
- **Canonical parent rule: URL slug match.** `Video.parents[].slug === [collection]`; 404 if none. No "primary parent" flag added.
- **`apps/manager` migration deferred from v1.** `@forge/video-player` exports both APIs. **`packages/video-player/package.json` declares `@mux/mux-player-react` + `@mux/mux-video-react` as dependencies** so wrappers resolve under pnpm strict resolution. Documented in `packages/video-player/CLAUDE.md`.
- **Embed v1 uses public Mux URLs, not signed playback.** Signed-playback follow-up ticket.
- **Mux Data: full on watch page, disabled on hero/inline for v1.** Watch page Mux Player gets `envKey` + full metadata. Hero/inline `@mux/mux-video-react` instances pass `disableTracking={true}`. Re-enable trigger: gated on `FORGE_WATCH_PLAYER_MIGRATION === true` in prod for one release + 30-day Mux invoice review.
- **`viewer_user_id` is a first-party localStorage pseudo-session UUID.** Generated via `crypto.randomUUID()` on first visit. Private-browsing fallback: per-page-load in-memory UUID (accept inflated unique-viewer count). GDPR basis: **legitimate interest** for QoE diagnostics; balancing test in cookie-banner follow-up. **MUST NOT be passed as flag-evaluation user-key.**
- **Audio language switch preserves `currentTime` (`?t=`) and caption preference.** Caption preference written to `localStorage["watch.captions.${video.documentId}"]` on every Mux Player caption-change event; read on player mount. **Note:** Mux Player's caption-change event name verified in U1 spike (likely `texttrackchange` on the underlying `<video>` element if no `mux-player`-specific event exists).
- **Modal mutual exclusion.** Single `modalState: "none" | "download" | "language" | "share" | "ask-yours"` enum in `WatchPageClient`.
- **No `"use cache"` / `cacheComponents: true`.** Watch route uses `revalidate = 60` + webhook `revalidatePath()`.
- **No `headers()` or `cookies()` reads in route body.** Mux Player init in `'use client'`; `viewer_user_id` read client-side from localStorage.
- **CSP via `apps/web/middleware.ts` (new) with PRECISE matcher.** Middleware matcher uses path patterns scoped to the new watch routes only:
  - `/:slug/:video/:locale/embed` → `Content-Security-Policy: frame-ancestors *`
  - `/:slug/:video/:locale` (NOT `/:slug/:video/:locale/...`) → `Content-Security-Policy: frame-ancestors 'self'`
  - All other apps/web routes (existing 1- and 2-segment `[slug]` Experience pages, future routes) are NOT touched by this middleware. Single ownership for the new routes only.
- **`rel="noreferrer"` on Ask-Yours anchors** + `Referrer-Policy: strict-origin` set on the new watch routes via the same middleware.
- **Carousel responsive breakpoint.** Sibling carousel: arrow buttons visible at `md:` breakpoint and up; touch-swipe at all widths via embla-native; no arrow buttons on mobile.
- **Mobile DOM order for two-column body: left-then-right.**
- **Download URL origin allowlist.** Before download trigger, validate `new URL(url).protocol === 'https:'` AND `new URL(url).hostname` matches `jesusfilm.org`, `*.jesusfilm.org`, `stream.mux.com`, `*.mux.com`. Reject `http:` (downgrade attack), `javascript:`, `data:`, and non-allowlisted hosts. **Limitation:** validates initial URL only; does NOT follow redirect chains. Editorial control: VideoVariantDownload URLs must point directly to CDN.
- **Download mechanism: `<a download>` with `target="_blank" rel="noopener"`.** Cross-origin downloads may not respect the `download` attribute; new tab preserves the watch page if the file navigates instead of downloading.
- **Embed iframe pinned to `NEXT_PUBLIC_CANONICAL_ORIGIN`.** `NEXT_PUBLIC_CANONICAL_ORIGIN` is added to `apps/web/src/env.ts` schema. Set per environment (production: `https://jesusfilm.org` or canonical Forge prod URL; staging: same production value to keep embed snippets paste-ready). **Trade-off:** embed snippet cannot be tested against PR-preview deploys; manual smoke test against staging required for share/embed UI changes.
- **Quality enum sort order (Download modal):** `["uhd", "qhd", "fhd", "highest", "high", "distroHigh", "sd", "distroSd", "low", "distroLow"]`. Display label map: `{ uhd: "4K", qhd: "2K", fhd: "1080p HD", highest: "Best", high: "720p", distroHigh: "720p (ministry)", sd: "480p", distroSd: "480p (ministry)", low: "240p", distroLow: "240p (ministry)" }`. "Distribution" qualifier replaced with "ministry" — clearer to end users than internal-production jargon.
- **Feature flag = boolean env var `FORGE_WATCH_PLAYER_MIGRATION` (true|false).** Single env var, no percentage rollout (Railway has no native primitive). Rollout playbook: dev (always true) → staging (flip true after smoke test) → prod (flip true via Railway env var update). Rollback: flip false; effective on next request after env propagates. Per-environment value, no per-user targeting → no `viewer_user_id` exposure to a flag service.
  - Read pattern: `process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION === 'true'`. Declared in `apps/web/src/env.ts`.
  - R19 trigger: video.js removed from `apps/web/package.json` after the env var has been `true` in production for one stable release with no rollback.
- **CI guardrail for video.js re-import in apps/web.** ESLint `no-restricted-imports` rule blocks `video.js` and `@videojs/*` patterns within `apps/web/src/**` (test file globs excluded). Plus a CI step running `pnpm --filter web why video.js` after R19 lands. **Caveat:** `pnpm why` may show `video.js` while `packages/video-player` still depends on it (transitive via `@forge/video-player`). The CI step runs only AFTER R19 (i.e., after video.js is gone from apps/web direct deps); transitive presence via `@forge/video-player` is acceptable while the dual API exists.

---

## Open Questions

### Resolved During Planning

- **Route shape vs basePath collision** → 3-segment under `[slug]`; in-app hrefs drop `/watch/` literal.
- **typedRoutes `as Route` cast** → required for template-literal hrefs in U6/U10.
- **Modal library** → `@base-ui/react` Dialog via existing wrapper.
- **Strapi schema additions** → schema is fully provisioned; no migration.
- **Multi-parent canonical resolution** → URL slug match against `Video.parents[].slug`; 404 if no match.
- **`apps/manager` migration scope** → deferred from v1; dual `@forge/video-player` API; sunset criterion named.
- **Hybrid resolver collision** → per-block override merge with HeroPlayer-slot type-restriction (synthetic-only).
- **HeroPlayer wiring contract** → eliminated; HeroPlayer slot rejects Strapi-typed player blocks at merge time.
- **Empty-state behavior** → hide section.
- **iOS user-activation safety** → synchronous `play()` in click handler; "Tap to Unmute" fallback with muted-speaker icon.
- **Embed signed-playback policy** → v1 public; signed in follow-up.
- **Mux Data enablement scope** → watch page only; hero/inline disabled until flag at 100% + 30-day invoice check.
- **`viewer_user_id` source under `disable-cookies`** → localStorage pseudo-session UUID; legitimate-interest GDPR basis; NOT passed to flag service.
- **Audio language switch state preservation** → `?t=` for currentTime (clamped), localStorage for captions, scroll resets.
- **Single-player loop=true → loop=false racy** → U1 verification spike with two-stack fallback documented.
- **`BibleBook.name` projection** → plain `String`; project as `bibleBook { name }`.
- **`VideoStudyQuestion` answer field** → no answer; render as bullet-list reflection prompts (no chevron icon).
- **Locale URL segment format** → `Video.variant.language.slug`; GraphQL operation uses `$languageSlug: String!` (separate from `$i18nLocale: I18NLocaleCode!`).
- **CSP ownership** → middleware at `apps/web/middleware.ts` with PRECISE matcher (does not blanket apply to all `/watch/*`).
- **U13 (viewer-id) merged into U5 + U12.** No separate unit.
- **Bible question CTA URL** → placeholder `https://issuesiface.com/bible-question?utm_source=forge-watch`; confirm in PR.
- **Mobile two-column DOM order** → left then right.
- **Quality sort order** → explicit array; "ministry" qualifier replaces "distribution".
- **Carousel responsive breakpoints** → arrow buttons at md+; touch-swipe always.
- **Cross-chapter Bible citation format** → 4 branches in `citation-format.ts` covering null verseEnd cross-chapter case.
- **Feature flag mechanism** → boolean env var `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`; no percentage rollout; declared in `env.ts`.
- **`packages/video-player` Mux deps** → declared in `packages/video-player/package.json` so wrappers resolve.
- **`NEXT_PUBLIC_CANONICAL_ORIGIN`** → declared in `apps/web/src/env.ts` schema.
- **Download URL protocol check** → require `https:`.

### Deferred to Implementation

- **Mux Player CSS Custom Properties combination for chrome hiding** — empirical verification in U1 spike.
- **`@mux/mux-video-react` ref API exact shape** — verify in U1 spike. Document inline at top of `MuxPlayerSpike.test.tsx` (no separate `MUX_API_NOTES.md` file).
- **`Video.variant.language.slug` actual values in Strapi** — empirical check during U2 codegen run. If `language.slug` is null on existing variants (unlikely given Strapi convention), surface as a U2 blocker — fix data in Strapi or resolver-side fallback to `bcp47`. Plan assumes slug populated.
- **Mux Player caption-change event name** — verify in U1 spike. Likely `texttrackchange` on underlying `<video>` element.
- **Mux Player + `<MuxVideo>` simultaneous custom-element registration** — verify in U1 spike that mounting both elements on the same page (watch route with both watch player and inline player blocks) doesn't trigger registration conflicts.
- **Confirmed JFP origin allowlist** — verify exact set of allowed origins for downloads beyond `*.jesusfilm.org` and `*.mux.com`.
- **Bible Question URL** — confirm exact path with content team in U10 PR description.

---

## Output Structure

```
apps/web/
├── middleware.ts                                 (NEW — U3 — CSP + Referrer-Policy, precise matcher)
└── src/
    ├── env.ts                                    (Modified — U10/U12 — adds NEXT_PUBLIC_CANONICAL_ORIGIN + NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION)
    ├── app/
    │   └── [slug]/
    │       └── [video]/
    │           └── [locale]/
    │               ├── page.tsx                  (U3 — route + metadata)
    │               ├── error.tsx                 (U3 — distinct error states)
    │               ├── loading.tsx               (U3 — skeleton)
    │               └── embed/
    │                   └── page.tsx              (U11 — embed route)
    ├── components/
    │   └── watch/
    │       ├── WatchPageClient.tsx               (U5 — root client wrapper, modalState)
    │       ├── WatchSectionRenderer.tsx          (U4 — synthetic + delegated dispatch)
    │       ├── HeroPlayer.tsx                    (U5 — Mux Player + overlay pill)
    │       ├── SiblingCarousel.tsx               (U6)
    │       ├── WatchBody.tsx                     (U7 — two-column body, inline study-question shaping)
    │       ├── WatchStudyQuestions.tsx           (U7 — bullet-list reflection prompts, no chevron)
    │       ├── DownloadButton.tsx                (U7 — opens U9 modal)
    │       ├── BibleQuotesSection.tsx            (U8 — inline bibleCitations shaping)
    │       ├── ShareButton.tsx                   (U8 — opens U10 share modal)
    │       ├── DownloadModal.tsx                 (U9)
    │       ├── LanguagePickerModal.tsx           (U10)
    │       ├── ShareModal.tsx                    (U10)
    │       ├── AskYoursPanel.tsx                 (U10)
    │       ├── EmbedPlayer.tsx                   (U11)
    │       ├── UnavailableState.tsx              (U11)
    │       └── __tests__/
    │           └── MuxPlayerSpike.test.tsx       (U1 — spike + ref API notes inline as comment block)
    └── lib/
        ├── content.ts                            (U3, U4 — extends resolveWatchPage)
        ├── viewer-id.ts                          (U5 — localStorage UUID helper)
        ├── download-allowlist.ts                 (U9 — origin + protocol validator)
        ├── citation-format.ts                    (U8 — Bible citation formatter, 4 branches)
        └── fragments/
            ├── index.ts                          (Modified — U2 — re-export watchVideoFragment)
            └── watch-video.ts                    (U2 — WatchVideoFragment + GetWatchVideo)

packages/
└── video-player/
    ├── package.json                              (Modified — U12 — adds @mux/mux-player-react + @mux/mux-video-react deps)
    ├── CLAUDE.md                                 (NEW — U12 — dual API documentation)
    └── src/
        ├── index.ts                              (Modified — U12 — adds MuxPlayer + MuxVideo exports)
        ├── MuxPlayer.tsx                         (NEW — U12)
        └── MuxVideo.tsx                          (NEW — U12)
```

---

## Implementation Units

- U1. **Mux ecosystem foundation + verification spike**

**Goal:** Add Mux deps to `apps/web/package.json`, widen vitest config, verify single-player chrome-hide-then-reveal under Next.js 16 + StrictMode + production-app provider stack, document `@mux/mux-video-react` ref API + caption-change event name inline in the spike test for U12 to read.

**Requirements:** R4, R5, R17 (verification of `<mux-video>` ref API)

**Dependencies:** None

**Files:**

- Modify: `apps/web/package.json` (add `@mux/mux-player-react@^3.12`, `@mux/mux-video-react@^0.30`)
- Modify: `apps/web/vitest.config.ts` (widen to `.tsx` + jsdom)
- Create: `apps/web/src/components/watch/__tests__/MuxPlayerSpike.test.tsx` (with leading comment block documenting ref API findings + caption-change event name)

**Approach:**

- Install Mux deps in apps/web. Verify `@base-ui/react@^1.2.0` already present.
- Spike test mounts `@mux/mux-player-react` with `loop autoplay muted` + chrome hidden via CSS Custom Properties. Toggle `loop=false`, set `currentTime=0`, call `play()`, re-show chrome — assert no remount, no chrome flicker.
- Verify `@mux/mux-video-react` ref shape: `.muted`/`.currentTime`/`.paused`/`.play()`/`.pause()`. Document at top of test file as comment block (NOT a separate `.md` file).
- Verify Mux Player's caption-change event name (likely `texttrackchange` on underlying `<video>`).
- Verify simultaneous `<mux-player>` + `<mux-video>` mount on the same page does not trigger custom-element registration conflicts.
- Mount `<StrictMode>` test mirroring the v.js StrictMode test pattern (write from scratch — no fictitious citation).
- **Production-stack smoke** (in addition to vitest): mount the spike component within `apps/web/src/app/layout.tsx` provider tree (manual or Playwright) to confirm chrome-reveal works with apps/web's actual theme/error-boundary/Suspense setup.
- **Fallback impact assessment:** If spike fails, document the cascading effects (U5/U6/Mux Data accounting/bundle size) and revise R5/R6 + affected units BEFORE proceeding to U5.

**Patterns to follow:**

- React docs: `<StrictMode>` mount-unmount semantics
- `apps/web/vitest.config.ts` (widen)

**Test scenarios:**

- _Happy path:_ Mount `@mux/mux-player-react` with `loop autoplay muted` + chrome hidden; assert player element exists with expected CSS state.
- _Edge case:_ Toggle `loop` true → false on the same instance; assert no remount.
- _Integration:_ Click → unmute → currentTime=0 → play() runs synchronously inside one click handler.
- _Edge case:_ `<StrictMode>` mount-unmount-mount cycle works without warnings.
- _Integration:_ `@mux/mux-video-react` ref exposes `.muted`/`.currentTime`/`.paused`/`.play()`/`.pause()` callable from a parent component.
- _Integration:_ Caption-change event fires when a track is selected; document the event name inline.
- _Integration:_ Mounting `<mux-player>` + `<mux-video>` on same page produces no custom-element registration conflicts.

**Verification:**

- Spike passes; both Mux Player and Mux Video render and hydrate under Next.js 16 + StrictMode + production provider stack.
- No remount confirmed; if not, fallback impact assessment committed before next unit.
- Ref API + caption-change event name documented inline at top of spike test for U12 to read.

---

- U2. **GraphQL fragment extension and split-variable `GetWatchVideo` operation**

**Goal:** Add `WatchVideoFragment` projecting all watch-page fields. Add `GetWatchVideo($i18nLocale, $collectionSlug, $videoSlug, $languageSlug)` with split variables. Re-export from `apps/web/src/lib/fragments/index.ts`. Re-run gql.tada codegen.

**Requirements:** R20, R21, R22

**Dependencies:** None (parallel with U1)

**Files:**

- Create: `apps/web/src/lib/fragments/watch-video.ts`
- Modify: `apps/web/src/lib/fragments/index.ts` (add `export { watchVideoFragment } from './watch-video';`)
- Modify: `apps/web/src/lib/content.ts` (import the new fragment + operation)
- Test: `apps/web/src/lib/fragments/__tests__/watch-video.test.ts`

**Approach:**

- Define `WatchVideoFragment` per R22 (`bibleBook { name }` plain String, `parents { children(...) }`, `language { slug }`, `muxVideo { playbackId }`).
- **Operation: `GetWatchVideo($i18nLocale: I18NLocaleCode!, $collectionSlug: String!, $videoSlug: String!, $languageSlug: String!)`.** Filter: `videos(filters: { slug: { eq: $videoSlug }, parents: { slug: { eq: $collectionSlug } } }, locale: $i18nLocale)`. **`$languageSlug` is NOT passed to Strapi** — the resolver uses it client-side after fetch to filter `video.variants[]` by `language.slug === languageSlug && published === true && hls != null`. This keeps the Strapi filter shape simple and avoids deep nested-relation filtering.
- Run `pnpm --filter @forge/graphql generate` against live Strapi; verify codegen produces non-empty types.

**Patterns to follow:**

- `apps/web/src/lib/fragments/watch-experience.ts:20`
- `apps/web/src/lib/content.ts:18-30`

**Test scenarios:**

- _Happy path:_ Serialized query string matches snapshot.
- _Happy path:_ Codegen produces non-empty TypeScript types; query survives codegen.
- _Edge case:_ Test against reference asset returns Video with populated `studyQuestions`, `bibleCitations`, `parents.children`, `variants[].downloads`.
- _Error path:_ Operation with non-matching `$collectionSlug` returns empty `videos`.
- _Edge case:_ Codegen run reveals empirical state of `language.slug` field — assert non-null on at least one variant.
- _Integration:_ `pnpm --filter @forge/graphql generate` succeeds; `pnpm --filter web typecheck` clean; new fragment importable from `@/lib/fragments`.

**Verification:**

- Codegen + typecheck pass; reference asset query returns expected shape.

---

- U3. **Watch route shell + extend `resolveWatchPage` + middleware for CSP**

**Goal:** Add the App Router route at `apps/web/src/app/[slug]/[video]/[locale]/`. Extend `resolveWatchPage()` with `resolveWatchVideo({ collection, video, languageSlug })`. Create `apps/web/middleware.ts` with PRECISE matcher (not catchall).

**Requirements:** R1, R3, R21, R16 (CSP), R24 (Referrer-Policy)

**Dependencies:** U2

**Files:**

- Create: `apps/web/src/app/[slug]/[video]/[locale]/page.tsx`
- Create: `apps/web/src/app/[slug]/[video]/[locale]/error.tsx`
- Create: `apps/web/src/app/[slug]/[video]/[locale]/loading.tsx`
- Create: `apps/web/middleware.ts`
- Modify: `apps/web/src/lib/content.ts` (extend `resolveWatchPage` + add `resolveWatchVideo` helper)

**Approach:**

- Server Component `page.tsx` calls `resolveWatchVideo({ collection, video, languageSlug })`. Receives URL `[locale]` param as `languageSlug`.
- `resolveWatchVideo` issues `GetWatchVideo({ i18nLocale: 'en', collectionSlug, videoSlug, languageSlug })`. Then: (a) filter `video.parents` by `slug === collectionSlug` → 404 (`PARENT_NOT_FOUND`) if no match; (b) filter `video.variants` by `language.slug === languageSlug && published === true && hls != null` → 404 (`LOCALE_NOT_FOUND`) if no match; (c) cache canonical parent + selected variant on the result.
- `generateMetadata({ params })` returns `title` from `Video.title`, `description` from `Video.snippet`, `openGraph.images` from `Video.images[0].url`, `robots: { index: !Video.noIndex }`.
- Page uses `revalidate = 60`. No `headers()`/`cookies()` reads.
- Render passes resolver data to `<WatchPageClient>` (U5) as props.
- **`error.tsx`** maps codes to copy:
  - `PARENT_NOT_FOUND`: "Video not available in this collection." + link to homepage (`/`).
  - `LOCALE_NOT_FOUND`: "Video not available in this language." + link to English variant if it exists (`/${collection}/${video}/english`); else link to homepage.
  - `NO_PLAYABLE_VARIANT`: "Video temporarily unavailable." + retry link.
- **`loading.tsx`** renders 16:9 aspect-ratio placeholder div with subtle pulse + single-line skeleton for title.
- **`middleware.ts`** uses Next.js `config.matcher` with PRECISE patterns:
  ```
  export const config = {
    matcher: [
      '/:slug/:video/:locale',
      '/:slug/:video/:locale/embed',
    ],
  };
  ```
  Inside, the handler distinguishes embed vs non-embed by `pathname.endsWith('/embed')`. Sets `Content-Security-Policy: frame-ancestors *` for embed, `frame-ancestors 'self'` for the watch route. Sets `Referrer-Policy: strict-origin` on both. **Existing 1- and 2-segment `[slug]` routes are NOT matched** by `:slug/:video/:locale` (different segment counts) — they keep their current no-CSP behavior. **Note:** in Next.js middleware, the matcher patterns are evaluated against the URL after basePath is removed; `/:slug/:video/:locale` matches `/watch/foo/bar/baz` (basePath stripped to `/foo/bar/baz`).

**Patterns to follow:**

- `apps/web/src/app/[slug]/page.tsx` (existing route shape)
- `apps/web/src/lib/content.ts:432-436`

**Test scenarios:**

- _Happy path:_ `/watch/christmas/considering-christmas/english` → 200 with OG metadata.
- _Error path:_ `/watch/<unknown>/considering-christmas/english` → 404 with PARENT_NOT_FOUND copy.
- _Error path:_ `/watch/christmas/considering-christmas/<unknown>` → 404 with LOCALE_NOT_FOUND copy + English fallback link.
- _Edge case:_ Video with no parents → 404 PARENT_NOT_FOUND.
- _Edge case:_ Mount with `?t=42.5` → page renders; client receives `?t=42.5`.
- _Integration:_ Middleware sets CSP `frame-ancestors 'self'` on watch route; `frame-ancestors *` on embed route.
- _Integration:_ Existing `/watch/christmas/english` (2-segment) and `/watch/christmas` (1-segment) routes still work, get NO new CSP header (matcher doesn't match).
- _Integration:_ `Referrer-Policy: strict-origin` set on both watch and embed responses.

**Verification:**

- All four route shapes resolve; bad input shows distinct error copy.
- Middleware matcher does NOT touch existing 1- and 2-segment routes.
- CSP differentiated between watch and embed routes.

---

- U4. **Hybrid resolver + `WatchSectionRenderer` + slot-restricted HeroPlayer**

**Goal:** Implement per-block-type override merge with HeroPlayer slot-type-restriction (synthetic-only). Build `WatchSectionRenderer` dispatching synthetic types and delegating Strapi-typed blocks to `ExperienceSectionRenderer`.

**Requirements:** R2

**Dependencies:** U3

**Files:**

- Create: `apps/web/src/components/watch/WatchSectionRenderer.tsx`
- Modify: `apps/web/src/lib/content.ts` (add `mergeWatchExperience` + auto-template builders)
- Test: `apps/web/src/lib/__tests__/content-watch-merge.test.ts`
- Test: `apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx`

**Approach:**

- 6 synthetic block-type slots: `HeroPlayer`, `SiblingCarousel`, `WatchBody`, `StudyQuestions`, `BibleQuotes`, `Share`.
- Auto-template builders: each returns `null` when its source data is empty/null (per empty-state Key Decision).
- `mergeWatchExperience({ video, variant, canonicalParent, experience? })` returns `Array<WatchBlock | StrapiBlock>`.
- **HeroPlayer slot enforcement:** if Experience supplies a block intended for the HeroPlayer slot AND that block's type is anything other than synthetic `HeroPlayer`, throw a `GraphQLError` with code `INVALID_HERO_PLAYER_BLOCK`: "HeroPlayer slot accepts only the watch-page Mux Player; use the auto-template HeroPlayer or override a different slot." This error surfaces at resolver time and is logged for the editor.
- For non-HeroPlayer slots: Experience-supplied blocks (synthetic OR Strapi-typed) replace the auto-template builder's output for that slot.
- `WatchSectionRenderer` switch: synthetic types → render watch-specific component; Strapi types → delegate to `ExperienceSectionRenderer`.

**Patterns to follow:**

- `apps/web/src/components/sections/index.tsx:43-113`
- `apps/web/src/lib/content.ts:299-315`

**Test scenarios:**

- _Covers AE5._ Experience null + Video with populated fields → all 6 auto-template slots present.
- _Covers AE5._ Experience supplies synthetic HeroPlayer → merged array uses Experience HeroPlayer + 5 auto-template slots.
- _Edge case:_ Experience supplies Strapi `ComponentSectionsVideoHero` for HeroPlayer slot → resolver throws `INVALID_HERO_PLAYER_BLOCK`; merge fails loudly; editor sees the error.
- _Edge case:_ Experience supplies Strapi `ComponentSectionsBibleQuotesCarousel` → fills BibleQuotes slot via delegation to `ExperienceSectionRenderer`.
- _Edge case:_ Sparse Experience (only `RelatedQuestions` block) → auto-template fills 5 slots; RelatedQuestions wins StudyQuestions slot.
- _Edge case:_ Video with empty `studyQuestions[]` and no Experience → StudyQuestions block omitted.
- _Integration:_ Merged block array renders through `WatchSectionRenderer`; all blocks visible in DOM.
- _Integration:_ Strapi blocks (e.g., PromoBanner) render via delegation.

**Verification:**

- Slot type-restriction prevents Mux Data attribution loss.
- Sparse Experience produces full merged array.
- Synthetic types do NOT enter `ExperienceSectionRenderer`.

---

- U5. **Hero Mux Player + iOS-safe Play with Sound + viewer-id helper + Mux Data on watch page**

**Goal:** Implement `<WatchPageClient>` (root client wrapper with `modalState` enum), `<HeroPlayer>` (Mux Player with chrome-hide → reveal + iOS-safe unmute + visually-distinct fallback pill), and `viewer-id.ts` helper. Wire Mux Data on the watch-page Mux Player.

**Requirements:** R4, R5, R6, R7, R23, R24

**Dependencies:** U1, U3

**Files:**

- Create: `apps/web/src/components/watch/WatchPageClient.tsx`
- Create: `apps/web/src/components/watch/HeroPlayer.tsx`
- Create: `apps/web/src/lib/viewer-id.ts`
- Test: `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- Test: `apps/web/src/lib/__tests__/viewer-id.test.ts`

**Approach:**

- `WatchPageClient`: `'use client'` root, manages `modalState: "none" | "download" | "language" | "share" | "ask-yours"` enum. Dispatches via `WatchSectionRenderer`.
- `HeroPlayer`: mounts `@mux/mux-player-react` with `playbackId` from `Video.variant.muxVideo.playbackId` (preferred) or `src={variant.hls}` fallback. Chrome hidden via CSS Custom Properties (combination from U1 spike).
- Pill `onClick`:
  ```
  // synchronous in the click task — no awaits before play()
  player.muted = false;
  player.currentTime = 0;
  player.play()
    .then(() => setChromeRevealed(true))
    .catch(() => setFallback('tap-to-unmute'));
  ```
- "Tap to Unmute" pill: same component, different state. Renders muted-speaker icon + "Tap to Unmute" label. On click, only `player.muted = false` (no seek, no play call).
- "Play with Sound" pill: unmuted-speaker icon + "Play with Sound" label.
- After successful unmute+play, set `loop=false` via state, remove chrome-hide via `data-chrome-revealed` attribute.
- **`?t=` clamping:** `useEffect` listening for `loadedmetadata`; reads `?t=` from `useSearchParams`; calls `player.currentTime = Math.min(parsedT, player.duration - 1)`.
- Mux Data: `<MuxPlayer envKey={env.NEXT_PUBLIC_MUX_DATA_ENV_KEY} metadata={{ player_name: 'forge-web-watch', video_title: video.title, viewer_user_id: getViewerId() }} disableCookies={true}>`.
- Autoplay-blocked fallback: `<MuxPlayer onError={(e) => e.detail.code === 'autoplay-blocked' && setAutoplayBlocked(true)}>`. When blocked: render Mux poster with pill still functional.
- `viewer-id.ts`: `getViewerId()` reads `localStorage["forge.viewer_id"]`. If absent: generate `crypto.randomUUID()`, persist, return. Private-browsing fallback: in-memory UUID per page load. Client-only guard.

**Execution note:** Test-first for the iOS click-handler synchronous sequence (R6). Write the failing test asserting `play()` is called inside the same task as the click before implementing.

**Patterns to follow:**

- `apps/web/src/components/sections/VideoHero.tsx:33-136` (existing hero pattern reference)
- Top-of-file comment block in `apps/web/src/components/watch/__tests__/MuxPlayerSpike.test.tsx` (from U1)

**Test scenarios:**

- _Covers AE1._ Page mount: player autoplays muted with chrome hidden; "Play with Sound" pill (unmuted-speaker icon) visible.
- _Covers AE1._ Click pill: player unmutes, currentTime=0, play() called synchronously, chrome revealed.
- _Error path:_ Click pill on iOS-mocked browser where `play()` rejects → "Tap to Unmute" pill (muted-speaker icon, distinct from "Play with Sound") replaces the original.
- _Edge case:_ Autoplay-blocked event → poster renders, pill still active.
- _Edge case:_ Mount with `?t=42.5` and variant duration 30 → after `loadedmetadata`, currentTime set to 29 (clamped).
- _Integration:_ Mux Data beacon fires `view_start` with `player_name === "forge-web-watch"`.
- _Integration:_ `disable-cookies` on the underlying `<mux-player>` element.
- _Happy path:_ `getViewerId()` first call generates UUID; subsequent calls return same.
- _Edge case:_ localStorage unavailable → in-memory UUID returned.

**Verification:**

- Visual smoke: chrome hidden during muted-loop, fully revealed after unmute.
- iOS Safari mocked: NotAllowedError keeps player muted with visually-distinct pill.
- Mux Data event with expected metadata.
- `?t=` clamping for both within-duration and exceeding-duration cases.

---

- U6. **Sibling carousel from canonical parent's `children[]`**

**Goal:** Render the sibling clip carousel using canonical parent's `children[]`. Highlight current video. Auto-scroll active item into viewport on mount via embla `setApi` callback. In-app `<Link>` hrefs use `as Route` cast and drop `/watch/` literal.

**Requirements:** R11

**Dependencies:** U3, U4

**Files:**

- Create: `apps/web/src/components/watch/SiblingCarousel.tsx`
- Test: `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`

**Approach:**

- Receives `canonicalParent: { title, children }`, `currentVideoDocumentId`, `currentLocale` from props.
- `clipIndex = children.findIndex(c => c.documentId === currentVideoDocumentId) + 1`; `clipTotal = children.length`.
- Use `Carousel`/`CarouselContent`/`CarouselItem`/`CarouselPrevious`/`CarouselNext` from `apps/web/src/components/ui/carousel.tsx`. Arrow buttons rendered at `md:` breakpoint+; touch-swipe (embla-native) at all widths.
- Each `CarouselItem`: `<Link href={\`/${parent.slug}/${child.slug}/${currentLocale}\` as Route}>`with image + title + label. Import`import type { Route } from "next"`. **No `/watch/` literal — basePath auto-prepends.\*\*
- Current video card: visible border + "Playing now" label + reduced opacity on others.
- On mount, after embla initializes via `setApi` callback prop: thread the API up to a parent state, then `useEffect(() => api?.scrollTo(activeIndex, true), [api])` to scroll without animation.
- Hidden when `children.length < 2`.

**Patterns to follow:**

- `apps/web/src/components/ui/carousel.tsx` (the embla primitive — note `setApi` callback prop, NOT imperative ref)
- `apps/web/src/components/sections/CarouselVideo.tsx` (composition reference)
- `apps/web/src/components/sections/VideoRecommendations.tsx` (typed-routes `as Route` pattern)

**Test scenarios:**

- _Happy path:_ Canonical parent with 10 children → 10 thumbnails, current highlighted, label "{Title} · Clip 3 of 10".
- _Edge case:_ Canonical parent with 1 child → carousel hidden.
- _Edge case:_ Current video is item 12 of 15 → embla scrolls active to center on mount.
- _Edge case:_ Children with missing thumbnails → render with placeholder.
- _Responsive:_ Arrow buttons NOT rendered <768px; touch-swipe at all widths.
- _Integration:_ Click sibling thumbnail → navigates to `/watch/{parentSlug}/{childSlug}/{currentLocale}` (basePath prepended).
- _Integration:_ `pnpm --filter web typecheck` passes — `as Route` cast present.

**Verification:**

- Carousel visible when ≥2 children.
- Active item centered on mount.
- Sibling click navigates correctly (basePath handled).

---

- U7. **Two-column body + WatchStudyQuestions (no chevron) + Download button**

**Goal:** Render two-column body. Left: label + title + description + Download button (hidden when no downloads). Right: `<WatchStudyQuestions>` (bullet-list reflection prompts, NO chevron icon — chevron implied false interactivity) + "Ask Yours" CTA. Mobile DOM order left-then-right.

**Requirements:** R10, R12 (Download button surface), R20

**Dependencies:** U4

**Files:**

- Create: `apps/web/src/components/watch/WatchBody.tsx`
- Create: `apps/web/src/components/watch/WatchStudyQuestions.tsx`
- Create: `apps/web/src/components/watch/DownloadButton.tsx`
- Test: `apps/web/src/components/watch/__tests__/WatchBody.test.tsx`

**Approach:**

- `WatchBody` receives `video`, `variant`, `studyQuestions` (sorted), `onDownloadClick`, `onAskYoursClick`.
- Left column: `Video.label` (uppercase tag), `Video.title` as `<h1>`, `Video.description` as `<p>`. `<DownloadButton>` rendered only when `variant.downloads.length > 0`.
- Right column: `<WatchStudyQuestions prompts={studyQuestions.map(q => q.value)} onAskYoursClick={onAskYoursClick}>`. Renders prompts as a static bullet list (`<ul>` with subtle bullet markers — NOT chevron icons). Below: "Ask Yours" CTA.
- Tailwind: `grid grid-cols-1 md:grid-cols-2 gap-8`. Right empty → left `md:col-span-2`. Mobile single-column DOM order = left first.

**Patterns to follow:**

- `apps/web/src/components/sections/index.tsx:43-113`
- Existing two-column responsive layouts in `apps/web/src/components/sections/`

**Test scenarios:**

- _Happy path:_ Video with 3 study questions + 5 downloads → two columns; bullet list with 3 items in `order` ASC; Download button visible.
- _Edge case:_ Video with empty `studyQuestions[]` → right column hidden; left spans full width; Download visible.
- _Edge case:_ Video with empty `downloads[]` → Download hidden; two-column preserved.
- _Edge case:_ Video with both empty → only left rendered, no Download.
- _Responsive:_ Mobile <768px → left content stacks above right.
- _Integration:_ Click "Ask Yours" → calls `onAskYoursClick`.
- _UX:_ WatchStudyQuestions has NO chevron icons (regression test — assert no `aria-haspopup` or chevron SVG).

**Verification:**

- Empty-states correctly hide.
- Sort order respected.
- Mobile collapse works.
- WatchStudyQuestions is non-interactive (no false-affordance signal).

---

- U8. **Bible Quotes section + citation-format with 4 branches + Share button**

**Goal:** Render Bible Quotes section using existing `BibleQuotesCarousel`. Inline-shape `bibleCitations`. Format with `citation-format.ts` covering 4 branches including null-verseEnd cross-chapter. Add promo card and Share button.

**Requirements:** R12, R14 (Share button surface)

**Dependencies:** U4

**Files:**

- Create: `apps/web/src/components/watch/BibleQuotesSection.tsx`
- Create: `apps/web/src/components/watch/ShareButton.tsx`
- Create: `apps/web/src/lib/citation-format.ts`
- Test: `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx`
- Test: `apps/web/src/lib/__tests__/citation-format.test.ts`

**Approach:**

- `citation-format.ts` exports `formatCitation(citation): string` with 4 branches:
  1. `chapterEnd === null && verseEnd === null` (or `chapterEnd === chapterStart && verseEnd === null`) → `{book.name} {chapterStart}:{verseStart}` ("Galatians 2:20")
  2. `chapterEnd === null && verseEnd != null` (or `chapterEnd === chapterStart && verseEnd != null`) → `{book.name} {chapterStart}:{verseStart}-{verseEnd}` ("Galatians 2:20-25")
  3. `chapterEnd != null && chapterEnd !== chapterStart && verseEnd != null` → `{book.name} {chapterStart}:{verseStart}–{chapterEnd}:{verseEnd}` ("Galatians 2:20–3:5")
  4. `chapterEnd != null && chapterEnd !== chapterStart && verseEnd === null` → `{book.name} {chapterStart}:{verseStart}–{chapterEnd}` ("Galatians 2:20–3", read as "through end of chapter 3")
     Fallback: `bibleBook.name === null/undefined` → "Unknown Book {chapterStart}:{verseStart}".
- `BibleQuotesSection` receives `bibleCitations`. Inline-maps to `BibleQuotesCarousel`'s expected shape, formatting with `formatCitation`.
- Append "Free Resources / Join Our Bible Study" promo card as the final item (hardcoded copy in v1; follow-up ticket to move to CMS).
- `ShareButton` triggers `modalState="share"`.
- Section hidden when `bibleCitations.length === 0`.

**Patterns to follow:**

- `apps/web/src/components/sections/BibleQuotesCarousel.tsx`

**Test scenarios:**

- _Happy path:_ Single citation (Galatians 2:20) → "Galatians 2:20".
- _Edge case (branch 2):_ `chapterEnd=2 verseEnd=25` → "Galatians 2:20-25".
- _Edge case (branch 3):_ `chapterStart=2 verseStart=20 chapterEnd=3 verseEnd=5` → "Galatians 2:20–3:5".
- _Edge case (branch 4):_ `chapterStart=2 verseStart=20 chapterEnd=3 verseEnd=null` → "Galatians 2:20–3".
- _Edge case:_ `bibleBook.name === null` → "Unknown Book 2:20" (no crash).
- _Edge case:_ Empty `bibleCitations[]` → section hidden.
- _Integration:_ Click Share button → calls `onShareClick`.

**Verification:**

- All 4 branches produce correct strings (no "null"/"undefined" leaking).
- Empty-state hides section.
- Promo card always rendered alongside citations when present.

---

- U9. **Download modal with Terms-of-Use + quality picker + https-only origin allowlist**

**Goal:** Build Download modal using `@base-ui/react` Dialog. Lists `variant.downloads[]` quality options sorted by enum priority with display labels (using "ministry" qualifier, not "distribution"). Validates `download.url` against allowlist (https-only).

**Requirements:** R13

**Dependencies:** U7

**Files:**

- Create: `apps/web/src/components/watch/DownloadModal.tsx`
- Create: `apps/web/src/lib/download-allowlist.ts`
- Test: `apps/web/src/components/watch/__tests__/DownloadModal.test.tsx`
- Test: `apps/web/src/lib/__tests__/download-allowlist.test.ts`

**Approach:**

- `@base-ui/react` Dialog via existing wrapper.
- Sort by enum array: `["uhd", "qhd", "fhd", "highest", "high", "distroHigh", "sd", "distroSd", "low", "distroLow"]`.
- Display label map: `{ uhd: "4K", qhd: "2K", fhd: "1080p HD", highest: "Best", high: "720p", distroHigh: "720p (ministry)", sd: "480p", distroSd: "480p (ministry)", low: "240p", distroLow: "240p (ministry)" }`.
- Format size as MB.
- ToU section: paragraph + checkbox.
- "Download" disabled until `tosAgreed && selectedQualityIndex !== null`.
- On click: `isAllowedDownloadOrigin(url)` → if true, `<a download href={url} target="_blank" rel="noopener">`-trigger; if false, console error + toast "Download unavailable".
- `download-allowlist.ts`:
  ```
  export function isAllowedDownloadOrigin(url: string): boolean {
    try {
      const parsed = new URL(url); // single-arg only — no base
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname;
      return host === 'jesusfilm.org'
        || host.endsWith('.jesusfilm.org')
        || host === 'stream.mux.com'
        || host.endsWith('.mux.com');
    } catch {
      return false;
    }
  }
  ```

**Patterns to follow:**

- `apps/web/src/components/ui/dialog.tsx`

**Test scenarios:**

- _Covers AE4._ Modal open, ToU unchecked, no size → Download disabled.
- _Covers AE4._ Both → enabled; click triggers download.
- _Edge case:_ URL `https://evil.com/bad.mp4` → blocked, toast.
- _Edge case:_ URL `http://jesusfilm.org/file.mp4` (http downgrade) → blocked.
- _Edge case:_ URL `https://stream.mux.com/abc.mp4` → allowed.
- _Edge case:_ URL `javascript:alert(1)` → blocked (parse succeeds but protocol fails).
- _Edge case:_ Protocol-relative `//evil.com/file.mp4` → `new URL()` throws, caught, blocked.
- _Edge case:_ `https://jesusfilm.org.evil.com/x.mp4` → blocked (hostname doesn't end with `.jesusfilm.org` with leading dot).
- _Integration:_ Open modal → focus moves to first interactive element; Escape closes; focus returns.

**Verification:**

- Validation gate works on both conditions.
- Allowlist blocks: non-JFP/non-Mux hosts, http downgrades, javascript: URLs, protocol-relative URLs.
- Focus management complies with WCAG 2.4.3.

---

- U10. **Language picker + Share + Ask-Yours modals + env var declarations**

**Goal:** Build three `@base-ui/react` modals. Language picker uses `router.push` with `as Route` cast and no `/watch/` prefix. Share modal builds canonical URLs from `NEXT_PUBLIC_CANONICAL_ORIGIN` (declared in `env.ts`). Ask-Yours uses `rel="noreferrer"`.

**Requirements:** R8, R9, R14, R15

**Dependencies:** U7, U8

**Files:**

- Create: `apps/web/src/components/watch/LanguagePickerModal.tsx`
- Create: `apps/web/src/components/watch/ShareModal.tsx`
- Create: `apps/web/src/components/watch/AskYoursPanel.tsx`
- Modify: `apps/web/src/env.ts` (add `NEXT_PUBLIC_CANONICAL_ORIGIN: z.url()` to client schema and runtimeEnv)
- Test: `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- Test: `apps/web/src/components/watch/__tests__/ShareModal.test.tsx`
- Test: `apps/web/src/components/watch/__tests__/AskYoursPanel.test.tsx`

**Approach:**

- All three use `@base-ui/react` Dialog via existing wrapper.
- **Language picker:** Lists `Video.variants[]` filtered to `published === true && hls != null`. Active locale shown with checkmark. On select: read `currentTime` from player ref; `router.push(\`/${parent.slug}/${video.slug}/${selectedLanguageSlug}?t=${currentTime}\` as Route)`— **NO`/watch/`prefix** (basePath auto-prepends). Import`Route`type from`next`. Caption preference written/read in U5 lifecycle.
- **Share modal:** Two sections (both visible). Copy Link: `<input readOnly value={canonicalUrl}>` + Copy button. `canonicalUrl = \`${env.NEXT_PUBLIC_CANONICAL_ORIGIN}/watch/${parent.slug}/${video.slug}/${currentLocaleSlug}\``(canonical URL DOES include`/watch/`because it builds from absolute origin, not basePath-handled internal nav). Copy Embed Code:`<textarea readOnly>{\`<iframe src="${env.NEXT_PUBLIC_CANONICAL_ORIGIN}/watch/${parent.slug}/${video.slug}/${currentLocaleSlug}/embed" allow="autoplay; fullscreen; picture-in-picture" frameborder="0" width="640" height="360"></iframe>\`}</textarea>` + Copy button. Clipboard failure: show "Select and copy manually" hint (field is readOnly, selectable).
- **Ask-Yours panel:** Two anchors with `rel="noreferrer" target="_blank"`. Bible-question URL is placeholder; PR description must confirm exact URL with content team before merge.
- **`env.ts` modification:** Add `NEXT_PUBLIC_CANONICAL_ORIGIN: z.url()` to client schema and runtimeEnv mapping. Document in `apps/web/.env.example` and Documentation/Operational Notes.

**Patterns to follow:**

- `apps/web/src/components/ui/dialog.tsx`
- `next/navigation` `useRouter`
- `apps/web/src/components/sections/VideoRecommendations.tsx` (`as Route` pattern)
- Existing `apps/web/src/env.ts` schema additions

**Test scenarios:**

- _Covers AE3._ Language picker: 13 audio variants → select non-active → router pushes `/{parent}/{video}/{newLang}?t=42.5` (basePath handled).
- _Edge case:_ Active row has visible checkmark.
- _Integration:_ After navigation + new page mount, player applies caption preference from localStorage.
- _Happy path:_ Caption preference write fires when user toggles captions (verified in U5).
- _Happy path:_ Share modal Copy Link → clipboard contains canonical URL using `NEXT_PUBLIC_CANONICAL_ORIGIN`.
- _Happy path:_ Share modal Copy Embed Code → clipboard contains iframe snippet with canonical origin.
- _Error path:_ Clipboard API rejects → "Select and copy manually" hint shows.
- _Covers AE6._ Ask-Yours "Chat with a person" → anchor has `rel="noreferrer"` and `target="_blank"`.
- _Integration:_ Modals trap focus; Escape closes.
- _Integration:_ Share modal renders with staging URL → embed snippet uses production canonical origin (env var pinned).
- _Integration:_ `pnpm --filter web typecheck` passes — `as Route` cast on Link/router.push.
- _Integration:_ `env.ts` validates `NEXT_PUBLIC_CANONICAL_ORIGIN` at runtime.

**Verification:**

- Locale navigation preserves currentTime + caption preference; no `/watch/watch/` collision.
- Embed code uses canonical origin regardless of deploy environment.
- Ask-Yours anchors carry `rel="noreferrer"`.
- All three modals trap focus and return on close.
- Env var declared and validated.

---

- U11. **Embed route at `/watch/[c]/[v]/[l]/embed` + UnavailableState**

**Goal:** Add embed route. Standalone Mux Player with no Forge chrome. Brand-neutral fallback. CSP set by U3's middleware (this unit does NOT touch CSP).

**Requirements:** R16

**Dependencies:** U2, U3

**Files:**

- Create: `apps/web/src/app/[slug]/[video]/[locale]/embed/page.tsx`
- Create: `apps/web/src/components/watch/EmbedPlayer.tsx`
- Create: `apps/web/src/components/watch/UnavailableState.tsx`
- Test: `apps/web/src/app/[slug]/[video]/[locale]/embed/__tests__/embed.test.ts`

**Approach:**

- `embed/page.tsx` reuses `resolveWatchVideo` from U3. On error → `<UnavailableState>`. On success → `<EmbedPlayer>`.
- `<EmbedPlayer>`: `@mux/mux-player-react` with standard chrome, `playbackId` from variant. **No Mux Data wiring** (embed sites use their own analytics).
- `<UnavailableState>`: Brand-neutral copy "Video unavailable. Visit jesusfilm.org to watch." Fixed 16:9 aspect-ratio container so partner pages don't jump.
- `generateMetadata` returns `robots: { index: false }` (embed not indexed). Title/description omitted (embeds inside iframes don't benefit from rich metadata; minimizes data leakage).

**Patterns to follow:**

- `apps/web/src/app/[slug]/page.tsx`

**Test scenarios:**

- _Covers AE7._ Iframe embed renders standalone Mux Player; no Forge nav, body, BibleQuotes, AskYours.
- _Error path:_ Embed for unpublished video → `<UnavailableState>` + `noindex`.
- _Error path:_ Embed for unknown locale → `<UnavailableState>`.
- _Integration:_ Response headers from middleware (U3) include `frame-ancestors *` on embed route.
- _Integration:_ Parent watch route includes `frame-ancestors 'self'`.
- _Edge case:_ Embed for Video with `noIndex === true` → still `noindex`.

**Verification:**

- Embed works in third-party iframe (manual smoke).
- Parent watch route refuses external framing.
- Unavailable state has stable dimensions.

---

- U12. **Migrate `apps/web` `VideoHero` / `Video` / `CarouselVideo` to `@mux/mux-video-react` behind boolean env flag + dual `@forge/video-player` API + remove video.js (when flag stable)**

**Goal:** Add `<MuxPlayer>` and `<MuxVideo>` wrappers to `@forge/video-player` (with Mux deps declared in package.json). Migrate the three components behind boolean env-var flag `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION`. Document dual API in `packages/video-player/CLAUDE.md`. Remove `video.js` from `apps/web/package.json` after flag stable in production.

**Requirements:** R17, R18, R19, R23 (disableTracking on hero/inline)

**Dependencies:** U1 (ref API documented in spike test)

**Files:**

- Modify: `packages/video-player/package.json` (**add `@mux/mux-player-react@^3.12` and `@mux/mux-video-react@^0.30` as dependencies** so wrappers resolve under pnpm strict resolution)
- Modify: `packages/video-player/src/index.ts` (add `MuxPlayer`, `MuxVideo` exports; KEEP `useVideoPlayerCore`)
- Create: `packages/video-player/src/MuxPlayer.tsx`
- Create: `packages/video-player/src/MuxVideo.tsx`
- Create: `packages/video-player/CLAUDE.md`
- Modify: `apps/web/src/env.ts` (add `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: z.coerce.boolean().default(false)` to client schema)
- Modify: `apps/web/src/components/sections/VideoHero.tsx` (gate `videojs()` vs `<MuxVideo>` on env flag)
- Modify: `apps/web/src/components/sections/Video.tsx` (gate hook vs `<MuxVideo>` on env flag)
- Modify: `apps/web/src/components/sections/CarouselVideo.tsx` (same)
- Modify: `apps/web/.eslintrc.*` (add `no-restricted-imports` rule for `video.js` + `@videojs/*` in `apps/web/src/**`, excluding test globs)
- Modify: CI config (add post-R19 step: `pnpm --filter web why video.js` should report no direct dep)
- Modify: `apps/web/package.json` (remove `video.js` direct dep — only after R19 trigger met)
- Test: existing `VideoHero`/`Video`/`CarouselVideo` test files updated for both flag branches

**Approach:**

- **`MuxPlayer`/`MuxVideo` wrappers**: Tailwind brand defaults, default props (`disableCookies={true}`).
- **`packages/video-player/CLAUDE.md`**: documents dual API + sunset criterion + the rule "do NOT add a third backend without architecture review."
- **Flag read pattern**: each migrated component branches:
  ```
  if (env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION) { return <MuxBackedComponent ... />; }
  return <VideojsBackedComponent ... />;  // existing implementation
  ```
- **VideoHero migration (direct videojs path)**: extract existing `videojs()` setup into `<VideojsBackedVideoHero>` (kept for flag-off). Build `<MuxBackedVideoHero>` using `<MuxVideo>` ref. Both share the outer `VideoHero` component shell. Mute button on flag-on calls `videoRef.current.muted = !videoRef.current.muted` (per U1 ref API).
- **Video.tsx and CarouselVideo.tsx (hook path)**: replace `useVideoPlayerCore` with direct `<MuxVideo>` ref usage on the flag-on branch. Preserve `autoplayOnViewport` via IntersectionObserver. Same flag split.
- **All flag-on `<MuxVideo>` instances** pass `disableTracking={true}`.
- **Flag-off branch tests**: smoke-only (component mounts without crash, top-level behavior passes). Flag-on tests are full behavioral suite (the path that becomes permanent).
- **Rollout playbook**:
  1. Land U12 with flag default `false` (no behavior change in prod).
  2. Smoke test in dev with `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION=true`.
  3. Set `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION=true` in Railway staging env vars; redeploy; smoke test.
  4. Set `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION=true` in Railway production env vars; redeploy; monitor for one stable release window (e.g., 1 week, no rollback).
  5. **R19 trigger met:** open follow-up commit removing `video.js` from `apps/web/package.json` + flag-off branch + flag env var. CI step `pnpm --filter web why video.js` should report no direct dep (transitive via `@forge/video-player` is acceptable while dual API exists).
- **Rollback**: flip env var to `false` in Railway dashboard → next request reads new env value (Next.js doesn't cache `process.env` reads inside Client Components if read inline).

**Execution note:** Characterization-first for VideoHero — capture existing scroll-pause + mute behavior in a test against the flag-off branch BEFORE adding flag-on branch.

**Patterns to follow:**

- `apps/web/src/components/sections/VideoHero.tsx:33-136` (preserved in flag-off branch)
- Top-of-file comment block in `apps/web/src/components/watch/__tests__/MuxPlayerSpike.test.tsx` (from U1)
- `docs/solutions/design-patterns/react-strictmode-dom-wrapping-widget-teardown-20260424.md` (the dance no longer needed for Mux Video)

**Test scenarios:**

- _Covers AE8._ Flag-on `VideoHero` mounts: video autoplays muted in loop. Network inspection confirms no `video.js` JS bundle is shipped (in flag-on bundle).
- _Edge case:_ Flag-off `VideoHero` continues to work via `videojs()` path (smoke test).
- _Edge case:_ Flag-on, scroll past 100px → `<MuxVideo>` ref's `.pause()` called.
- _Edge case:_ Flag-on, click mute button → ref's `.muted` toggles.
- _Integration:_ `<StrictMode>` mount-unmount-mount of flag-on `VideoHero` does not warn.
- _Integration:_ `pnpm --filter web lint` rejects synthetic `import videojs from "video.js"` in apps/web/src.
- _Integration:_ `pnpm --filter web why video.js` returns no direct dep after R19 (transitive via `@forge/video-player` is OK).
- _Integration:_ `apps/manager` still builds and tests pass.
- _Integration:_ Flag-on hero/inline `<MuxVideo>` does NOT fire Mux Data beacons (Playwright network tap on `*.litix.io` returns zero requests).
- _Integration:_ `packages/video-player` typecheck + tests pass with new Mux deps.

**Verification:**

- Three components migrated; behavior preserved via characterization tests.
- Flag flip works in Railway env vars without redeploy of code (just env update + restart).
- `apps/web/package.json` cleaned only after stable bake.
- `apps/manager` unaffected.

---

## System-Wide Impact

- **Interaction graph:** New `WatchPageClient` + `WatchSectionRenderer` are watch-page-only; do NOT extend `ExperienceSectionRenderer`'s switch. Existing `[slug]/page.tsx` and `[slug]/[locale]/page.tsx` routes are untouched. New 3-segment route coexists by segment count.
- **Middleware impact:** `apps/web/middleware.ts` is new. Matcher is PRECISE — `/:slug/:video/:locale` and `/:slug/:video/:locale/embed` only. Existing 1- and 2-segment routes (`/[slug]`, `/[slug]/[locale]`) are NOT matched and keep their current no-CSP behavior. Future routes get no automatic CSP coverage; if a new route needs CSP, the matcher must be extended explicitly.
- **Error propagation:** Watch route's `error.tsx` distinguishes 3 codes (`PARENT_NOT_FOUND`, `LOCALE_NOT_FOUND`, `NO_PLAYABLE_VARIANT`) with distinct copy. Embed route's `UnavailableState` is brand-neutral.
- **State lifecycle risks:** Audio language switch is full route navigation. `?t=` (clamped), localStorage caption preference, viewer_user_id (persistent across nav) are the persistence mechanisms.
- **API surface parity:** `apps/manager` is intentionally not migrated; `useVideoPlayerCore` and `video.js` remain in `packages/video-player`. The hook's API is unchanged.
- **Feature flag rollout risk:** U12's component swaps are env-var-gated. If `<MuxVideo>` differs from spike findings, rollback is instant via Railway env var flip — no code redeploy. R19 (video.js removal from apps/web) is gated on stable bake.
- **Integration coverage:** Mux Player + Next.js 16 App Router + StrictMode verified in U1. Production-stack smoke test included. Per-block override merge in U4 with HeroPlayer slot type-restriction.
- **Unchanged invariants:** `apps/web/src/app/[slug]/page.tsx` and `[slug]/[locale]/page.tsx` (existing Experience-driven routes) unchanged. `apps/manager`'s review-player unchanged. `packages/graphql` `GetRouteVideo` unchanged. `apps/web/src/components/sections/index.tsx` `ExperienceSectionRenderer` switch unchanged.

---

## Risks & Dependencies

| Risk                                                                                     | Mitigation                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mux Player single-instance chrome-hide-then-reveal proves infeasible                     | U1 spike runs first; full fallback impact assessment committed if spike fails before next unit                                                                                                                     |
| iOS Safari rejects `play()` after async work                                             | R6 + U5 require strictly synchronous unmute+play; "Tap to Unmute" fallback with distinct icon; tested with iOS-mocked browser                                                                                      |
| `@mux/mux-video-react` ref API differs from spike documentation                          | U1 documents inline; U12 adapts; flag-off path preserves video.js fallback                                                                                                                                         |
| Strapi `Video.parents` returns no entry matching URL `[collection]`                      | Resolver returns 404 PARENT_NOT_FOUND; editorial workflow note in Documentation                                                                                                                                    |
| `@base-ui/react` Dialog focus trap conflicts with Mux Player keyboard shortcuts          | U9 test verifies; if conflict, use Dialog `initialFocus`                                                                                                                                                           |
| Flag flip via Railway env var update doesn't propagate                                   | Railway redeploys on env update; verify next request reflects new value during U12 verification                                                                                                                    |
| Bundle size of Mux Player on every watch page navigation                                 | Use `@mux/mux-player-react/lazy` if measured > 100 KB gzipped on first load (follow-up if needed)                                                                                                                  |
| ESLint `no-restricted-imports` blocks legitimate test mocks                              | Test file globs excluded from rule                                                                                                                                                                                 |
| Webhook `revalidatePath()` for new route doesn't fire on Strapi changes                  | Verify Strapi webhook config covers `Video` content type updates                                                                                                                                                   |
| `viewer_user_id` localStorage UUID inflates unique-viewer count when users clear storage | Accepted: pseudo-session, best-effort                                                                                                                                                                              |
| Download URLs from Strapi pointing at non-allowlisted origins                            | `download-allowlist.ts` rejects + toast; CMS editor education                                                                                                                                                      |
| Download URLs going through redirect chains to non-allowlisted origins                   | **Limitation acknowledged**: allowlist validates initial URL only. Editorial control: VideoVariantDownload URLs must point directly to CDN. Harden via server-side proxy if redirect intermediaries become common. |
| Embed iframe used in phishing context                                                    | `frame-ancestors *` is by design; "Watch on JesusFilm" overlay deferred to v1.1                                                                                                                                    |
| Cross-origin download navigates instead of downloading                                   | `<a download target="_blank" rel="noopener">` opens new tab; watch page preserved                                                                                                                                  |
| GDPR challenge to viewer_user_id legitimate-interest basis                               | Cookie-banner follow-up documents balancing test                                                                                                                                                                   |
| feat-047's `resolveWatchPage` signature change breaks existing `[slug]` routes           | U3 tests confirm existing routes still resolve; new params are additive                                                                                                                                            |
| Locale URL segment `english` collides with locale code `en`                              | Resolver explicitly filters on `language.slug` (separate namespace from `I18NLocaleCode`)                                                                                                                          |
| Mux Player caption-change event name unverified                                          | U1 spike verifies; if Mux-specific event doesn't exist, listen on underlying `<video>` `texttrackchange`                                                                                                           |
| Mux Player + `<MuxVideo>` simultaneous mount registration conflict                       | U1 spike verifies dual-element mount on same page                                                                                                                                                                  |
| Mux Data attribution skewed during flag rollout window                                   | Re-enable trigger for hero/inline tracking gated on flag at `true` in prod for one stable release; documented in Operational Notes                                                                                 |
| Hardcoded "Free Resources" promo card requires engineering deploy for copy edits         | Accepted v1 trade-off; follow-up ticket to move to CMS named in Documentation                                                                                                                                      |
| `NEXT_PUBLIC_CANONICAL_ORIGIN` blocks embed snippet testing in PR-preview deploys        | Accepted trade-off; manual smoke against staging required for share/embed UI changes                                                                                                                               |

---

## Documentation / Operational Notes

- **`packages/video-player/CLAUDE.md` creation (in U12):** Documents dual API, sunset criterion, and "no third backend without architecture review" rule. Future contributors must read before modifying.
- **`apps/web/CLAUDE.md` update:** After landing, add "Watch page conventions" section: hybrid resolver semantics + slot type-restrictions, `WatchSectionRenderer` vs `ExperienceSectionRenderer` split, canonical-parent rule, modal library (`@base-ui/react`), in-app navigation drops `/watch/` literal (basePath), Mux Player vs Mux Video usage, viewer_user_id pattern, embed CSP, feature flag rollout playbook.
- **Roadmap update:** Mark `feat-054` (video pages 2.0) `status: complete` after ship. Review `feat-035` (subtitle UX) for partial supersession.
- **Strapi webhook verification:** Confirm `revalidatePath` webhook covers the new route segment. Add target if missing.
- **Mux Data dashboard setup:** After R23 lands, set up dashboard view filtered by `metadata.player_name === "forge-web-watch"`. Document `NEXT_PUBLIC_MUX_DATA_ENV_KEY` as the JFP-environment-public Mux Data identifier (NOT the API secret key).
- **`NEXT_PUBLIC_CANONICAL_ORIGIN` env var setup:** Set in Railway service vars per environment:
  - Production: `https://jesusfilm.org` (or canonical Forge prod URL)
  - Staging: same as production (so embed snippets are paste-ready)
  - Local dev: `http://localhost:3000` (or developer's chosen value)
    Add to `apps/web/.env.example`.
- **`NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` env var setup:** Set in Railway per environment:
  - Production: `false` (default; flip to `true` after staging bake)
  - Staging: `true` (after smoke test)
  - Local dev: `true` (always on for development)
    Add to `apps/web/.env.example`.
- **Editorial workflow note:** Adding a video to a new collection requires both the new collection to be published AND the video's `parents` relation to include the new collection BEFORE sharing `/watch/[newCollection]/[video]/[locale]` URLs publicly.
- **VideoVariantDownload URL editorial constraint:** Download URLs in Strapi must point directly to the CDN asset (jesusfilm.org or stream.mux.com). Do NOT use redirect intermediaries — `download-allowlist.ts` validates initial URL only.
- **HeroPlayer slot constraint:** Editors cannot override the HeroPlayer slot with a Strapi-typed video block. The watch-page Mux Player is non-overridable to guarantee Mux Data attribution. To customize hero behavior, contact engineering for a synthetic HeroPlayer extension.
- **Re-enable Mux Data on hero/inline (post-launch):** After `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION=true` in production for one stable release, owner reviews Mux invoice delta over 30 days; if acceptable, file follow-up ticket to flip `disableTracking` from `true` to `false` on hero/inline.
- **Feature flag rollout playbook:** dev (always true) → staging (flip true after smoke) → prod (flip true via Railway env). Rollback: flip false in Railway dashboard. R19 trigger: flag at `true` in prod for one stable release with no rollback.
- **Follow-up tickets to file:**
  - `manager:` migrate `apps/manager` review-player off `useVideoPlayerCore`.
  - `web:` enable Mux Data full instrumentation on hero/inline (cost gate).
  - `web:` signed-playback URLs for embed (Mux DRM follow-up).
  - `web:` embed-route hardening — `Permissions-Policy` and `script-src` CSP.
  - `web:` "Watch on JesusFilm" overlay anti-phishing affordance.
  - `web:` distribution strategy — route CMS Experiences and share links to Forge URLs.
  - `web:` per-block override suppression mechanism (sentinel block-type for editor-driven hide).
  - `chore:` cookie banner integration with Mux Player `disableCookies` toggle + GDPR balancing test.
  - `chore:` move "Free Resources / Join Our Bible Study" promo card to CMS-driven config.
  - `chore:` percentage-rollout flag infrastructure (if JFP wants per-user-percentage rollout in the future).
  - `chore:` server-side download-URL redirect-chain validation (if redirect intermediaries become common).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-29-watch-page-mux-parity-requirements.md](docs/brainstorms/2026-04-29-watch-page-mux-parity-requirements.md)
- Related code: `apps/web/src/lib/content.ts`, `apps/web/src/components/sections/`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/carousel.tsx`, `apps/web/next.config.mjs`, `apps/web/src/env.ts`, `packages/video-player/src/useVideoPlayerCore.ts`, `apps/cms/schema.graphql`
- Related learnings: `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md`, `docs/solutions/design-patterns/react-strictmode-dom-wrapping-widget-teardown-20260424.md`, `docs/solutions/web/nextjs16-cachecomponents-isr.md`, `docs/solutions/web/nextjs-headers-defeats-route-cache.md`, `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md`, `docs/solutions/cms/codegen-strips-optional-graphql-variables.md`
- Related roadmap: `docs/roadmap/topic-experiences/feat-047-watch-template-settings-and-single-video-fallback.md`, `docs/roadmap/media-generation/feat-054-video-pages-2-0.md`, `docs/roadmap/media-generation/feat-035-video-palyer-ux-for-autogenerated-subs.md`
- External: Mux Player React docs https://www.mux.com/docs/guides/player-api-reference/react, Mux Player web releases https://www.mux.com/docs/guides/player-releases-web
