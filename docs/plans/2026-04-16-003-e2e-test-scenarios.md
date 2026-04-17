# Comprehensive E2E Test Scenarios

Companion to `docs/plans/2026-04-16-003-feat-cross-platform-local-qa-pipeline-plan.md`.
This document lists every testable interaction across all 3 apps and 5 surfaces.

## Summary

| App       | Playwright/Maestro/YAML flows | Individual scenarios | Surfaces         |
| --------- | ----------------------------- | -------------------- | ---------------- |
| web       | ~45 flows                     | ~200 scenarios       | browser          |
| mobile    | ~55 flows                     | ~400 scenarios       | iOS, Android     |
| tv        | ~35 flows                     | ~150 scenarios       | tvOS, Android TV |
| **Total** | **~135 flows**                | **~750 scenarios**   | **5 surfaces**   |

## Web (Playwright) — ~45 flows, ~200 scenarios

### Navigation & Header (4 flows)

- Logo click → home navigation
- Search toggle → overlay opens with animation
- Search overlay close via X button
- Search overlay close via Escape key

### Search Overlay (14 flows)

- Empty overlay initial state (input focused, no results)
- Type query with 300ms debounce → results load
- Loading skeleton display (after 500ms delay)
- Rapid query changes → only latest result shown (requestId cancellation)
- Search results animate in with staggered card-enter animation
- No results state ("No results for 'query'")
- Search error state with Retry button
- Load more results (pagination, offset incremented)
- Load more error + retry
- Click result card → navigate to watch page, overlay closes
- Tab focus trap (forward wrap, backward wrap)
- Body scroll lock while overlay open
- Long query truncation (200 char limit)
- Special characters in search query

### Search Page /search (9 flows)

- Load with query parameter (?q=Jesus) → results shown
- Load without query → empty state icon
- Search input debounce → URL updates via router.replace
- Clear search input → results cleared
- Infinite scroll / load more button
- Empty results state
- Loading skeleton on page
- Error display with retry
- Page metadata title ("Search: query")

### Video Player (14 flows)

- Play video (click play button)
- Pause video
- Seek via progress bar click (50% position)
- Seek via slider drag
- Time display accuracy (formatted "1:30 / total")
- Mute toggle (large center icon appears)
- Unmute toggle (icon disappears)
- Mute state persistence across pause/play
- Fullscreen enter
- Fullscreen exit
- Poster/thumbnail display before play
- Autoplay on viewport scroll (Video section)
- Progress slider keyboard interaction (arrow keys)
- Spacebar play/pause toggle

### Carousel Video Player (9 flows)

- Thumbnail card selection → main player updates
- Thumbnail keyboard (Enter) selection
- Carousel horizontal drag/swipe
- Main player controls (play/pause/mute/seek/fullscreen)
- Play on video change (auto-play when switching)
- Title, subtitle, description display
- Description first-4-words bold formatting
- Desktop navigation arrows (hover, md+ only)
- Hover play indicator on thumbnail

### Navigation Carousel (8 flows)

- Item click → smooth scroll to data-section-key
- Item keyboard activation (Enter/Space)
- Carousel drag/swipe
- Item image display with mask gradient
- Item title and category labels
- First item image optimization (Image vs img)
- Background color support
- Smooth scroll behavior verification

### Bible Quotes Carousel (9 flows)

- Carousel horizontal navigation
- Quote card display (reference, text, image, bg color)
- Free resource card with CTA button
- Resource CTA click → new tab
- Share button → native share API or clipboard fallback
- Share URL format (utm_source=share)
- Image mask gradient display
- Background color on quote cards
- Carousel drag behavior

### Media Collection (10 flows)

- Item hover → background image change (onBackgroundImageChange)
- Image scale 105% on hover
- Item click → navigate to /watch/[slug]
- Item without slug → not clickable (div, pointer-events-none)
- Carousel drag
- CTA "Watch" button click
- Title, subtitle, description display
- Footer text display
- Collection size badge (top-right)
- Label display (lowercase formatted)

### Related Questions Accordion (10 flows)

- Question expand (arrow rotates 180deg)
- Question collapse
- Only one open at a time (controlled)
- Keyboard navigation (Enter toggle)
- Hover state (bg-white/5, underline)
- Markdown content in answers (lists rendered)
- Question icon display
- CTA button display and click (new tab)
- Heading display
- Accordion height animation

### Advent Countdown (12 flows)

- Expanded by default on desktop (>=640px)
- Collapsed by default on mobile (<640px)
- Toggle expand/collapse on click
- Responsive resize behavior (media query listener)
- Days count display (calculated from current date)
- Christmas Day state ("Merry Christmas!")
- Singular "1 day" vs plural "X days" label
- Scripture text and reference display
- Year placeholder {year} replacement
- Arrow rotation animation (180deg)
- aria-expanded accessibility
- Multiple days calculation accuracy

### Easter Dates (10 flows)

- Expanded on desktop, collapsed on mobile
- Toggle expand/collapse
- Western Easter date calculation and display
- Orthodox Easter date calculation and display
- Passover date calculation (Hebrew calendar)
- Date format "Day, Month Date, Year"
- Locale-aware date formatting
- Current year calculation
- Year placeholder in title
- Responsive media query behavior

### Quiz Modal (10 flows)

- Button render with gradient mesh background
- Button click → modal dialog opens
- Modal with iframe, loading spinner
- Loading spinner visible during iframe load
- Close button click → modal closes
- Backdrop click → modal closes
- iframe sandbox attributes verification
- iframe title accessibility
- Button text display
- Animated mesh gradient on button

### Video Hero (13 flows)

- Auto-play on page load (muted)
- Pause on scroll down (>100px threshold)
- Resume on scroll up (<50px)
- Mute button toggle
- Unmute resets to start and plays
- Unmute-once flag (only reset first time)
- Heading and subheading display
- CTA button display and click
- RouteVideo vs static URL source selection
- Volume change event handling
- Linear gradient overlay
- Scroll-driven blur/dim effect
- Hero container dimensions

### Section Rendering (18 flows)

- Each of 16 section types renders correctly via SectionDispatcher
- Unknown section type handling (warning in dev, null in prod)
- Error blocks filtered out (\_\_typename === "Error")

### Routes & Page Loading (14 flows)

- Home page / loads with sections
- /watch/[slug] dynamic route
- /watch/[slug]/[locale] localized route
- Locale slug detection (isLocale)
- Empty experience (no blocks) → ExperienceEmpty
- Missing experience (404) → ExperienceEmpty
- Experience error → ExperienceError with message
- Page metadata (title, description, OG tags)
- Page revalidation (60 second ISR)
- Demo recommendations page load
- Demo recommendations locale toggle
- Demo recommendations video not found
- Demo recommendations locale filter (en, es, fr only)
- Loading states (Suspense boundaries)

### Responsive Behavior (9 flows)

- Mobile viewport 320px (single column)
- Tablet viewport 768px (2-column)
- Desktop viewport 1024px+ (multi-column)
- Carousel mobile (no nav arrows) vs desktop (arrows visible)
- Accordion mobile collapsed vs desktop expanded
- Touch interactions on carousel
- Viewport resize reflow
- Image srcset responsive
- Video player responsive sizing

### Keyboard Navigation (8 flows)

- Tab forward through interactive elements
- Shift+Tab backward
- Enter key button activation
- Space key button activation
- Arrow keys in carousels
- Escape key closes modals and overlays
- Focus visible outlines (focus-visible styles)
- Skip to content link (if implemented)

### Error States (11 flows)

- GraphQL connection error
- Missing credentials (401) → friendly message
- Null blocks filtered
- Missing video URL → section returns null
- Invalid locale param → DEFAULT_LOCALE fallback
- Empty search results
- Search rate limited (retryAfterSeconds)
- Malformed search response
- Long query truncation
- Special characters in search
- Missing routeVideo context

### Animations (8 flows)

- Search overlay fade in/out (0.2s)
- Card enter/exit animations (staggered delays)
- Hover scale (1.02) on video cards
- Image zoom 105% on hover (MediaCollection)
- Arrow rotation (accordion)
- Mesh gradient animation (quiz button)
- Accordion height animation
- Loading spinner rotation

---

## Mobile (Maestro) — ~55 flows, ~400 scenarios

### Tab Navigation (18 scenarios)

- Switch between all 4 tabs (Home, Discover, Library, Profile)
- Tab icon states (active #CB333B, inactive #a8a29e)
- Tab background (#1c1917)
- Tab labels display correctly
- Tab label font size: iOS=10px, Android=12px (Platform.select)
- Navigation persistence (tab state preserved on return)
- Back button from detail returns to correct tab

### Home Screen (52 scenarios)

- Loading state (ActivityIndicator "Loading experience...")
- Error state ("Something went wrong" + Retry button)
- Empty state ("No content available")
- Hero video auto-plays muted on load
- Hero video pauses on scroll (>70% of hero height)
- Hero video resumes on scroll up
- Hero dimensions (width=screen, height=screen\*1.2)
- Mute button toggle (volume-mute ↔ volume-high icons)
- Mute state resets on navigation away
- Blur overlay opacity (scroll-driven: iOS BlurView vs Android dark overlay)
- Title pill opacity (scroll-driven fade)
- GlassView header buttons (iOS glass vs Android solid fallback)
- Search button → navigate to Discover
- Profile button → navigate to Profile
- Section rendering in correct order
- Navigation carousel renders at top
- Linear gradient feather below hero
- AppState handling (pause on background, resume on foreground)

### Discover/Search Screen (61 scenarios)

- Search input with placeholder, styling, cursor color
- 300ms debounce on typing
- Rapid typing → only latest query fires
- Skeleton loading after 500ms delay (6 shimmer cards)
- Results animate in (fade + scale, 60ms stagger per card)
- 2-column grid layout
- No results state ("No results for 'query'")
- Error handling (network error, rate limit, service unavailable)
- Retry link on errors
- Pagination / Load more button
- Load more loading state
- Load more error + retry
- Result card tap → selectExperience + navigate to Home
- Result card accessibility label
- Keyboard dismiss on scroll (keyboardDismissMode="on-drag")
- Request cancellation (requestIdRef tracking)
- Clear search → animations, reset to empty state
- Query truncation (MAX_QUERY_LENGTH=200)

### Library Screen (39 scenarios)

- Loading state ("Loading experiences...")
- Error state ("Failed to load experiences" + Try Again)
- Empty state ("No experiences available")
- FlashList renders experience cards
- Card layout: thumbnail 80x80px + content area
- Inactive card (transparent border, no checkmark)
- Active card (ACCENT border, checkmark-circle icon)
- Thumbnail: ogImage or gradient fallback with icon
- Experience selection → selectExperience + navigate Home
- Tap active card → no action
- Cache-and-network fetch policy
- Accessibility labels ("currently active" on selected)

### Video Detail Screen (54 scenarios)

- Route /video/[sectionKey] loads
- sectionKey decoding via parseSectionKey()
- Not found states (invalid key, section not found)
- Header: back button (ACCENT), title, share button
- Share button → native share sheet (iOS vs Android)
- Share message format with URL
- VideoView with native controls, fullscreen, PiP
- Thumbnail overlay with play button (72x72px ACCENT circle)
- Tap thumbnail → play, thumbnail disappears (hasStarted)
- AppState handling (pause on background, resume on foreground)
- Description with "Read more" / "Show less" toggle (3 lines, 120 char threshold)
- Sibling content (related videos, carousels below)
- Current video filtered from siblings
- ScrollView with vertical content

### Collection Player Screen (60 scenarios)

- Route /collection/[sectionKey]?index=N loads
- Player dimensions 16:9 (height = width \* 9/16)
- Only playable items (valid streamingUrl) shown
- Initial index clamped to first playable item
- No playable items → fallback "No playable videos"
- Header section: subtitle, title, description (sticky)
- Playlist FlatList (72px rows, 96x54px thumbnails)
- Active item: "Now playing" badge, accent bar, highlighted bg
- Unplayable items: 0.4 opacity, disabled
- Tap playable item → currentIndex updates
- Auto-advance on video end (playToEnd event)
- Last item loops to first playable
- Source swap (replaceAsync)
- Playlist auto-scroll to active (animated, centered)
- AppState handling + focus blur handling
- iOS pressed opacity vs Android ripple

### Video Hero Renderer (43 scenarios)

- Valid stream → VideoView (muted, loop, auto-play)
- No stream → thumbnail/image fallback
- Mute control synced with parent
- Thumbnail overlay before first play
- Content overlay: heading, subheading (uppercase), CTA button
- CTA button (ACCENT bg, navigate to /video/[key])
- LinearGradient overlay (transparent to BG_COLOR)
- Blur overlay (iOS BlurView vs Android dark overlay)
- AppState handling
- Cleanup on unmount

### Carousels — Video, Media, Bible Quotes, Navigation (80+ scenarios)

- VideoCarousel: horizontal FlatList, 9:16 portrait cards, snap-to-interval, play icon, tap → /collection/[key]
- MediaCollection: 3:4 cards, collection size badge, label/title overlay, tap → /video/[key]
- BibleQuotes: paged carousel, 1:1 square cards, pagination dots, share button, CTA links
- NavigationCarousel: ScrollView, 110x130 cards, category + title, scroll-to-section (TODO)

### Related Questions Accordion (24 scenarios)

- Heading, CTA button in header
- Question rows with chevron animation (90deg rotation)
- Expand/collapse with LayoutAnimation (Android: explicit enable)
- Only one question expanded at a time
- Answer text display
- Accessibility: role="button", expanded state

### Quiz Button + Modal (42 scenarios)

- URL validation (https, nextstep.is domain, no credentials)
- Button with gradient, "QUIZ" badge, label, arrow
- Modal: slide animation, transparent, statusBarTranslucent
- Close button with safe area insets
- WebView: source, originWhitelist, security props (no file access, no third-party cookies, no mixed content)
- WebView states: loading → loaded → errored
- onShouldStartLoadWithRequest validates all navigations
- Android back button → onRequestClose

### Platform-Specific iOS vs Android (22 scenarios)

- Safe area insets (notch, Dynamic Island)
- Tab bar font sizes (iOS=10, Android=12)
- GlassView (iOS only) vs solid bg fallback (Android)
- BlurView (iOS: expo-blur) vs dark overlay (Android)
- Ripple effects (Android) vs opacity fade (iOS)
- Share sheet differences
- Keyboard behavior on dismiss
- LayoutAnimation explicit enable (Android only)

### AppState Lifecycle (13 scenarios)

- Background → all video players pause
- Foreground → resume if was playing (wasPlayingRef)
- Inactive → pause
- Mute state persists across bg/fg
- Screen blur → collection player pauses
- Screen focus → resume based on state
- Hero re-mutes on navigation away

### Error & Edge Cases (20 scenarios)

- Module-level startup error → error screen
- Component error boundary → error page
- Network offline → Apollo error
- Rapid search race conditions (requestId)
- Component unmount timer cleanup
- No playable items in collection
- Single playable item loops
- Memory leak prevention (listener cleanup)

---

## TV (Custom YAML Runner) — ~35 flows, ~150 scenarios

### Home Screen (11 flows)

- Initial load → loading state (ActivityIndicator)
- Success load → HomeHero + ContentRail visible
- Error state → "Something went wrong" + Retry button (SELECT to retry)
- Empty state → "No experiences available"
- HomeHero: Explore button focused by default (hasTVPreferredFocus)
- HomeHero: muted background video auto-plays (or image fallback)
- ContentRail: D-pad DOWN from Explore → first card focused
- ContentRail: D-pad RIGHT through cards (horizontal navigation)
- ContentRail: D-pad UP back to Explore button
- ContentRail: SELECT on card → navigate to experience detail
- ContentRail: focus memory per rail (last focused index stored)

### Experience Detail (5 flows)

- Loading state
- Success: sections render via SectionDispatcher
- Error state with Retry
- Empty content ("No content available")
- BACK/Menu → return to home

### Video Player Overlay (14 flows)

- Open: SELECT on video card → full-screen overlay
- Initial focus on back button (hasTVPreferredFocus one-shot)
- Back button SELECT → dismiss overlay
- Play/pause toggle (center button)
- Seek backward 10s (clamped to 0)
- Seek forward 10s (clamped to duration - 0.5)
- Seek near end (prevents premature playToEnd)
- Progress bar real-time update
- Duration display (initially "--:--", then actual)
- Title and subtitle display
- Auto-dismiss on video completion
- Focus trapping (TVFocusGuideView trapFocus\*)
- Manual dismiss mid-playback
- Focus restoration to originating card after dismiss

### Carousel/Rail Navigation (12 flows)

- VideoCarousel: D-pad RIGHT through cards, SELECT → playVideo()
- VideoCarousel: horizontal auto-scroll at edge
- VideoCarousel: D-pad UP to exit carousel
- MediaCollection: D-pad navigation, dynamic actions (video play, section link, experience nav)
- MediaCollection: thumbnail fallback chain
- ContentRail: focus memory, auto-scroll
- BibleQuotesCarousel: horizontal navigation through quotes
- NavigationCarousel: SELECT → scrollToSection() with 400ms focus anchor delay
- NavigationCarousel: focus anchor targeting (invisible Pressable, 48px, opacity 0)
- Carousel empty items → component returns null
- Cross-experience navigation via MediaCollection item.video.slug
- Section jump navigation (no route change, scroll only)

### Related Questions Accordion (6 flows)

- Initial state: all collapsed, chevron right
- SELECT → expand (chevron rotates, LayoutAnimation)
- SELECT again → collapse
- Only one expanded at a time
- D-pad DOWN between questions
- Accessibility: role="button", expanded state

### Quiz Modal (8 flows)

- Quiz button focus state (gradient, 1.05x scale)
- SELECT → modal opens
- **tvOS: QR code display** (TvOSQrContent, qrcode-generator)
- **Android TV: WebView with iframe** (AndroidTvWebViewContent)
- WebView loading → loaded → errored states (Android TV only)
- WebView navigation whitelist (nextstep.is only)
- Close button (hasTVPreferredFocus) SELECT → modal closes
- URL validation (silent drop if invalid)

### Text & Static Content (4 flows)

- TextRenderer: heading + paragraphs display
- TextRenderer: heading only (no paragraphs)
- EasterDatesRenderer: gradient card with Western/Orthodox/Passover dates
- PlaceholderRenderer: unknown block type → null (silent)

### Container & Wrapper (3 flows)

- ContainerRenderer: multi-column layout (gridSpan-based flex)
- SectionWrapperRenderer: nested children in vertical stack
- SectionWrapperRenderer: nested focus anchors for scroll-to-section

### Focus Management Deep Dive (8 flows)

- hasTVPreferredFocus one-shot pattern (prevents re-stealing)
- TVFocusGuideView autoFocus (carousel first-card focus)
- TVFocusGuideView destinations (HomeHero → Explore button)
- TVFocusGuideView trapFocus\* (video overlay containment)
- Spatial focus navigation (D-pad → nearest focusable)
- Focus ring appearance (1.05x scale, crimson glow, shadowRadius scaled(16))
- Focus restoration after modal dismiss
- Invisible focus anchor system (48px tall, opacity 0)

### Platform-Specific tvOS vs Android TV (8 flows)

- Quiz: QR code (tvOS) vs WebView (Android TV)
- WebView conditional require (prevents tvOS crash)
- Hardware acceleration: renderToHardwareTextureAndroid on FocusableCard
- ScrollView scroll-to-section offset (Android: -24px adjustment)
- LayoutAnimation explicit enable (Android only)
- Remote button mapping (Menu vs Back button)
- Focus ring rendering consistency
- WebView navigation whitelist enforcement (Android TV)

### Error & Edge Cases (10 flows)

- Network error + retry
- Empty experience (no sections)
- Invalid video URL (non-Mux, silent drop)
- Missing thumbnail fallback (surfaceContainerHighest bg)
- Unknown section type (PlaceholderRenderer → null)
- Invalid quiz URL (component returns null)
- WebView blocked navigation (Android TV)
- Carousel with empty items → null
- Focus restore race condition (fast open/close)
- Large experience (100+ sections, ScrollView not virtualized)

### Accessibility (4 flows)

- accessibilityLabel on cards and images
- accessibilityRole="header" on section headings
- accessibilityRole="button" on accordion questions
- accessibilityState={{ expanded }} on accordion
