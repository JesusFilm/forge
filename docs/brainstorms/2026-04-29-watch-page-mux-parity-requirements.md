---
date: 2026-04-29
topic: watch-page-mux-parity
---

# Dedicated Watch Page — Parity with jesusfilm.org/watch on Mux Ecosystem

## Summary

Build a new dedicated video watch page in `apps/web` at `/watch/[collection]/[video]/[locale]` that mirrors the structure of `jesusfilm.org/watch/{collection}.html/{video}/{locale}.html`, powered by the Mux ecosystem (`@mux/mux-player-react` for the watch surface, `@mux/mux-video-react` for hero/inline) and a hybrid data model that auto-templates from `Video` fields with optional `Experience` override.

---

## Problem Frame

`jesusfilm.org/watch` ships a polished, multi-language, study-context-rich video viewing experience built years ago on a fixed-template Pages-Router app. Forge `apps/web` has been advancing in parallel: it owns a CMS-driven Experience renderer with most of the building blocks (`BibleQuotesCarousel`, `RelatedQuestions`, `VideoHero`, `CarouselVideo`), a custom video.js 8 player, and an established `[slug]/[locale]` route pattern. What it does **not** have is a dedicated video viewing surface that matches what jesusfilm.org delivers today — the autoplay-muted hero with "Play with Sound" CTA, the sibling clip carousel under the parent collection, the two-column body with study questions, the Bible Quotes section with promo card, the download flow, the language picker, the share flow with embed code, and the Ask-Yours pathway into existing JFP outreach services.

The technical question that has been blocking design ("video.js 10 or Mux Player?") rests on a faulty premise: jesusfilm.org's existing player is already video.js with Mux as the streaming source, and Mux now stewards Video.js v10 (which is currently a beta with no captions menu, no audio-track menu, no quality selector, no AirPlay, no DRM). Resolving the player decision unblocks every downstream choice about player chrome, multi-language UX, analytics, and how the existing `useVideoPlayerCore` custom-controls pattern in `VideoHero`, `CarouselVideo`, and inline `Video` blocks evolves.

---

## Actors

- A1. **End viewer**: Visits a video URL (organic, share link, or in-app navigation), expects autoplay-muted hero, easy unmute, multi-language audio + subtitle controls, ability to download, share, or seek related context.
- A2. **Content editor (CMS)**: Authors `Video` records in Strapi with study questions, Bible citations, and downloads; optionally authors a paired `Experience` for per-video override of the auto-template.
- A3. **JFP outreach volunteer (off-Forge)**: Receives the inbound conversation when a viewer clicks "Chat with a person" in the Ask-Yours panel. Conversation lives on existing JFP infrastructure (e.g., `issuesiface.com/talk`).
- A4. **Embedding partner**: Pastes the embed snippet from the share modal into a third-party page; expects a self-contained Mux Player wrapper that respects the same parity rules.

---

## Key Flows

- F1. **Hero → Watch transition**
  - **Trigger:** Page load
  - **Actors:** A1
  - **Steps:**
    1. Page resolves `/watch/[collection]/[video]/[locale]`, fetches the `Video` and (optionally) a paired `Experience`.
    2. `@mux/mux-player-react` mounts with `autoplay="muted"`, `loop`, full chrome hidden via CSS Custom Properties.
    3. "Play with Sound" overlay pill renders on top of the player.
    4. Viewer clicks the pill; player unmutes, restarts from `currentTime = 0`, full chrome reveals (controls bar, scrub bar, audio/subtitle menus, AirPlay, PiP, fullscreen).
    5. Subsequent viewer interaction with the chrome behaves as a standard Mux Player session.
  - **Outcome:** The same player serves both hero and watch states; no remount.
  - **Covered by:** R1, R2, R3, R5

- F2. **Audio language switching**
  - **Trigger:** Viewer opens Language picker modal
  - **Actors:** A1
  - **Steps:**
    1. Viewer clicks the Language affordance (separate from Mux Player's in-stream subtitle menu).
    2. Modal lists all available `Video.variants[].language` choices (e.g., 13 audio languages for "Considering Christmas").
    3. Viewer selects a language → app navigates to `/watch/[collection]/[video]/[selectedLocale]`.
    4. New page resolves the corresponding variant, mounts a fresh player at the new HLS URL.
  - **Outcome:** Viewer is on the chosen audio language; subtitle tracks within that variant remain available via Mux Player's in-stream menu.
  - **Covered by:** R8, R9

- F3. **Download with Terms-of-Use**
  - **Trigger:** Viewer clicks the Download button in the body block
  - **Actors:** A1
  - **Steps:**
    1. Modal opens with file-size / quality picker (sourced from `Video.variants[].downloads[]`).
    2. Modal displays Terms-of-Use text with an "I agree" checkbox.
    3. Viewer must check "I agree" AND select a size before the Download button enables.
    4. Click triggers a direct download from the variant download URL.
  - **Outcome:** File downloads to the viewer's device.
  - **Covered by:** R8, R9

- F4. **Share with embed code**
  - **Trigger:** Viewer clicks the Share button on the Bible Quotes section
  - **Actors:** A1, A4
  - **Steps:**
    1. Modal opens with two tabs/sections: Share Link and Embed Code.
    2. Share Link offers Copy Link (current canonical URL).
    3. Embed Code offers a `<iframe>` snippet (or JS snippet) pointing to a Forge embed route that renders a self-contained Mux Player.
    4. Viewer copies one or the other; success state confirms the copy.
  - **Outcome:** Shareable artifacts are generated; embed URL plays the same video standalone for A4.
  - **Covered by:** R14, R16

- F5. **Ask-Yours outbound**
  - **Trigger:** Viewer clicks "Ask Yours" next to Related Questions
  - **Actors:** A1, A3
  - **Steps:**
    1. Panel opens with two CTAs: "Chat with a person" and "Ask a Bible question".
    2. Each CTA opens an external JFP-owned URL in a new tab (e.g., `https://issuesiface.com/talk?utm_source=forge-watch`).
    3. Conversation continues off-Forge with the JFP outreach service.
  - **Outcome:** Viewer is handed off to existing JFP infrastructure with proper attribution.
  - **Covered by:** R15

---

## Requirements

**Routing and data resolution**

- R1. New route `apps/web/src/app/watch/[collection]/[video]/[locale]/page.tsx` resolves a `Video` by collection slug + video slug + locale.
- R2. The route uses a hybrid resolver: if a paired `Experience` exists for the resolved Video, render its `blocks[]`; otherwise auto-generate a default template from Video fields (`studyQuestions` → RelatedQuestions, `bibleCitations` → BibleQuotesCarousel, `children` of parent collection → sibling carousel).
- R3. The route exports `generateMetadata()` for SEO using Video fields and any Experience override.

**Player surface**

- R4. The dedicated watch page mounts `@mux/mux-player-react` as the single video surface for the page.
- R5. The player initializes muted with autoplay, looped, and chrome hidden via CSS Custom Properties (`--controls`, etc.); a "Play with Sound" overlay button is rendered above the player.
- R6. When the viewer clicks "Play with Sound", the player unmutes, seeks to `currentTime = 0`, plays once (no loop), and reveals the full Mux Player chrome including audio-track menu, subtitle menu, playback rate, AirPlay, PiP, fullscreen, and quality selector where supported.
- R7. The player consumes the resolved `Video.variant.hls` URL plus all in-stream WebVTT subtitle tracks present in the HLS manifest; subtitle switching uses Mux Player's native captions menu.

**Multi-language UX**

- R8. A Language picker affordance opens a modal listing every `Video.variants[].language`; selecting a language navigates the viewer to `/watch/[collection]/[video]/[selectedLocale]`.
- R9. The currently active locale is visually indicated in the picker.

**Body blocks (auto-template defaults)**

- R10. The body renders a two-column layout: left = label (e.g., `SHORT FILM`) + title + description + Download button; right = Related Questions accordion sourced from `Video.studyQuestions[]` plus an "Ask Yours" CTA.
- R11. The sibling clip carousel renders as `{ParentCollectionTitle} · Clip {N} of {Total}` with horizontal-scrolling thumbnails sourced from the parent collection's `children[]`; the current video is visually highlighted.
- R12. The Bible Quotes section renders quote cards from `Video.bibleCitations[]` plus a "Free Resources / Join Our Bible Study" promo card and a Share button.

**Modals and overlays**

- R13. Download modal: lists `Video.variant.downloads[]` quality options with file sizes, requires viewer to agree to Terms-of-Use AND select a size before the Download button enables, then triggers a direct download from the variant download URL.
- R14. Share modal: provides Copy Link (canonical URL of current page) AND Copy Embed Code (iframe or JS snippet pointing to a Forge embed route at `/watch/[collection]/[video]/[locale]/embed`).
- R15. Ask-Yours panel: presents "Chat with a person" and "Ask a Bible question" CTAs that open the corresponding existing JFP-owned URL in a new tab with `utm_source=forge-watch`.
- R16. Embed route at `/watch/[collection]/[video]/[locale]/embed` renders a standalone `@mux/mux-player-react` with no Forge chrome (no nav, no Bible Quotes, no body), suitable for `<iframe>` use.

**Player ecosystem migration (apps/web-wide)**

- R17. `VideoHero`, `CarouselVideo`, and inline `Video` block components migrate from `useVideoPlayerCore` (video.js 8) to `@mux/mux-video-react` (bare custom element, no chrome). Existing scroll-pause behavior, custom mute button, and autoplay-on-viewport semantics are preserved.
- R18. `@forge/video-player` workspace package keeps its name but pivots to expose brand-defaults wrappers around `@mux/mux-player-react` and `@mux/mux-video-react`. The `useVideoPlayerCore` hook and its video.js dependency are retired.
- R19. video.js (`video.js@^8.22.0`) is removed from `apps/web` and `packages/video-player` after R17 and R18 land.

**CMS and data**

- R20. Strapi `Video` content type adds: `studyQuestions[]` (text + primary boolean), `bibleCitations[]` (book + chapterStart/End + verseStart/End), `downloads[]` on `VideoVariant` (quality enum + size + url).
- R21. Strapi `Video` content type adds a `parent` relation linking a video to its enclosing collection so the sibling carousel can resolve peers.
- R22. `packages/graphql/` regenerates types after the Strapi changes. New GraphQL operations: `GetWatchVideo($collection, $video, $locale)`, `GetWatchVideoSiblings($collectionSlug, $excludeVideoId)`. Existing `GetRouteVideo` is left in place for current consumers.

**Analytics and privacy**

- R23. Mux Data is enabled with the JFP env key for every Mux-served video in `apps/web`, with `metadata.viewer_user_id` populated from session, `metadata.video_title` from `Video.title`, `metadata.player_name = "forge-web-watch"` (or the equivalent for hero/inline surfaces).
- R24. Mux Player runs with `disable-cookies` set unless a cookie banner integration explicitly opts in.

---

## Acceptance Examples

- AE1. **Covers R5, R6.** Given a viewer lands on `/watch/christmas/considering-christmas/english`, when the page loads, the Mux Player autoplays muted in a loop with no visible controls and a "Play with Sound" pill is overlaid. When the viewer clicks the pill, the player seeks to `currentTime = 0`, unmutes, plays once (no loop), and the full Mux Player control bar (play, scrub, audio menu, subtitle menu, playback rate, AirPlay, PiP, fullscreen) becomes visible.
- AE2. **Covers R7.** Given a Video variant has 12 in-stream WebVTT subtitle tracks, when the viewer opens Mux Player's captions menu, all 12 tracks appear with their language labels and the viewer can toggle between them without page navigation.
- AE3. **Covers R8.** Given a Video has 13 audio-language variants, when the viewer opens the Language picker modal and selects a different language, the app navigates to the new locale URL and a fresh player loads the corresponding variant's HLS URL.
- AE4. **Covers R13.** Given the Download modal is open, when the viewer has not yet checked "I agree to the Terms of Use" or has not selected a size, the Download button is disabled. When both conditions are met, the button enables and a click downloads the selected file directly.
- AE5. **Covers R2, R10, R12.** Given a Video has `studyQuestions[]` and `bibleCitations[]` populated but no paired Experience exists, the body auto-renders a Related Questions accordion from the study questions and a Bible Quotes section from the citations. Given a paired Experience exists for the same Video, the route renders the Experience's blocks instead of the auto-template.
- AE6. **Covers R15.** Given the viewer clicks the Ask-Yours panel's "Chat with a person" CTA, a new browser tab opens to `https://issuesiface.com/talk?utm_source=forge-watch` (or the configured equivalent). No Forge-internal chat UI is rendered.
- AE7. **Covers R16.** Given a third-party page embeds `<iframe src="https://[forge-host]/watch/christmas/considering-christmas/english/embed">`, the iframe renders a standalone Mux Player that plays the same video; no Forge nav, body, Bible Quotes, or Ask-Yours UI is present.
- AE8. **Covers R17.** Given an experience page with a `VideoHero` block, when the page loads, the hero video autoplays muted in a loop, pauses on scroll past 100px, and the existing custom mute button toggles audio. Network inspection confirms no `video.js` JS bundle is shipped; the player is `@mux/mux-video-react`.

---

## Success Criteria

- A viewer landing on `/watch/christmas/considering-christmas/english` sees a page that is structurally and behaviorally indistinguishable from the equivalent jesusfilm.org page for the visible sections and listed modals — including hero pattern, sibling carousel, body composition, Related Questions, Bible Quotes, Download, Language picker, Share with embed code, and Ask-Yours.
- All audio-track and subtitle-track switching documented for the reference asset works — 12 subtitles within the English variant via Mux Player's captions menu, 13 audio-language navigations via the Language picker.
- Mux Data telemetry shows `view_start`, `playback_failure_*`, and `player_startup_time` events for every watch session, with `player_name` and `viewer_user_id` populated.
- video.js is fully removed from `apps/web` and `packages/video-player`'s package.json. `useVideoPlayerCore` is deleted. No `import "video.js"` remains in apps/web source.
- Cookie / consent posture matches JFP's existing privacy stance (default `disable-cookies` on Mux Player unless explicitly opted in).
- A downstream `ce-plan` invocation can begin implementation work without inventing data models, route shapes, modal flows, or player choices.

---

## Scope Boundaries

- Migration of jesusfilm.org/watch to Forge as the canonical surface — Forge runs in parallel, not as replacement.
- Video.js v10 adoption — defer until v10 GA stabilizes (likely late 2026 / early 2027) and the menu / AirPlay / DRM / i18n epics close. Re-evaluate then.
- Building chat-with-a-person or ask-a-bible-question services in Forge — link to existing JFP infrastructure only.
- DASH playback, DRM (Widevine / FairPlay / PlayReady), low-latency LL-HLS — not used in JFP's current distribution model.
- React Native player work in `apps/mobile` — mobile keeps `expo-video`. The brainstormed migration applies only to `apps/web`.
- TV app (`apps/tv`) — keeps `expo-video`. Not in scope.
- Collection landing pages at `/watch/[collection]` — the URL shape supports it; v1 only renders the leaf video page.
- Per-page A/B "new vs classic" experience banner — JFP-specific surface, not relevant to a parallel Forge build.
- Cookie banner UI — Forge will set `disable-cookies` defensively; banner integration is a separate ticket if/when JFP adds one.
- Fullscreen embed-route customization (themes, overlays, branding) — embed v1 is the standalone Mux Player only.

---

## Key Decisions

- **Player choice — Mux ecosystem (not video.js v10)**: Mux Player ships every menu (captions, audio tracks, quality, settings, chapters), AirPlay, DRM-ready, storyboard scrub, signed playback, and Mux Data wired by `playback-id`. Video.js v10 beta is missing all menus, AirPlay, and DRM, and GA is targeted late-2026 with high slip risk. With JFP needing 12 subtitle and 13 audio language UX per video, v10 today cannot meet the bar without writing menu primitives ahead of the framework.
- **Right primitive per surface**: Mux Player (full chrome) for the watch page only; `@mux/mux-video-react` (bare element, no chrome) for hero / carousel / inline blocks. Avoids shipping ~80–110 KB gz of player chrome on every experience page that has a background video.
- **Hybrid data shape**: Video-driven template by default, Experience override when needed. Editors do not have to author an Experience for every video; they can override per-video when the layout demands it. Extends the existing `feat-047 watch-template-settings` pattern.
- **URL mirrors jesusfilm.org**: `/watch/[collection]/[video]/[locale]`. Three segments preserve SEO continuity, keep collection in the URL for future landing-page work, and avoid colliding with the existing `/[slug]` namespace used by Experience-led pages.
- **Single player throughout, chrome reveals on interaction**: Same `@mux/mux-player-react` instance for hero state and watch state. CSS-driven chrome hide / show; no remount on "Play with Sound" click. Matches jesusfilm.org's behavior and avoids two-player coexistence on the same page.
- **Ask-Yours links out, does not embed**: Both CTAs open existing JFP-owned URLs in a new tab with `utm_source=forge-watch` for attribution. Building chat in Forge is out of scope.
- **Retire `useVideoPlayerCore` and `video.js`**: A full ecosystem move beats two coexisting players. `@forge/video-player` keeps its name but pivots to a Mux wrapper. Existing scroll-pause, custom mute button, autoplay-on-viewport semantics are preserved by the consumer components, just sourced from `@mux/mux-video-react` instead of `video.js`.

---

## Dependencies / Assumptions

- Strapi `Video` content type can be extended with `studyQuestions[]`, `bibleCitations[]`, `downloads[]` on variants, and a `parent` relation. The CMS migration cost is bounded and fits the existing Strapi v5 + Strapi codegen pipeline (per `apps/cms/CLAUDE.md` and the GraphQL change flow in root `CLAUDE.md`).
- JFP's Mux account headroom on Mux Data covers an increase in monitored views once `apps/web` routes all video playback through Mux ecosystem players. Verify pricing tier before launch.
- Existing JFP outreach services at `https://issuesiface.com/talk` (and the equivalent Bible-question URL) remain stable URLs that can be linked from Forge with custom UTM source.
- Existing `BibleQuotesCarousel` and `RelatedQuestions` block components are flexible enough to accept input shapes adapted from Video fields. If their fragment input shapes need extending, the change is local to those components and not a structural rewrite.
- The reference asset's HLS manifest (`https://stream.mux.com/wmW7kl00pR1qV006mKESP53IfjJqBPNOGqX019m01OpJBDc.m3u8`) is representative of JFP's normal Mux output (12 in-stream WebVTT subtitles, single audio track per variant, multiple variants per language). If JFP later switches to multi-audio-track HLS within a single variant, Mux Player's auto audio-track menu becomes the right surface and R8/F2 simplify.
- The `@forge/video-player` workspace package has no external consumers beyond `apps/web` (mobile and TV use `expo-video`). Verifying this assumption is a pre-implementation step — if `apps/admin`, `apps/cms`, or another app imports it, R17–R19 expand.
- `apps/web/CLAUDE.md` conventions hold: App Router only, `'use client'` boundaries respected for Mux Player (which requires it), Server Component default for the route shell, GraphQL operations live in `packages/graphql` (per repo convention).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R20, R21][Needs research] Whether the Strapi `Video` content type already has a path to add `studyQuestions[]`, `bibleCitations[]`, `downloads[]`, and a `parent` relation, or whether this requires a separate prerequisite CMS migration ticket. Planning should read `apps/cms/schema.graphql`, check existing similar components, and decide whether the Strapi work is bundled with the watch page ticket or sequenced as a blocker.
- [Affects R15][User decision during planning] Confirm the URL for the "Ask a Bible question" CTA. The "Chat with a person" URL was provided (`https://issuesiface.com/talk?utm_source=forge-watch`); the second CTA's destination is currently unconfirmed. Assume a parallel JFP-hosted URL with `utm_source=forge-watch` until verified by the team.
- [Affects R16][User decision during planning] Embed-route rendering policy — whether the embed iframe defaults to signed playback URLs (`playback-token`) for piracy resistance, or stays on public Mux URLs for copy-paste-friendly embedding. Planning should surface this to the team and pick.
- [Affects R20][Technical] The exact Strapi Component shape for `bibleCitations` (single component vs nested with `bibleBook` reference) — answered by reading `apps/cms/schema.graphql` and existing similar components.
- [Affects R22][Technical] Whether `GetWatchVideo` should fetch `parent.children[]` inline (one query) or whether the sibling carousel is a separate `GetWatchVideoSiblings` query — answered by Strapi query depth limits and rendering performance during planning.
- [Affects R17][Technical] Exact swap pattern for `useVideoPlayerCore` consumers — whether `@mux/mux-video-react`'s ref API exposes equivalents for `player.muted()`, `player.currentTime()`, `player.pause()` cleanly enough to keep the consumer logic intact, or whether the consumer logic needs lifting into the new wrapper.
- [Affects R23][Needs research] What `metadata.player_name` values does the JFP team already use in Mux Data for current jesusfilm.org instrumentation? Match that taxonomy or coin a parallel one (`forge-web-watch`, `forge-web-hero`, `forge-web-inline`).
- [Affects R5, R6][Technical] Hiding Mux Player's chrome via CSS Custom Properties for the muted-hero state — verify which combination of `--controls`, `--top-controls`, `--bottom-controls`, `--center-controls`, and gesture-layer flags produces a fully-hidden surface that still autoplays and accepts the overlay-pill click.
- [Affects R10, R11, R12][Technical] Per-block adapter signatures: each existing block component (`BibleQuotesCarousel`, `RelatedQuestions`, `CarouselVideo`) needs a small adapter to accept Video-derived input alongside its existing CMS-fragment input. Adapter signatures are a planning exercise.
- [Affects R19][Technical] Order of operations for retiring video.js — whether R17 (component migrations) and R19 (dependency removal) ship in one PR or staged. Likely staged, but pin in planning.
