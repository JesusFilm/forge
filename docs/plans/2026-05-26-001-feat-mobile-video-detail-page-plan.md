---
title: "feat: Add dedicated video detail page for search results"
status: active
origin: docs/brainstorms/2026-05-26-mobile-video-detail-page-requirements.md
created: 2026-05-26
---

# feat: Add dedicated video detail page for search results

## Summary

Add a new route at `app/watch/[slug].tsx` that renders a full video detail page when a user taps a video from the Discover tab's search results. The page fetches its own data via a new `videoBySlug` GraphQL query (independent of the Experience context) and renders a cinematic player-first detail screen matching the Stitch "Video Detail - Final Iteration" design. Existing routes (`app/video/[sectionKey].tsx`, `app/collection/[sectionKey].tsx`) and experience rendering are untouched.

---

## Problem Frame

Search result videos are standalone — they don't belong to an experience context. The existing `app/video/[sectionKey].tsx` route depends on the `ExperienceProvider` block index to resolve its data. When a user discovers a video through search, there is no experience context to draw from, so the video needs its own data fetching and a dedicated detail screen.

(see origin: `docs/brainstorms/2026-05-26-mobile-video-detail-page-requirements.md`)

---

## Scope Boundaries

### In Scope

- New route `app/watch/[slug].tsx` reachable from search results
- New GraphQL query using `videoBySlug` from admin
- Video normalizer to flatten admin's nested response
- Player with poster, custom controls, fullscreen landscape, PiP mini player bar
- Metadata bar with category label, title, subtitle, action row
- Up Next sibling carousel (reusing carousel patterns)
- Description with collapse/expand
- Study questions accordion (reusing `RelatedQuestionsRenderer`)
- Bible quotes cards (reusing `BibleQuotesCarouselRenderer`)
- Action modals: Download, Language, Subtitles, Share
- Search result routing change to direct videos to new route

### Out of Scope

- Offline download storage and playback
- Custom subtitle rendering overlay (use expo-video's native captions if available)
- Changes to `app/video/[sectionKey].tsx` or experience rendering
- Changes to `apps/admin/` (admin schema already has everything needed)

### Deferred to Follow-Up Work

- Prisma `Video.parents`/`Video.children` relation inversion fix (admin-owned; this plan uses defensive filtering)
- Deep linking into `app/watch/[slug]` from external URLs
- Recommendations via `sceneRecommendations` query (use parent's children for now)

---

## Key Technical Decisions

1. **Independent data layer, not Experience-bound.** The new page uses Apollo `useQuery` with a new `GET_VIDEO_BY_SLUG` query. It does not depend on `ExperienceProvider`, `ExperienceShell`, or the block index. This keeps it decoupled from the home tab's SDUI pipeline.

2. **Reuse existing renderers.** `RelatedQuestionsRenderer`, `BibleQuotesCarouselRenderer`, and carousel/accordion patterns are reused directly. They already accept an `AdminBlock`-shaped prop — the normalizer will produce compatible shapes.

3. **Normalizer produces renderer-compatible shapes.** The video normalizer transforms admin's nested `Video` response into flat objects that match the `AdminBlock` interface renderers expect (`{ __typename, heading, questions, quotes, ... }`). This avoids forking or modifying the existing renderers.

4. **Defensive sibling filtering.** Due to the known Prisma relation inversion (`Video.children` returns rows where the video is the child, not its actual children), the sibling carousel applies dedup-by-documentId + self-ref filtering — matching web's workaround in `content.ts`.

5. **PiP as bottom bar, not floating overlay.** Android's `VideoView` renders above all RN Views regardless of zIndex. The PiP mini player is implemented as a fixed bottom bar (thumbnail + title + play/pause) rather than a floating corner overlay, avoiding the z-order constraint entirely.

6. **Player source via `useRef`, not state.** Per institutional learning, the initial streaming URL is stored in a ref and passed to `useVideoPlayer()`. Source changes use `player.replaceAsync()` to reuse the decoder slot. This prevents decoder slot exhaustion on Android (3-5 hardware slots).

---

## Implementation Units

### U1. GraphQL query and video normalizer

**Goal:** Fetch a single video by slug with all fields needed for the detail page and normalize the response into consumer-friendly types.

**Requirements:** Data layer section of origin — all required fields (title, description, label, images, parents, children, variants, studyQuestions, bibleCitations)

**Dependencies:** None

**Files:**

- `apps/mobile/src/lib/queries.ts` — add `GET_VIDEO_BY_SLUG` query and `WatchVideoFragment`
- `apps/mobile/src/lib/normalizeVideo.ts` — new normalizer
- `apps/mobile/src/lib/normalizeVideo.test.ts` — tests

**Approach:**

- Define a `WatchVideoFragment` using `adminGraphql()` from `@forge/admin-graphql`, modeled on web's `watchVideoFragment` at `apps/web/src/lib/fragments/watch-video.ts`
- Query uses `videoBySlug(slug: $slug)` — already available in admin schema
- Normalizer transforms nested response into a flat `WatchVideoRecord` type with: `title`, `description`, `label`, `posterUrl`, `streamingUrl`, `muxPlaybackId`, `siblings[]`, `variants[]`, `studyQuestions[]`, `bibleCitations[]`
- Siblings derived from `parents[0].parent.children` with dedup-by-documentId and self-ref filtering (matching web's workaround for the Prisma relation inversion)
- Use `pickLocalizedName()` for locale-mapped JSON fields (title, description, book names)
- Anchor consumer types to `AdminFragmentOf<typeof WatchVideoFragment>` to prevent cast drift

**Patterns to follow:**

- Web's `watchVideoFragment` at `apps/web/src/lib/fragments/watch-video.ts` for field selection
- Web's normalizer at `apps/web/src/lib/content.ts` (lines 340-660) for transformation shape
- Existing query patterns in `apps/mobile/src/lib/queries.ts`

**Test scenarios:**

- Given a valid video response with all fields populated, normalizer produces a complete `WatchVideoRecord` with correct title, description, label, posterUrl, streamingUrl
- Given a video with multiple parents, normalizer uses the first parent's children as siblings
- Given siblings that include self-references, normalizer filters them out
- Given duplicate siblings (same documentId), normalizer deduplicates
- Given a video with no parents (orphan), siblings array is empty
- Given missing/null fields (no studyQuestions, no bibleCitations, no description), normalizer returns empty arrays and null strings without throwing
- Given variants with downloads, normalizer preserves download quality, size, and URL for each

**Verification:** Unit tests pass. Query can be tested against local admin at `127.0.0.1:4000/api/graphql` with a known video slug.

---

### U2. Route registration and page scaffold

**Goal:** Register the new `app/watch/[slug].tsx` stack screen and wire up the basic page structure with data fetching.

**Requirements:** New route reachable from search results, stack screen with back navigation

**Dependencies:** U1

**Files:**

- `apps/mobile/app/watch/[slug].tsx` — new route file
- `apps/mobile/app/_layout.tsx` — register stack screen

**Approach:**

- Add `<Stack.Screen name="watch/[slug]">` in `_layout.tsx` with the same header pattern as `video/[sectionKey]` and `collection/[sectionKey]`: `headerShown: true`, `headerTintColor: ACCENT`, `headerTitle: ""`, `headerStyle: { backgroundColor: BG_COLOR }`, `headerShadowVisible: false`, custom `headerLeft` back chevron
- Route component extracts `slug` from `useLocalSearchParams()`, decodes with `decodeURIComponent()`
- Uses Apollo `useQuery(GET_VIDEO_BY_SLUG, { variables: { slug } })` for data fetching
- Renders loading state (skeleton or spinner), error state (reusing `text.errorTitle` / `text.errorMessage` patterns), and the content layout
- Content is a `ScrollView` (not FlashList — the section count is fixed and small) with the player at top and sections below
- Passes normalized data down to child sections

**Patterns to follow:**

- `app/video/[sectionKey].tsx` for overall route structure (outer component + inner content)
- `app/_layout.tsx` for stack screen registration pattern
- `layout.screenContainer` from shared styles for the root container

**Test scenarios:**

- Given a valid slug, the page renders without crashing and shows the video title
- Given an invalid slug (query returns null), the page shows an error state
- Given a loading state, the page shows a loading indicator
- Stack header shows back chevron in accent color, empty title, dark background

**Verification:** Navigation from search results reaches the page. Back button returns to search. Loading, error, and success states render correctly.

---

### U3. Video player with custom controls

**Goal:** Render the video player with poster thumbnail, custom overlay controls, fullscreen landscape rotation, and playback lifecycle management.

**Requirements:** Video Player Zone from origin — 16:9 player, custom controls (play/pause, progress, volume, CC, fullscreen), fullscreen with landscape, poster before playback

**Dependencies:** U2

**Files:**

- `apps/mobile/src/components/watch/VideoPlayer.tsx` — new player component
- `apps/mobile/src/components/watch/PlayerControls.tsx` — custom control overlay

**Approach:**

- Player uses `useVideoPlayer(streamingUrl, config)` with `useRef` for the initial source (per learning: never pass state to `useVideoPlayer`)
- `VideoView` with `contentFit="cover"`, `nativeControls={false}`, `allowsFullscreen={true}`, `allowsPictureInPicture={true}`
- Poster image via `expo-image` overlaid on the player, hidden once `hasStarted` becomes true (same pattern as `VideoHeroRenderer`)
- Custom `PlayerControls` overlay: play/pause circle (48px, `rgba(0,0,0,0.5)` bg), thin progress bar (accent track), timestamps, volume toggle, CC toggle, fullscreen button
- Fullscreen button calls `player.enterFullscreen()` or uses `expo-screen-orientation` to lock to landscape
- Pause on navigation blur via `navigation.addListener("blur")`
- AppState listener with `wasPlayingRef` guard for background/foreground transitions
- Defensive `player.pause()` in cleanup effect with try-catch (player may already be released)

**Patterns to follow:**

- `app/video/[sectionKey].tsx` for `useVideoPlayer` setup, `useEvent` for `playingChange`, AppState handling
- `VideoHeroRenderer.tsx` for poster → video transition pattern
- Learning: playlist-video-player-sdui-mobile for `replaceAsync` and decoder slot discipline

**Test scenarios:**

- Player renders with poster image before playback starts
- Tapping play starts playback and hides poster
- Progress bar reflects current playback position
- Tapping fullscreen enters landscape mode
- Navigating away pauses playback
- Returning from background resumes only if was playing before
- Player cleanup on unmount does not throw

**Verification:** Video plays from a Mux HLS URL. Controls respond to taps. Fullscreen rotates to landscape. Navigating away and returning handles state correctly.

---

### U4. PiP mini player bar

**Goal:** Show a mini player bar at the bottom of the screen when the user scrolls past the main player.

**Requirements:** Mini Player Bar from origin — appears on scroll-past, thumbnail + title + play/pause, tapping scrolls back to player

**Dependencies:** U3

**Files:**

- `apps/mobile/src/components/watch/MiniPlayerBar.tsx` — new component
- `apps/mobile/app/watch/[slug].tsx` — scroll tracking integration

**Approach:**

- Bottom bar (not floating overlay) to avoid Android VideoView z-order issues
- Bar is absolutely positioned at the bottom of the screen, above safe area inset
- Contains: 40px thumbnail (6px radius, `expo-image`), title in `bodySmall` cream white, play/pause icon button
- Visibility driven by scroll position: the `ScrollView`'s `onScroll` callback tracks whether the player area (first ~220px) has scrolled off screen
- When visible, bar animates in with `Animated.timing` (opacity + translateY, 200ms)
- Tapping the bar calls `scrollViewRef.current.scrollTo({ y: 0, animated: true })`
- Play/pause button mirrors the main player's state

**Patterns to follow:**

- `CuratedHomeLayout.tsx` for scroll-driven state (heroBlurOpacity, titleOpacity)
- `SURFACE_COLOR` for bar background, `HORIZONTAL_PADDING` for internal padding

**Test scenarios:**

- Mini player bar is hidden when the main player is visible in viewport
- Scrolling past the player shows the mini player bar with animation
- Mini player displays correct thumbnail and title
- Tapping the bar scrolls back to the top (main player visible)
- Play/pause on mini player toggles playback

**Verification:** Scroll down to see the bar appear. Scroll up to see it disappear. Tap to return to player.

---

### U5. Metadata bar and action button row

**Goal:** Render the video metadata (category label, title, subtitle) and the row of four action buttons below the player.

**Requirements:** Video Metadata Bar from origin — uppercase label, bold title, subtitle, action row (Download, Language, Subtitles, Share)

**Dependencies:** U2

**Files:**

- `apps/mobile/src/components/watch/VideoMetadata.tsx` — new component
- `apps/mobile/src/components/watch/ActionButtonRow.tsx` — new component

**Approach:**

- `VideoMetadata` renders: uppercase `label` in `TEXT_SECONDARY` with `letterSpacing: 2`, title in `text.sectionHeading` + `typography.titleLarge`, subtitle in `text.sectionSubtitle` + `typography.bodySmall`
- `ActionButtonRow` renders 4 evenly-spaced vertical stacks (icon above label): Download (arrow-down), Language (globe), Subtitles (CC), Share (share-outline) — all using `Ionicons` in `TEXT_SECONDARY`
- Each button is a `Pressable` with `button.iconButton44` dimensions, `feedback.pressed` on press
- Button press opens the corresponding modal (U8) or native share sheet

**Patterns to follow:**

- `text.sectionHeading`, `text.sectionSubtitle` from `styles/shared.ts`
- `button.iconButton44` for icon button sizing
- `BibleQuotesCarouselRenderer` header row for heading + trailing action layout

**Test scenarios:**

- Label renders in uppercase with letter-spacing
- Title and subtitle render with correct typography tokens
- All four action buttons are visible and evenly spaced
- Each button meets 48px minimum touch target
- Pressing Share opens the native share sheet

**Verification:** Metadata section matches the Stitch design layout. Buttons respond to press.

---

### U6. Up Next sibling carousel

**Goal:** Render a horizontal carousel of sibling videos with "Playing" badge on the current video.

**Requirements:** Up Next Carousel from origin — 16:9 cards, 45% width, "Playing" badge, tapping switches video

**Dependencies:** U1, U2

**Files:**

- `apps/mobile/src/components/watch/UpNextCarousel.tsx` — new component

**Approach:**

- Section heading "Up Next" using `text.sectionHeadingPadded` + `typography.heading`
- `FlatList` with `horizontal`, `snapToInterval`, `decelerationRate="fast"`, `contentContainerStyle={carousel.listContent}`
- Card width = `Math.round(screenWidth * 0.45)`, aspect ratio 16:9, `card.surface` base style with 12px radius
- Each card: `expo-image` thumbnail with `LinearGradient` scrim, bold white title at bottom (same pattern as `VideoCarouselRenderer`)
- Current video card shows an accent-colored "Playing" pill badge (8px radius, `ACCENT` bg, caption white text)
- Tapping a sibling card calls `router.replace(`/watch/${encodeURIComponent(sibling.slug)}`)` to swap the video without pushing a new screen
- If no siblings exist, section is hidden

**Patterns to follow:**

- `VideoCarouselRenderer.tsx` for carousel card layout, gradient scrim, snap behavior
- `carousel.listContent`, `CARD_GAP`, `HORIZONTAL_PADDING` from shared styles
- `card.surface` for card base style

**Test scenarios:**

- Carousel renders sibling videos with thumbnails and titles
- Current video shows "Playing" badge
- Tapping a sibling navigates to that video's slug (route replaces, not pushes)
- Carousel is hidden when there are no siblings
- Cards snap to alignment on scroll

**Verification:** Sibling thumbnails render. Badge appears on current. Tapping switches the video content.

---

### U7. Description, study questions, and bible quotes sections

**Goal:** Render the three supplementary content sections below the carousel, reusing existing renderers where possible.

**Requirements:** Description, Study Questions Accordion, Scripture References from origin

**Dependencies:** U1, U2

**Files:**

- `apps/mobile/src/components/watch/VideoDescription.tsx` — new (simple, small)
- `apps/mobile/app/watch/[slug].tsx` — compose sections

**Approach:**

**Description:** New `VideoDescription` component. Heading "About This Video" in `text.sectionHeadingPadded`. Body text in `TEXT_BODY` with 3-line `numberOfLines` collapse and "Read more" / "Show less" toggle using `text.accentLinkText`. Same expand/collapse pattern as `TextRenderer.tsx`.

**Study Questions:** Reuse `RelatedQuestionsRenderer` directly. The normalizer (U1) produces a block-compatible shape: `{ __typename: "RelatedQuestionsBlock", heading: "Study Questions", questions: [...], ctaLabel: "Ask Your Own Question", ctaLink: null }`. Pass this directly as the `section` prop.

**Bible Quotes:** Reuse `BibleQuotesCarouselRenderer` directly. The normalizer produces: `{ __typename: "BibleQuotesCarouselBlock", heading: "Scripture References", quotes: [...] }`. Each quote maps `bibleCitation` fields to `{ reference, text, attribution, imageUrl }`. Verse text is rendered from the citation's text content (fetched from admin, not a third-party bible API — unlike web, which fetches from wldeh/bible-api).

**Patterns to follow:**

- `TextRenderer.tsx` for description collapse/expand pattern
- `RelatedQuestionsRenderer.tsx` — reused as-is
- `BibleQuotesCarouselRenderer.tsx` — reused as-is

**Test scenarios:**

- Description renders with 3-line clamp and "Read more" toggle
- Tapping "Read more" expands full text; "Show less" collapses
- Study questions section renders when questions exist, hidden when empty
- Study question accordion expands/collapses on tap with chevron animation
- Bible quotes section renders when citations exist, hidden when empty
- Bible quote card shows reference, attribution, and italic quote text
- Pagination dots reflect the number of citations

**Verification:** All three sections render with correct content. Expand/collapse works. Empty states are gracefully hidden.

---

### U8. Action modals (Download, Language/Subtitles, Share)

**Goal:** Implement bottom-sheet modals matching the web app's video detail modals (`DownloadModal`, `LanguagePickerModal`, `ShareModal`) — same information architecture and functionality, adapted for mobile touch UX.

**Requirements:** Action Modals from origin — download quality picker, language variant picker with subtitle sub-picker, share with copy-to-clipboard. Web modal sources: `apps/web/src/app/[slug]/[locale]/components/watch/DownloadModal.tsx`, `LanguagePickerModal.tsx`, `ShareModal.tsx`

**Dependencies:** U1, U5

**Files:**

- `apps/mobile/src/components/watch/DownloadModal.tsx` — new
- `apps/mobile/src/components/watch/LanguageSubtitleModal.tsx` — new (combines web's Language + Subtitle into one modal, matching web's LanguagePickerModal which already nests both)
- `apps/mobile/src/components/watch/ShareModal.tsx` — new

**Approach:**

All modals use React Native `Modal` with `animationType="slide"`, `transparent`, matching `QuizButtonRenderer`'s `QuizModal` pattern. Dark overlay (`rgba(0,0,0,0.9)`), close button top-right (48px circle, `rgba(255,255,255,0.15)` bg), safe-area-aware via `useSafeAreaInsets()`.

**Download Modal** (mirrors web's `DownloadModal`):

- Header section: poster thumbnail (16:9, left-aligned) with duration badge overlay (play icon + formatted duration), video title (bold, `titleLarge`), language pill (globe icon + language name, rounded border `SURFACE_COLOR` bg)
- Quality selector: label "Select a file size", dropdown-style picker listing quality tiers (Highest/High/Low) with file size in parentheses. Selected tier highlighted with `ACCENT` bg. On mobile, use a scrollable `FlatList` of rows instead of a dropdown since dropdowns are cumbersome on touch
- Downloads sorted by size, bucketed into up to 3 tiers matching web's tier logic
- Terms of Use checkbox: round checkbox + "I agree to the Terms of Use" text. ToU link opens a nested modal with scrollable terms paragraphs and Accept/Cancel footer
- Download button: `ACCENT` bg, disabled until ToU accepted. Triggers `Linking.openURL(downloadUrl)` (no offline storage)
- Empty state: "No downloads are available for this video" message when downloads array is empty
- `downloadInFlight` ref guard prevents double-tap downloads

**Language/Subtitle Modal** (mirrors web's `LanguagePickerModal`):

- Uses draft state pattern: `draftSlug`, `draftSubtitleEnabled`, `draftSubtitleSlug` — changes are staged, not applied until "Apply" is tapped. Closing without applying discards changes
- Language section: heading "Language" with count badge "(X languages)" in `TEXT_SECONDARY`. Scrollable list of published variants showing `language.name` (or `nativeName` if different). Active variant highlighted with accent indicator. Each row is a `Pressable` with `feedback.pressed`
- Subtitle section (conditional, only if subtitles exist): heading "Subtitles" with on/off `Switch` toggle + count badge. When enabled, scrollable list of subtitle languages. When disabled, list has reduced opacity and `pointerEvents: "none"`. Hairline divider separating from language section
- Footer: "Close" ghost button (left) + "Apply" accent button (right). Apply disabled when `!isDirty` (no changes from current state)
- Applying language change calls `player.replaceAsync(newHlsUrl)` to switch dub without rebuilding the player
- Draft state resets to current values when modal opens

**Share Modal** (mirrors web's `ShareModal`):

- Preview card: poster thumbnail (16:9) + video title (bold) + description (3-line clamp, `TEXT_BODY`)
- Social share row: Facebook button (`#1877F2` bg) + X/Twitter button (`#000` bg), each 48px touch target with brand icons
- Shareable URL section: read-only text input showing the canonical video URL (`origin/watch/{slug}/{languageSlug}`), selectable on tap
- Copy button: `ACCENT` pill button with copy icon. Uses `Clipboard.setStringAsync()` from `expo-clipboard`. Shows "Copied!" status for 2 seconds, then resets. Falls back to `Share.share()` if clipboard unavailable
- On mobile, skip the Embed Code tab (iframe embeds are not useful on mobile devices)

**Patterns to follow:**

- `QuizButtonRenderer.tsx` `QuizModal` for modal structure, overlay, close button, safe-area positioning
- Web's `DownloadModal.tsx` for quality tier bucketing logic and ToU flow
- Web's `LanguagePickerModal.tsx` for draft state pattern and dirty-tracking
- Web's `ShareModal.tsx` for preview card layout and social button row
- `feedback.pressed` for row press states
- `text.sectionHeading`, `TEXT_PRIMARY`, `TEXT_SECONDARY`, `SURFACE_COLOR` for typography and surfaces

**Test scenarios:**

- Download modal shows poster thumbnail with duration badge, video title, and language pill
- Download modal lists quality tiers with file sizes, sorted descending
- Download modal disables download button until Terms of Use checkbox is accepted
- Download modal shows Terms of Use nested modal on link tap
- Download modal handles video with no downloads (empty state message)
- Download modal prevents double-tap via `downloadInFlight` guard
- Language modal lists all published variants, highlights active one
- Language modal uses draft state — closing without Apply discards changes
- Language modal Apply button disabled when no changes made (dirty tracking)
- Applying language selection changes the player's streaming URL via `replaceAsync`
- Subtitle section shows toggle + language list when subtitles exist
- Subtitle section hidden when no subtitles available
- Disabling subtitles dims the subtitle language list
- Share modal shows video preview card with thumbnail, title, description
- Share modal social buttons open Facebook/X share intents
- Share modal copy button copies URL to clipboard and shows "Copied!" feedback
- All modals open and close correctly with slide animation
- Close button and backdrop tap dismiss all modals

**Verification:** Each modal opens from its action button, displays data matching the web modal's layout, and its primary action works. Download triggers browser open. Language switch changes audio. Share copies URL.

---

### U9. Search result routing

**Goal:** Route video search results to the new `app/watch/[slug]` page instead of the home tab.

**Requirements:** Search Result Routing from origin — update `SearchResultCard.onSelect` handler

**Dependencies:** U2

**Files:**

- `apps/mobile/app/(tabs)/watch.tsx` — update `handleSelectResult`

**Approach:**

- Current behavior: `handleSelectResult` calls `selectExperience(slug)` + `router.navigate("/(tabs)")` for all results
- New behavior: check the search result type. If the result is a video (not an experience), navigate to `/watch/${encodeURIComponent(slug)}`. If it's an experience, keep the current behavior
- The `SearchResult` type from the search query includes a `type` field or `__typename` that distinguishes videos from experiences. Inspect the actual response shape to determine the discriminator
- `SearchResultCard` component itself is unchanged — only the `onSelect` handler in `watch.tsx` changes

**Patterns to follow:**

- Existing `router.push()` calls in `VideoCardRenderer` and `VideoHeroRenderer` for navigation pattern
- `encodeURIComponent()` for slug encoding (per learning: Expo Router slashes in dynamic params)

**Test scenarios:**

- Tapping a video search result navigates to `app/watch/[slug]`
- Tapping an experience search result still navigates to the home tab (existing behavior preserved)
- Slug with special characters (slashes, unicode) is correctly encoded/decoded

**Verification:** Search for a known video, tap it, and land on the new video detail page. Search for an experience and confirm it still goes to home.

---

## System-Wide Impact

- **Navigation graph:** New stack screen `watch/[slug]` added. No existing routes affected.
- **Data layer:** New GraphQL query added to `queries.ts`. No changes to existing queries, fragments, or the Experience data pipeline.
- **Bundle size:** New components add ~8 files. All existing renderers are reused, not duplicated.
- **Search results:** Routing change in `watch.tsx` is the only modification to existing code outside of `_layout.tsx`.

---

## Risks

1. **Admin `videoBySlug` may not return all needed fields for study questions / bible citations.** Mitigation: web already uses these fields successfully; verify with a test query against local admin before building the normalizer.
2. **expo-video PiP support varies by OS version.** Mitigation: PiP is a progressive enhancement; the mini player bar works as a fallback on devices where native PiP is unavailable.
3. **Prisma relation inversion may cause empty or self-referencing sibling carousel.** Mitigation: defensive dedup + self-ref filtering in normalizer (matching web's approach).

---

## Deferred Implementation Notes

- Exact normalizer field mapping will be finalized when reading the actual admin response shape from a test query
- Subtitle rendering method (native expo-video captions vs custom overlay) depends on expo-video 3.x support — check at implementation time
- `sceneRecommendations` query for AI-powered "Up Next" suggestions can replace parent-children siblings in a follow-up
