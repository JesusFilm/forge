---
date: 2026-04-10
topic: tv-app-prototype
---

# TV App Prototype — Apple TV & Android TV

## Problem Frame

Urim's roadmap items (feat-011, 012, 017, 018) are blocked on upstream search and topic infrastructure. Rather than idle, this time should go toward standing up a TV app — the third rendering target for the existing CMS-driven Experience pipeline.

JesusFilm's SDUI architecture (Strapi → GraphQL → normalizer → dispatcher → renderers) was designed for exactly this: same content, multiple surfaces. A TV app adds reach to living rooms using existing CMS content and GraphQL API. The prototype validates that the pipeline works on TV and establishes the foundation for a production app.

This work is **AI-driven** — Claude agents execute implementation, Urim reviews plans and PRs. It runs **in parallel with feat-004 (Web App Onboarding)**.

## Users

- People who watch faith-based video content on their TV
- Families exploring JesusFilm Experiences together on a big screen
- Not power users — expect low technical confidence with remote controls

## Design Philosophy

- **Effortless discovery**: Users should find interesting content within seconds, not hunt for it. The UI must guide, not overwhelm.
- **10-foot UI**: Everything readable from a couch. Large text, high contrast, generous spacing. No small tap targets — focus rings and D-pad are the interaction model.
- **Curated rails, not infinite scroll**: Horizontal content rails (Netflix/YouTube TV pattern) organized by Experience or category. Proven for TV because it works perfectly with D-pad left/right/up/down.
- **Dive deeper on select**: Pressing select on a rail item opens the full Experience view — the section-by-section journey, adapted for TV.
- **Video-first**: On TV, video is the primary medium. Full-screen playback on select. Minimize text-heavy screens.

## Scope — Working Prototype

### In Scope

1. **Day-1 spike**: Verify Expo TV toolchain — get a minimal "hello world" app building and running on Apple TV Simulator using `@react-native-tvos/config-tv` + `EXPO_TV=1`. Confirm expo-video plays an HLS stream on tvOS. Go/no-go gate before further work.
2. **App scaffolding**: New `apps/tv/` Expo app using `react-native-tvos` (aliased via npm as `react-native`), `@react-native-tvos/config-tv` plugin, CNG/prebuild with `EXPO_TV=1`. Dev-client builds only (no Expo Go on TV).
3. **GraphQL wiring**: Apollo Client + `@forge/graphql` fetching Experiences from CMS
4. **SDUI pipeline**: Normalizer and dispatcher ported from mobile-v2, adapted for TV renderers
5. **Home screen**: Featured hero from the `isHomepage` Experience (VideoHero block) at the top. Below: an "Experiences" rail showing all Experiences as cards (`LIST_EXPERIENCES` → ogImage + title). Select opens Experience detail.
6. **Experience screen**: Vertical section feed rendering the blocks for a selected Experience. Renderers: VideoHero, SectionWrapper, Container, Video, Text, BibleQuotesCarousel. Unhandled block types display a PlaceholderRenderer (dev log + skip).
7. **Video playback**: expo-video playing HLS streams, full-screen on select
8. **Focus management**: TVFocusGuideView for reliable D-pad navigation between and within rails
9. **Loading/error states**: Loading spinner while fetching, error screen with focusable retry button (D-pad must always have a focus target). Empty state if no Experiences returned.

### Out of Scope (for prototype)

- Search functionality (blocked upstream anyway)
- Topic browsing (blocked upstream)
- Deep linking / universal links
- Analytics / tracking
- Offline support / caching beyond Apollo defaults
- Localization (English only for prototype)
- Production EAS build profiles (development/preview only)
- App Store / Play Store submission
- MediaCollection, quiz, NavigationCarousel, VideoCarousel, EasterDates, and other non-core renderers (deferred — PlaceholderRenderer handles these gracefully)
- Auto-preview on focus (deferred — prototype shows static thumbnails; auto-preview adds debounce/mute/abort complexity better suited for a follow-up)

## Architecture

```
apps/tv/                          # New Expo TV app
├── app/
│   ├── _layout.tsx               # Root layout + ExperienceProvider + Apollo
│   ├── index.tsx                 # Home screen (content rails)
│   └── experience/[slug].tsx     # Experience detail screen
├── src/
│   ├── lib/
│   │   ├── queries.ts            # Import/re-export from mobile-v2 or duplicate
│   │   ├── normalizer.ts         # Port from mobile-v2 (identical logic)
│   │   └── apolloClient.ts        # Apollo Client setup for TV (follows mobile-v2 lazy-init pattern)
│   └── components/
│       ├── sections/
│       │   ├── SectionDispatcher.tsx
│       │   ├── VideoHeroRenderer.tsx     # TV-adapted (auto-preview, focus ring)
│       │   ├── VideoCardRenderer.tsx     # Landscape card for rails
│       │   ├── TextRenderer.tsx          # Large readable text
│       │   ├── BibleQuotesCarouselRenderer.tsx
│       │   ├── SectionWrapperRenderer.tsx   # Structural wrapper (most blocks are nested inside these)
│       │   ├── ContainerRenderer.tsx        # Container wrapper for Text + RelatedQuestions
│       │   └── PlaceholderRenderer.tsx      # Fallback for unhandled block types (logs + skips)
│       ├── ContentRail.tsx               # Horizontal scrolling rail with focus
│       ├── FocusableCard.tsx             # Base focusable element with ring
│       └── VideoPlayer.tsx               # Full-screen TV video player
```

### Code Sharing Strategy

- **Direct reuse**: `@forge/graphql` package (types, `graphql()` function) — already shared
- **Import directly**: `normalizer.ts` and `queries.ts` — import from `apps/mobile-v2/src/lib/` via pnpm workspace path (e.g., add `mobile-v2` as a workspace dependency, or use TypeScript path aliases). Avoids copy-and-drift. Both files depend on `@forge/graphql` types which are already shared. Note: normalizer uses RN `__DEV__` global (available in react-native-tvos).
- **Rewrite for TV**: All renderers — same data shapes but entirely different visual treatment for 10-foot UI and focus navigation
- **ExperienceProvider**: Port from `apps/mobile-v2/src/contexts/ExperienceProvider.tsx` — provides normalized Experience data to screens. Import directly or copy if the provider needs TV-specific adaptations.
- **Not extracted to shared package yet**: If the TV app proves out, extract normalizer + queries + ExperienceProvider into `packages/experience-sdui` as a follow-up.

## TV-Specific UX Patterns

### Focus Management

- Every interactive element must be focusable via D-pad
- Visible focus ring (high-contrast border or glow) on the currently focused element
- Focus memory (in-memory, per-session only): returning to the home screen from an Experience detail remembers which rail card was last focused. No persistence across app restarts.
- TVFocusGuideView to constrain focus within rails (prevent diagonal jumps)

### Home Screen Layout

- **Hero area (top)**: The `isHomepage` Experience's VideoHero block, rendered full-width at top of screen. Shows thumbnail (no auto-preview in prototype). Title + subtitle overlay.
- **Experiences rail (below hero)**: Horizontal rail of all Experiences from `LIST_EXPERIENCES`. Each card shows ogImage + title. D-pad left/right scrolls the rail. Select navigates to that Experience's detail screen.
- D-pad up focuses hero, down focuses rail
- Focused card scales up slightly (1.05x) with focus ring
- Rail title visible above the rail (e.g., "Explore Experiences")

### Video Behavior

- On focus (in a rail): show static thumbnail (auto-preview deferred to follow-up)
- On select from rail: navigate to Experience detail screen
- On select on a video block in Experience screen: enter full-screen playback
- Playback controls: play/pause (center button), seek ±10s (left/right), back to Experience (menu button)
- End of video: return to Experience screen, focus on the video block that was playing

### Navigation

- No tab bar — Expo Router stack navigation (home → experience detail → video fullscreen)
- Select on home rail card: push to `experience/[slug]` screen
- Back button (menu on Apple TV remote, back on Android TV): pops navigation stack
- Home screen is the root — back from home exits app
- Transitions: use Expo Router's default push animation (known to work on TV per ExpoRouterTV demo)

## Success Criteria

### Technical (binary pass/fail)

1. `apps/tv/` builds and runs on Apple TV Simulator and Android TV Emulator via `EXPO_TV=1 npx expo prebuild --clean && npx expo run:ios` (or Android equivalent)
2. Home screen renders hero + Experiences rail populated from CMS via GraphQL
3. D-pad navigation works: move between hero and rail, scroll within rail, select items
4. Selecting an Experience opens the Experience detail screen (vertical section feed of blocks)
5. Video playback works full-screen with play/pause and ±10s seek
6. Focus rings are visible and follow D-pad movement consistently
7. Loading spinner shows during data fetch; error screen with retry button shows on failure

### Qualitative (go/no-go for production app)

8. Focus navigation feels responsive (no perceptible lag between D-pad press and focus move)
9. Video playback quality is acceptable on a TV-sized display (no buffering on reasonable connection)
10. The Experience detail screen is readable and navigable — content doesn't feel like a stretched phone app

## Platform Validation (Resolved)

Research confirms Expo SDK 54 supports TV targets:

- `react-native-tvos@0.81-stable` installed as npm alias for `react-native`
- `@react-native-tvos/config-tv` Expo config plugin handles native setup
- `EXPO_TV=1` + `npx expo prebuild --clean` generates TV-targeted native projects
- expo-video has tvOS support (expo/expo PR #29560, merged June 2024)
- Expo Router works on TV (confirmed by ExpoRouterTV demo project)
- Dev-client builds only (no Expo Go on TV)
- Day-1 spike (In Scope item #1) validates this end-to-end before further work

## Risks & Open Questions

1. **Focus management complexity**: D-pad focus can be finicky, especially with nested scrollable containers. May need custom focus engine. Known issue: focus lost on back-navigation (react-native-tvos issue #852).
2. **Image aspect ratios**: Mobile queries use `mobileCinematicHigh` (portrait-optimized). TV is landscape-native. Prototype uses `ogImage` for home rail and `videoStill` for Experience blocks — both are landscape-friendly. If quality is insufficient, TV-specific CMS image fields may be needed later.
3. **Content volume**: If the CMS has fewer than ~5 Experiences, the home screen rail will look sparse. The prototype's visual quality depends on having enough content to demonstrate the browsing experience.
4. **pnpm workspace import**: Importing normalizer/queries directly from mobile-v2 may need Metro bundler configuration to resolve cross-app imports. If this causes issues, fall back to copying the files.

## Roadmap Fit

- **Timeline**: Prototype during blocked period (April 10 – April 30, 2026). If upstream items unblock mid-prototype, TV work continues at lower priority — the AI agents can sustain progress with lighter review cadence.
- **Parallel with**: feat-004 (Web App Onboarding). Both are AI-driven with Urim reviewing PRs. Expect ~2-3 PRs/day across both tracks during active periods.
- **No upstream dependencies**: Uses existing CMS content and GraphQL API
- **Follow-up ticket**: If prototype succeeds (meets qualitative criteria #8-10), create a proper roadmap feature for production TV app

## Non-Goals

- This is not a production app. No App Store polish, no crash reporting, no performance optimization.
- Not extracting shared SDUI packages yet. Prove the concept first, refactor second.
- Not building custom navigation patterns. Use proven TV patterns (rails, focus rings, back = pop).
