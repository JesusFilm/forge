---
title: TV SDUI Renderer Parity with Mobile-v2
type: feat
status: active
date: 2026-04-14
origin: docs/brainstorms/2026-04-14-tv-sdui-renderer-parity-requirements.md
---

# TV SDUI Renderer Parity with Mobile-v2

## Overview

Add TV counterparts for six SDUI block renderers that exist in `apps/mobile-v2` but not in `apps/tv`: `easterDates`, `relatedQuestions`, `quizButton`, `navigationCarousel`, `videoCarousel`, `mediaCollection`. Each new renderer adapts mobile-v2's visual language for 10-foot UI + D-pad navigation, and wires into `apps/tv/src/components/sections/SectionDispatcher.tsx`.

Experience Detail is the only consumer. The home screen's hand-composed rails (`apps/tv/app/index.tsx`) remain unchanged — this plan does **not** port `ContentDispatcher` or `CuratedHomeLayout`.

## Problem Frame

`SectionDispatcher` in the TV app currently handles only `sectionWrapper`, `container`, `videoHero`, `video`, `text`, and `bibleQuotesCarousel`. Any other block kind falls through to `PlaceholderRenderer`, which silently returns `null`. Experiences authored in Strapi therefore render with visible gaps on TV where mobile shows rich content. GraphQL fragments for all six missing block kinds already exist in `apps/tv/src/lib/queries.ts`, and the TV normalizer already maps all the `__typename`s to `kind` discriminants — so this is purely a renderer + dispatcher-wiring gap (see origin: `docs/brainstorms/2026-04-14-tv-sdui-renderer-parity-requirements.md`).

## Requirements Trace

- **R1.** Every block kind mobile-v2 implements renders on TV inside the Experience Detail feed (no silent `null`, no `[TV] Unhandled block type` warnings for these six kinds).
- **R2.** New renderers look like mobile-v2's counterparts but adapt for 10-foot UI + D-pad navigation (focus ring, `TVFocusGuideView` on rails, larger text, system font, rounded Android font sizes).
- **R3.** Interactive elements navigate to the same destinations as mobile-v2 (video cards → same video target, etc.).
- **R4.** External URLs inside `relatedQuestions` are **info-only on TV** rather than opening a browser.
- **R5.** Crimson Gallery tokens (`apps/tv/src/lib/colors.ts`) are the sole color source; no 1px borders; 16px card radii.
- **R6.** QuizButton must degrade gracefully on tvOS where `react-native-webview` is unavailable.

## Scope Boundaries

- **Not** porting `ContentDispatcher` / `CuratedHomeLayout` from mobile-v2 — the TV home uses the correct TV pattern already.
- **Not** implementing the `cta` or `adventCountdown` block kinds — TODO on both platforms; out of parity scope.
- No visual redesign — parity of content, not redesign.
- No GraphQL schema changes. No normalizer changes. No query changes — all fragments already exist.

### Deferred to Separate Tasks

- `cta` and `adventCountdown` renderers for both platforms → separate future tickets.
- Auto-preview on focus for carousel items → tracked in prior TV prototype scope.
- Native quiz UI (as alternative to QR handoff) → not pursued unless product signals demand it.

## Context & Research

### Relevant Code and Patterns

- `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx` — canonical TV horizontal rail pattern. Uses `TVFocusGuideView autoFocus` wrapping a horizontal `FlatList` of `FocusableCard`s. **All three TV carousels should mirror this structure.**
- `apps/tv/src/components/sections/VideoCardRenderer.tsx` — canonical TV card using `FocusableCard` + image + title, with `validateStreamingUrl` + `useVideoPlayerContext`.
- `apps/tv/src/components/FocusableCard.tsx` — provides the 1.05x scale + crimson glow focus ring. Every focusable item in the new renderers should be a `FocusableCard` or use the same focus styling.
- `apps/tv/src/components/sections/VideoHeroRenderer.tsx` — establishes the 10-foot typography scale (title 40pt, subtitle 20pt) and the `hexToRgba`/`LinearGradient` pattern.
- `apps/tv/src/lib/colors.ts` — single source of Crimson Gallery tokens.
- `apps/tv/src/lib/validateUrl.ts` — URL validation utilities; extend with `validateActionUrl` if not already present.
- `apps/tv/src/lib/resolveImageUrl.ts`, `apps/tv/src/lib/types.ts` (`pickThumbnailUrl`) — image helpers already in use.
- `apps/mobile-v2/src/components/sections/*` — source renderers. Read each before porting; do not copy imports or mobile-specific hooks (`useTypography`, `useSafeAreaInsets`).

### Institutional Learnings

- `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md` — relevant if any carousel renders inline video (none do in current scope, but worth noting for future auto-preview).
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — reinforces `EXPO_TV=1 npx expo prebuild --clean` when adding native deps.
- `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` — deferred these renderers; this plan closes that deferral.

### External References

- Apple `tvOS` does not ship WebKit / `WKWebView`; `react-native-webview` explicitly does not support tvOS. This constrains the `quizButton` design — verified by consulting the `react-native-webview` platform support table and the react-native-tvos maintainer notes.
- `@hebcal/hdate` pure-JS package (no native code) — safe to add to TV app without prebuild changes.
- `react-native-qrcode-svg` uses `react-native-svg` which is already transitively present via `expo-image`/Expo SDK 54 and supports tvOS + Android TV.

## Key Technical Decisions

- **Mirror `BibleQuotesCarouselRenderer` for all three new carousels** (Navigation, Video, Media). Rationale: it is the established TV pattern (`TVFocusGuideView` + `FlatList` horizontal + `FocusableCard`); introducing a second carousel idiom would fragment the codebase and make focus navigation inconsistent.
- **Do not import `useTypography` from mobile-v2.** Use direct style values following `VideoHeroRenderer` and `BibleQuotesCarouselRenderer`: title ~28–32pt, body ~20pt, caption ~16pt. `Math.round()` any computed values on Android (per `apps/tv/CLAUDE.md`).
- **RelatedQuestions: use D-pad-focusable `Pressable` rows with crimson glow, not `FocusableCard`.** Cards are too visually heavy for inline expanding rows. Style focus ring inline (same shadow-only treatment as `FocusableCard`'s `cardFocused`, minus scale, since scaling a full-width row causes adjacent row displacement).
- **RelatedQuestions external CTA link (`ctaLink`) is dropped on TV.** Mobile uses `Linking.openURL`, which on TV hands off to a browser that often doesn't exist (tvOS has no browser at all). Showing the icon as non-actionable would mislead users; hiding it is cleaner. The header heading still renders.
- **QuizButton tvOS fallback: render a QR-code card.** On tvOS, where `react-native-webview` is unavailable, render a card showing the quiz URL as a QR code + "Scan to continue on your phone" copy. On Android TV, use the same `WebView` modal pattern as mobile-v2 (react-native-webview does work on Android TV). This follows the TV best practice of handing complex interactive flows off to a companion device rather than forcing keyboard entry with a D-pad.
- **Platform branch inside `QuizButtonRenderer`**, not separate files. Use `Platform.isTV && Platform.OS === 'ios'` (tvOS) vs `Platform.OS === 'android'` (Android TV). Keeps the block registered once in the dispatcher.
- **EasterDates on TV is not expandable.** Mobile uses a `Pressable` + `AnimatedChevron` expand/collapse to conserve vertical space. A TV Experience Detail screen has abundant vertical space and collapse interactions are friction under D-pad; render all three date rows always-visible as a static info card. Skips the need to port `AnimatedChevron`.
- **Remove `PlaceholderRenderer` fallback for the six newly-handled kinds, but keep it as default** for anything else (future-proofing for unreleased block kinds). Keep the `[TV] Unhandled block type` dev warning.
- **Carousel images use `pickThumbnailUrl`** (which prefers `videoStill` over `mobileCinematicHigh`) matching the TV home rail convention and landscape-native aspect ratio.

## Open Questions

### Resolved During Planning

- Which CTA component does "ctaButton" refer to? → `QuizButtonRenderer` only (origin doc: `AskUserQuestion` result).
- Should `ContentDispatcher` / `CuratedHomeLayout` be ported? → No (origin doc).
- How should taps behave? → Match mobile-v2 navigation (origin doc).

### Deferred to Implementation

- **Exact font sizes for each new renderer.** The plan specifies scale tiers; implementer tunes to match the Stitch TV design visually during build.
- **Card widths for Navigation / Video / Media carousels.** Mobile uses screen-width ratios (0.37, 0.6). TV screens are much wider; the implementer should pick fixed widths analogous to `BibleQuotesCarouselRenderer`'s 400pt card, sized to show ~4–5 cards per row.
- **Whether `mediaCollection` routes to `/video/<slug>` or `/experience/<slug>`.** Mobile uses `/video/<key>`; TV currently has `/experience/<slug>` and a hero player. Implementer spot-checks one real Experience's `mediaCollection` items and picks the route that resolves; if neither works, falls back to `experience/<slug>`.
- **Final QR-code library choice and dep install.** Planning recommends `react-native-qrcode-svg`; implementer verifies it builds on tvOS before committing, or substitutes a same-shape alternative.

## Implementation Units

- [ ] **Unit 1: Add runtime dependencies**

**Goal:** Install the two new npm packages the renderers need, and verify the TV prebuild still succeeds.

**Requirements:** R2 (EasterDates math), R6 (tvOS QuizButton fallback).

**Dependencies:** None.

**Files:**

- Modify: `apps/tv/package.json`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Approach:**

- Add `@hebcal/hdate` (pure JS — no native code, same version mobile-v2 uses so the lock stays tight).
- Add `react-native-qrcode-svg` (uses `react-native-svg`, already transitively available).
- Run `EXPO_TV=1 npx expo prebuild --clean` per `apps/tv/CLAUDE.md` to regenerate native project with any new dep.

**Patterns to follow:**

- `apps/mobile-v2/package.json` for the `@hebcal/hdate` version to align on.

**Test scenarios:**

- Test expectation: none — pure dependency addition; verified by the prebuild and a smoke build on both targets.

**Verification:**

- `pnpm install` completes without errors.
- `EXPO_TV=1 npx expo prebuild --clean` succeeds.
- Running the app on tvOS and Android TV simulators starts without a Metro bundling error.

---

- [ ] **Unit 2: `EasterDatesRenderer.tsx`**

**Goal:** Render upcoming Western Easter, Orthodox Easter, and Passover dates as a static, non-interactive info card sized for 10-foot viewing.

**Requirements:** R1, R2, R5.

**Dependencies:** Unit 1 (adds `@hebcal/hdate`).

**Files:**

- Create: `apps/tv/src/components/sections/EasterDatesRenderer.tsx`
- Create: `apps/tv/src/components/sections/EasterDatesRenderer.test.tsx`

**Approach:**

- Port the three date-calculation functions (`calculateWesternEaster`, `calculateOrthodoxEaster`, `calculatePassover`) **verbatim** from `apps/mobile-v2/src/components/sections/EasterDatesRenderer.tsx`. They are pure functions and do not need TV adaptation.
- Render a single gradient `LinearGradient` card (same three-color gradient as mobile) containing the heading + three `dateGroup`s, **always expanded**. No `Pressable`, no `AnimatedChevron`, no state.
- Text color stays dark-on-warm-gradient (mobile uses `rgba(0,0,0,0.85)` etc.) — the gradient itself is bright enough on TV and the dark text stays readable. Do not override with Crimson Gallery text colors; the card is intentionally a warm accent.
- Use `section.locale ?? "en-US"`, `section.easterDatesTitle`, and the three `*Label` fields from the CMS.

**Patterns to follow:**

- `apps/mobile-v2/src/components/sections/EasterDatesRenderer.tsx` (layout, copy, gradient colors).
- `apps/tv/src/components/sections/VideoHeroRenderer.tsx` (for `LinearGradient` usage on TV).

**Test scenarios:**

- Happy path — renders three date rows when given a valid section with all label strings; the year in the title is replaced with the current year via `.replace("{year}", ...)`.
- Edge case — `easterDatesTitle` is null → component still renders without throwing; title area degrades gracefully (empty or omitted).
- Edge case — `locale` is null → falls back to `"en-US"`.
- Pure function — `calculateWesternEaster(2026)` returns `April 5, 2026` (known value); `calculateOrthodoxEaster(2026)` returns `April 12, 2026`; `calculatePassover(2026)` returns a valid Gregorian `Date` in April 2026.

**Verification:**

- On an Experience containing an `easterDates` block, the card renders with three correctly-formatted dates and no `Pressable`/chevron UI.
- D-pad navigation skips over this block (no focus ring appears on it).

---

- [ ] **Unit 3: `RelatedQuestionsRenderer.tsx`**

**Goal:** Render a list of expandable Q&A rows, each D-pad-focusable, with Select toggling expand/collapse. External CTA link is omitted on TV.

**Requirements:** R1, R2, R3, R4, R5.

**Dependencies:** None (uses only built-ins + existing TV helpers).

**Files:**

- Create: `apps/tv/src/components/sections/RelatedQuestionsRenderer.tsx`
- Create: `apps/tv/src/components/sections/RelatedQuestionsRenderer.test.tsx`

**Approach:**

- Read `section.rqHeading` and `section.questions` (same shape as mobile: `{ id, question, answer }[]`).
- Render heading as a section header (system font, muted token, matching `BibleQuotesCarouselRenderer`'s `heading` style).
- Each question is a `Pressable` with `onFocus`/`onBlur` toggling a focus state, applying a crimson-glow shadow (no scale — rows are full-width, scaling shifts neighbors).
- Use a single `expandedId` state; Select toggles in-place expand/collapse. Use `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` for a smooth transition, guarded on Android with `UIManager.setLayoutAnimationEnabledExperimental?.(true)` at module load (see mobile-v2's `animateLayout` helper for reference).
- Replace `AnimatedChevron` with a simple `Text` arrow glyph (`›` unfocused, `⌄` expanded). Lighter port than bringing in `Animated` + `Easing` for a single row indicator.
- Do **not** render the external `ctaLink` / `ctaLabel` (per decision above).

**Patterns to follow:**

- `apps/mobile-v2/src/components/sections/RelatedQuestionsRenderer.tsx` (item shape, expand logic, layout).
- `apps/tv/src/components/FocusableCard.tsx` (focus-style shadow — copy the `cardFocused` shadow properties to the row's focused state).
- `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx` (heading typography).

**Test scenarios:**

- Happy path — renders heading and N rows when `questions` has N items; Select on a row expands its answer and hides the previous one.
- Happy path — Select on an already-expanded row collapses it (expandedId returns to null).
- Edge case — `questions` is null or empty → heading still renders; no rows.
- Edge case — `rqHeading` is null → rows render without a header; no crash.
- Edge case — `ctaLink` is present in the section → is NOT rendered (no Linking.openURL anywhere in the file).
- Focus — row receives focus styling when focused, loses it on blur.

**Verification:**

- D-pad up/down moves focus between rows, Select expands/collapses, and the external CTA is never visible.
- No `Linking` import in the file.

---

- [ ] **Unit 4: `QuizButtonRenderer.tsx`**

**Goal:** Render a focusable CTA that launches the quiz. On Android TV, embed the quiz in a full-screen `WebView` modal (mobile-v2 parity). On tvOS (where `react-native-webview` is unavailable), render a QR code card pointing at the quiz URL with "Scan to continue on your phone" copy.

**Requirements:** R1, R2, R3, R5, R6.

**Dependencies:** Unit 1 (adds `react-native-qrcode-svg`).

**Files:**

- Create: `apps/tv/src/components/sections/QuizButtonRenderer.tsx`
- Create: `apps/tv/src/components/sections/QuizButtonRenderer.test.tsx`

**Approach:**

- Read `section.buttonText`, `section.iframeSrc`. Use the same `isAllowedQuizUrl` validator shape as mobile (HTTPS only, `nextstep.is` allowlist); copy it into this file so TV's `validateUrl.ts` stays unchanged.
- Silent drop (`return null`) if `iframeSrc` is missing or fails validation — matches mobile.
- Render a `FocusableCard` with `LinearGradient` background (reuse mobile's `QUIZ_GRADIENT` colors; define locally), badge + label + arrow. Card occupies full section width, min-height generous for 10-foot UI.
- On Select:
  - **Android TV** (`Platform.OS === "android"`): open a `Modal` containing a `WebView` with the same source, origin whitelist, and nav-request guard as mobile-v2.
  - **tvOS** (`Platform.isTV && Platform.OS === "ios"`): open a `Modal` containing a large QR code (via `react-native-qrcode-svg`) of `iframeSrc` + headline "Scan to continue on your phone" + body with the URL as readable text.
- Both modals are dismissed with the remote's Menu/Back button via `Modal`'s `onRequestClose`, plus a focusable Close button for redundancy.

**Patterns to follow:**

- `apps/mobile-v2/src/components/sections/QuizButtonRenderer.tsx` (URL validator, gradient colors, modal structure for the Android path).
- `apps/tv/src/components/FocusableCard.tsx` for the button itself.
- `apps/tv/src/components/sections/VideoHeroRenderer.tsx` for `LinearGradient` + Crimson Gallery tokens.

**Test scenarios:**

- Happy path — valid `iframeSrc` renders the button with correct label; Select opens the modal.
- Happy path (Android) — modal shows a `WebView`; mocked `Platform.OS = 'android'`.
- Happy path (tvOS) — modal shows the QR code + URL text; mocked `Platform.OS = 'ios'` + `Platform.isTV = true`.
- Edge case — `buttonText` is null → falls back to `"Take the quiz"` (same default as mobile).
- Error path — `iframeSrc` is `"http://nextstep.is/..."` (not HTTPS) → component renders nothing.
- Error path — `iframeSrc` is `"https://evil.com/quiz"` (not allowlisted) → component renders nothing.
- Focus — D-pad Select on the button triggers modal open; modal Close focusable on open.

**Verification:**

- On Android TV: tapping the button opens the functional quiz webview.
- On tvOS: tapping the button opens a scannable QR code.
- On both: Menu button dismisses the modal and focus returns to the button.

---

- [ ] **Unit 5: `NavigationCarouselRenderer.tsx`**

**Goal:** Horizontal focusable rail of navigation cards that jump to an in-experience section (by `contentId`).

**Requirements:** R1, R2, R3, R5.

**Dependencies:** None.

**Files:**

- Create: `apps/tv/src/components/sections/NavigationCarouselRenderer.tsx`
- Create: `apps/tv/src/components/sections/NavigationCarouselRenderer.test.tsx`

**Approach:**

- Read `section.navHeading` (default `"Stories"`) and `section.items` (shape: `{ id, contentId, title, category?, imageUrl?, backgroundColor? }[]`).
- Structure: heading → `TVFocusGuideView autoFocus` → horizontal `FlatList` of `FocusableCard`s — **copy the exact skeleton from `BibleQuotesCarouselRenderer.tsx`**.
- Each card: image (if `imageUrl` resolvable) + dark gradient overlay + category caption + title. Card size ~220×260 (portrait-ish, matching mobile's 110×130 scaled ~2x for TV — implementer tunes visually).
- `onPress`: for this plan, `console.log` the `contentId` — **in-experience scroll-to-section is deferred** (same TODO as mobile; routing a D-pad flow to scroll a parent `ScrollView` to a target offset requires coordination with `experience/[slug].tsx` that is out of scope here). Leave a `// TODO` with a link back to this unit.
- Return `null` when `items` is empty.

**Patterns to follow:**

- `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx` (rail skeleton).
- `apps/mobile-v2/src/components/sections/NavigationCarouselRenderer.tsx` (card composition + gradient colors).

**Test scenarios:**

- Happy path — N items in section → FlatList renders N `FocusableCard`s.
- Edge case — `items` empty → returns null (no heading, no rail).
- Edge case — `imageUrl` missing → card still renders with `backgroundColor` fallback; no crash.
- Edge case — `navHeading` missing → defaults to `"Stories"`.
- Focus — first card receives focus when rail is entered (via `TVFocusGuideView autoFocus`).

**Verification:**

- D-pad left/right moves within the rail, doesn't leak to adjacent sections.
- Focus ring visible on the focused card.
- Console log on Select fires with the correct `contentId`.

---

- [ ] **Unit 6: `VideoCarouselRenderer.tsx`**

**Goal:** Horizontal focusable rail of video cards. Select plays the video inline via the TV's shared video player (same contract as `VideoCardRenderer`).

**Requirements:** R1, R2, R3, R5.

**Dependencies:** None.

**Files:**

- Create: `apps/tv/src/components/sections/VideoCarouselRenderer.tsx`
- Create: `apps/tv/src/components/sections/VideoCarouselRenderer.test.tsx`

**Approach:**

- Read `section.vcTitle`, `section.vcSubtitle`, `section.items` (shape: `{ id, streamingUrl?, imageUrl?, titleOverride?, backgroundColor?, video? }[]`).
- Use the same rail skeleton as Unit 5 (`TVFocusGuideView` + horizontal `FlatList`).
- Each card uses `FocusableCard` styled with `VideoCardRenderer`'s landscape 320×180 dimensions. Include play-icon overlay + title band (copy mobile's overlay styling; drop `useTypography`).
- On Select:
  - Resolve `streamingUrl ?? video.streamingUrl`. If present and `validateStreamingUrl` passes, call `useVideoPlayerContext().playVideo(url, title)` — matches `VideoCardRenderer`.
  - **Deviation from mobile:** mobile's `VideoCarouselRenderer` routes to `/collection/<key>?index=...`. The TV app does not have a `/collection/` route; using the shared video player matches existing TV UX and avoids introducing a new route in this plan.
- Return `null` when `items` is empty.

**Patterns to follow:**

- `apps/tv/src/components/sections/VideoCardRenderer.tsx` (thumbnail + title + `playVideo`).
- `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx` (rail skeleton).
- `apps/mobile-v2/src/components/sections/VideoCarouselRenderer.tsx` (play-icon overlay + title band styling).

**Test scenarios:**

- Happy path — N items render; `vcTitle` + `vcSubtitle` render as heading + subtitle when present.
- Happy path — Select on a card with a valid `streamingUrl` calls `playVideo` with the URL and resolved title.
- Edge case — `items` empty → returns null.
- Edge case — card with invalid/missing `streamingUrl` → Select is a no-op (does not call `playVideo`).
- Edge case — `video.images` array empty but `item.imageUrl` present → that image is used as the thumbnail.
- Focus — `hasTVPreferredFocus` is false by default (first card does not force focus unless this is the only section).

**Verification:**

- D-pad across the rail, Select on a card opens the shared video player overlay.
- No `/collection/` route is introduced.

---

- [ ] **Unit 7: `MediaCollectionRenderer.tsx`**

**Goal:** Horizontal focusable rail of mixed media cards with optional collection-size badge and category label. Select routes to the same destination the video card does.

**Requirements:** R1, R2, R3, R5.

**Dependencies:** None.

**Files:**

- Create: `apps/tv/src/components/sections/MediaCollectionRenderer.tsx`
- Create: `apps/tv/src/components/sections/MediaCollectionRenderer.test.tsx`

**Approach:**

- Read `section.mcTitle`, `section.mcSubtitle`, `section.categoryLabel`, `section.items` (shape: `{ id, titleOverride?, labelOverride?, collectionSize?, imageUrl?, linkToSectionKey?, video? }[]`).
- Header composition: uppercase `categoryLabel` caption → `mcTitle` heading → `mcSubtitle` body. Match mobile-v2's order.
- Rail skeleton as in Unit 5/6. Card aspect ratio 3:4 (portrait), width roughly 260pt to preserve the mobile "poster" feel.
- Overlay: dark gradient bottom-up, `collectionSize` badge in top-right when present, label + title at bottom-left.
- On Select: resolve `linkToSectionKey ?? video.slug`. If the resolved key matches a `streamingUrl` available on the item (via `video.streamingUrl`), play via `useVideoPlayerContext`. Otherwise fallback to `router.push('/experience/<slug>')`. Implementer spot-checks real CMS content to pick the right default (see Deferred questions).
- Return `null` when `items` is empty.

**Patterns to follow:**

- `apps/mobile-v2/src/components/sections/MediaCollectionRenderer.tsx` (card composition, badge, gradient).
- `apps/tv/src/components/sections/VideoCardRenderer.tsx` (nav/playback pattern).

**Test scenarios:**

- Happy path — N items render with correct labels, titles, and badges when `collectionSize` set.
- Happy path — Select on an item with a playable `streamingUrl` triggers `playVideo`.
- Happy path — Select on an item without a `streamingUrl` routes to `/experience/<slug>`.
- Edge case — `items` empty → returns null.
- Edge case — `categoryLabel`, `mcTitle`, `mcSubtitle` all null → heading region is empty but rail still renders.
- Edge case — `collectionSize` null → badge is not rendered.
- Focus — rail traps focus correctly via `TVFocusGuideView`.

**Verification:**

- Real Experience containing a `mediaCollection` renders recognizably, focusable, and Select lands on a valid destination.

---

- [ ] **Unit 8: Wire renderers into `SectionDispatcher`**

**Goal:** Register every new renderer so the six block kinds stop falling through to `PlaceholderRenderer`.

**Requirements:** R1.

**Dependencies:** Units 2–7.

**Files:**

- Modify: `apps/tv/src/components/sections/SectionDispatcher.tsx`
- Create: `apps/tv/src/components/sections/SectionDispatcher.test.tsx`

**Approach:**

- Import the six new renderers.
- Add `case` arms for `easterDates`, `relatedQuestions`, `quizButton`, `navigationCarousel`, `videoCarousel`, `mediaCollection`.
- Keep the `default` arm pointing at `PlaceholderRenderer` for forward compatibility.
- No changes to the function signature or prop shape.

**Patterns to follow:**

- Existing `SectionDispatcher.tsx` structure.
- `apps/mobile-v2/src/components/sections/SectionDispatcher.tsx` for arm ordering (though TV does not need the mobile `asVideoCard` branch).

**Test scenarios:**

- Happy path — a section with `kind: "easterDates"` routes to `EasterDatesRenderer` (asserted via a simple mock or render-and-find-by-testID).
- Happy path — one assertion per new `kind` → corresponding renderer.
- Edge case — a section with an unknown `kind` (e.g., `promoBanner` which has no TV renderer yet) still routes to `PlaceholderRenderer` and logs the dev warning.

**Verification:**

- Grepping `[TV] Unhandled block type: easterDates` (or any of the other five kinds) against a dev-mode run of a real Experience returns no hits.

---

- [ ] **Unit 9: Manual QA on both TV platforms**

**Goal:** Validate focus navigation, visual fidelity, and destination correctness on tvOS and Android TV against a real Experience that exercises all six new block kinds.

**Requirements:** R1, R2, R3, R4, R5, R6.

**Dependencies:** Units 1–8.

**Files:**

- None (manual QA). Consider capturing a short demo reel per `compound-engineering:ce-demo-reel` skill and attaching to the PR.

**Approach:**

- Find or ask for an Experience in the CMS that contains all six block kinds. If none exists, use two Experiences that collectively cover all six.
- Rebuild with `EXPO_TV=1 npx expo prebuild --clean`, then run on an Apple TV simulator and an Android TV emulator.
- Walk the Experience with the remote. Verify: (a) each block renders visibly, (b) D-pad reaches every focusable element without dead zones, (c) Select on each interactive element lands on the correct target, (d) Menu/Back returns appropriately, (e) Crimson focus ring is visible on every focusable item, (f) text is legible from ~3 metres at standard simulator scale.
- Specifically on tvOS: confirm the QuizButton opens the QR-code modal (not a crash).
- Specifically on Android TV: confirm the QuizButton's WebView loads `nextstep.is` correctly and navigation is restricted to the allowlist.

**Test scenarios:**

- Test expectation: manual QA. Script each of the six renderers as a focus-path walk + Select destination check, and check off in the PR description.

**Verification:**

- No dev-console warnings of the form `[TV] Unhandled block type:` for the six kinds.
- All focus paths land; no element is focusable-but-invisible.
- Screenshots of each renderer on both platforms attached to the PR.

## System-Wide Impact

- **Interaction graph:** New renderers mount inside the existing `experience/[slug].tsx` `ScrollView`. No changes to `HomeScreen`, `VideoPlayerContext`, or `ExperienceProvider`. Only `SectionDispatcher` gains switch arms.
- **Error propagation:** Each renderer returns `null` on empty / invalid data, matching the existing quiet-failure convention (see `BibleQuotesCarouselRenderer`, `VideoCardRenderer`). No thrown exceptions; no user-visible error states introduced.
- **State lifecycle risks:** `RelatedQuestionsRenderer` holds local expanded state; `QuizButtonRenderer` holds modal state. Both are unmounted when the user leaves the Experience detail screen — no leak risk. `LayoutAnimation` on Android needs `UIManager.setLayoutAnimationEnabledExperimental(true)` (per React Native docs) — set once at module load in `RelatedQuestionsRenderer`.
- **API surface parity:** `SectionDispatcher`'s public shape (a single `section` prop) is unchanged.
- **Integration coverage:** Unit 9's manual QA on both tvOS and Android TV is the only way to prove WebView / QR-code branching and focus navigation together. Component tests prove rendering logic but not D-pad behaviour.
- **Unchanged invariants:** Home screen composition (`apps/tv/app/index.tsx`) is not touched. The normalizer (`apps/tv/src/lib/normalizer.ts`) is not touched. GraphQL queries (`apps/tv/src/lib/queries.ts`) are not touched.

## Risks & Dependencies

| Risk                                                                 | Mitigation                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native-qrcode-svg` fails to build on tvOS.                    | Unit 1 includes a smoke prebuild. If it fails, substitute `qrcode-svg` (pure JS, rendered via `react-native-svg` `<Path>`), which has no native code at all.                                                                  |
| Card widths tuned for phone look wrong at 4K TV distance.            | Unit 9 visual QA catches this; widths are deliberately listed as Deferred-to-Implementation so the implementer tunes them during the build.                                                                                   |
| `mediaCollection` destination routing is wrong on real content.      | Unit 7 defers the choice and falls back to `/experience/<slug>` which is always valid.                                                                                                                                        |
| Menu/Back on tvOS does not dismiss the QuizButton QR modal.          | `Modal`'s `onRequestClose` handles hardware back on Android. For tvOS, add an explicit `TVEventHandler` listening for `menu` if default `Modal` behaviour proves insufficient (standard pattern). Unit 9 manual QA validates. |
| `LayoutAnimation` flicker on Android during RelatedQuestions expand. | Standard mitigation: enable experimental flag at module load; if it still flickers, fall back to a `Animated.timing` on a height-measuring container.                                                                         |

## Documentation / Operational Notes

- Update `apps/tv/CLAUDE.md` only if a new convention emerges during implementation (e.g., "TV carousels use `BibleQuotesCarouselRenderer` as the canonical pattern"). This is worth adding if it solidifies during Unit 5.
- Consider a `docs/solutions/ui-bugs/` entry if the tvOS-WebView fallback (QR modal) proves tricky to land; the finding generalizes beyond this feature.
- PR description should include a platform coverage matrix (six kinds × two platforms = 12 checkmarks) and at least one screenshot per new renderer.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-14-tv-sdui-renderer-parity-requirements.md`
- Related code: `apps/tv/src/components/sections/`, `apps/mobile-v2/src/components/sections/`, `apps/tv/src/lib/normalizer.ts`, `apps/tv/src/lib/queries.ts`
- Related prior work: `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md`, `docs/plans/2026-04-13-001-feat-tv-app-prototype-plan.md`
- Related solutions: `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md`, `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md`, `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`
