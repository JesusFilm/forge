---
title: "feat: Mobile v2 — SDUI Experience Renderer"
type: feat
status: active
date: 2026-04-02
origin: docs/brainstorms/2026-04-01-mobile-experience-redesign-requirements.md
deepened: 2026-04-02
---

# feat: Mobile v2 — SDUI Experience Renderer

## Enhancement Summary

**Deepened on:** 2026-04-02
**Research agents used:** Mobile Learnings (15 critical patterns), Framework Docs (Expo Router, gql.tada, expo-video), Architecture Strategist, Performance Oracle, Security Sentinel, Code Simplicity Reviewer

### Key Improvements from Deepening

1. **Simplified pipeline**: Eliminated full sectionModels.ts/sectionMapper.ts duplication — use gql.tada `ResultOf` types with a thin normalizer (~100 LOC vs ~720 LOC)
2. **FlashList over ScrollView**: Main feed uses `@shopify/flash-list` for virtualized rendering — eliminates custom LazySection mount/unmount logic
3. **expo-image everywhere**: Replaces React Native `<Image>` for bounded memory cache, decode-time downsampling, blurhash placeholders
4. **VideoDecoderBudget**: Global context tracks active decoder slots — prevents Android OOM
5. **Apollo cache persistence**: `apollo3-cache-persist` for instant cold-start rendering
6. **Security hardening**: URL validation for streaming/action URLs, sectionKey sanitization, read-only API token scope
7. **Stable tabs**: Use standard `<Tabs>` from Expo Router (not alpha native tabs) for SDK 54 stability
8. **Deferred scope**: AdventCountdown, Card, CTA renderers deferred to post-MVP. Start with Home screen only (no empty tabs).

### Critical Lessons from Existing Mobile App

These are the top institutional learnings from `docs/solutions/mobile/` that directly inform this plan:

1. **Android OOM from eager video mounting** — Use viewport-gated lifecycle. Never call `player.play()` in `useVideoPlayer` setup callback.
2. **Android VideoView z-order** — Native SurfaceView renders on top of all RN Views. Design layouts with video BEHIND scroll content.
3. **ScrollView gesture preemption** — Use `pointerEvents="box-none"` pass-through. Interactive hero elements must be INSIDE the ScrollView tree.
4. **GraphQL schema drift** — gql.tada eliminates this class of bugs (the reason for choosing it).
5. **4-layer pipeline atomicity** — Query + normalizer + dispatcher + renderers must all support a new block type simultaneously.
6. **Codegen strips optional variables** — Set `optimizeDocumentNode: false` in codegen config.
7. **Animated.Value.addListener unreliable with native driver** — Use plain JS `onScroll` handler, not Animated.ScrollView.
8. **Env validation** — `runtimeEnvStrict`, `isServer: false`, `emptyStringAsUndefined: true`, skip only in `CI && !EAS_BUILD`.
9. **LinearGradient "transparent" keyword** — Always use `hexToRgba(targetColor, 0)` to avoid dark banding.
10. **contentParagraphs is string[]** — Strapi v5 `type: "json"` fields need `Array.isArray()` guards, not bare `as string[]` casts.

---

## Overview

Build a new React Native Expo app (`apps/mobile-v2/`) that renders Experience pages from Strapi v5 as a curated video gallery. The app uses Server-Driven UI (SDUI) — the CMS controls what blocks appear and in what order; the app renders them using a typed pipeline. This replaces the existing `apps/mobile/` once validated.

The app follows the 4th-iteration mockups: HIG-compliant on iOS, Material 3 on Android, curated gallery aesthetic (not YouTube/catalog), full-width cinematic video cards in CMS order, with horizontal VideoCarousel rows as natural rhythm breaks.

## Problem Statement

The existing `apps/mobile/` renders Experiences as an endless ScrollView identical to the web layout. The new app provides a curated, personal, video-first mobile experience using the same CMS data. (see origin: `docs/brainstorms/2026-04-01-mobile-experience-redesign-requirements.md`)

## Proposed Solution

### Architecture

```
apps/mobile-v2/           (new Expo app, Expo Router)
  ├── app/            (file-based routes)
  │   ├── _layout.tsx (root layout: ApolloProvider + SafeAreaProvider + Stack)
  │   ├── (tabs)/     (tab group — Home only for MVP)
  │   │   ├── _layout.tsx (Tabs navigator with Home tab only)
  │   │   └── index.tsx   (Home — curated Experience gallery)
  │   └── video/
  │       └── [sectionKey].tsx (Video detail — bespoke with SDUI content)
  ├── src/
  │   ├── lib/
  │   │   ├── apolloClient.ts      (lazy singleton, 15s timeout, Bearer auth)
  │   │   ├── env.ts               (t3-oss/env-core validation)
  │   │   ├── config.ts            (platform-aware GraphQL URL)
  │   │   ├── queries.ts           (gql.tada query + fragments — defined HERE, not in @forge/graphql)
  │   │   ├── normalizer.ts        (thin __typename → kind normalizer, ~100 LOC)
  │   │   ├── resolveImageUrl.ts   (image host allowlist)
  │   │   ├── validateUrl.ts       (NEW — action/streaming URL validation)
  │   │   └── color.ts             (hexToRgba utility)
  │   ├── hooks/
  │   │   ├── useExperience.ts     (Apollo query → normalized sections)
  │   │   └── useTypography.ts     (responsive scaling)
  │   ├── contexts/
  │   │   ├── ExperienceProvider.tsx (holds MappedExperience, exposes useSectionByKey)
  │   │   └── VideoDecoderBudget.tsx (NEW — global decoder slot tracking)
  │   └── components/
  │       └── sections/            (renderers — MVP set only)
  │           ├── SectionDispatcher.tsx
  │           ├── CuratedHomeLayout.tsx
  │           ├── VideoDetailLayout.tsx
  │           ├── VideoHeroRenderer.tsx
  │           ├── VideoCardRenderer.tsx    (NEW — cinematic feed card)
  │           ├── VideoCarouselRenderer.tsx (NEW — horizontal row)
  │           ├── NavigationCarouselRenderer.tsx
  │           ├── MediaCollectionRenderer.tsx
  │           ├── BibleQuotesCarouselRenderer.tsx
  │           ├── RelatedQuestionsRenderer.tsx (with ctaLabel/ctaLink)
  │           ├── TextRenderer.tsx
  │           ├── ContainerRenderer.tsx
  │           ├── SectionWrapperRenderer.tsx
  │           ├── EasterDatesRenderer.tsx
  │           └── QuizButtonRenderer.tsx
  ├── package.json    (@forge/mobile-v2)
  ├── app.json
  ├── eas.json
  ├── metro.config.js (monorepo watchFolders for @forge/graphql)
  ├── tsconfig.json
  └── CLAUDE.md
```

### Key Architectural Decisions

1. **Simplified SDUI pipeline** — Instead of the 4-layer pipeline (models → mapper → dispatcher → renderers), use a **2.5-layer pipeline**: gql.tada typed query → thin normalizer (adds `kind` discriminant from `__typename`, ~100 LOC) → dispatcher → renderers. The normalizer replaces the 720-LOC models+mapper combo. (Simplicity review insight)

2. **Query defined in `apps/mobile-v2/`** — Per `packages/graphql/CLAUDE.md` convention: "Operations are defined in apps using `graphql()` from this package." NOT in `@forge/graphql` itself. (Architecture review correction)

3. **ExperienceProvider context for data passing** — Wraps the root layout (`app/_layout.tsx`), NOT the tabs layout — because the video detail route (`app/video/[sectionKey].tsx`) is outside the tabs group and needs access to section data. Video detail receives only `sectionKey` via route param, looks up full section data via `useSectionByKey(sectionKey)` from context. O(1) Map lookup. No serialization. (Architecture review recommendation)

4. **FlashList for the section feed below the hero** — The VideoHero remains a fixed-position layer BEHIND the scroll content (matching the existing `FixedHeroLayout` parallax pattern from `apps/mobile/`). FlashList renders the sections that appear BELOW the hero (video cards, carousels, etc.) with `viewabilityConfig` for video play/pause gating. The hero is NOT a `ListHeaderComponent` — it is a separate absolutely-positioned layer. (Performance review + Hero layout learning)

5. **Stable `<Tabs>` not native tabs** — `expo-router/unstable-native-tabs` is alpha in SDK 54 with known issues (#39722, #41049). Use standard `<Tabs>` from Expo Router which renders platform-appropriate JS-based tabs. (Framework research finding)

6. **Home tab only for MVP** — No empty Watch/Library/Profile tabs. Add tab navigator when content exists for a second tab. (Architecture + Simplicity review)

7. **expo-image everywhere** — Replaces React Native `<Image>`. Bounded LRU memory cache, disk caching, decode-time downsampling, blurhash placeholders. (Performance review — critical for 7+ cinematic images in feed)

## Technical Approach

### Phase 1: Scaffolding & Infrastructure

**Goal:** New Expo app boots, connects to Strapi, renders a loading state.

#### Tasks

- [ ] **`apps/mobile-v2/package.json`** — `@forge/mobile-v2`, deps: `expo` (SDK 54), `expo-router`, `@apollo/client`, `@forge/graphql`, `expo-video`, `expo-image`, `expo-blur`, `expo-linear-gradient`, `react-native-safe-area-context`, `@t3-oss/env-core`, `zod`, `@shopify/flash-list`, `apollo3-cache-persist`, `@react-native-async-storage/async-storage`, `@hebcal/hdate`
- [ ] **`apps/mobile-v2/metro.config.js`** — Monorepo watchFolders pointing to repo root, `nodeModulesPaths` for workspace resolution, `.cjs` in `sourceExts` for Apollo Client v4
- [ ] **`apps/mobile-v2/app.json`** — Expo config: `expo-router` plugin, `expo-video` plugin (with `supportsBackgroundPlayback: true`), `edgeToEdgeEnabled: true`, portrait-only, `scheme: "forgemobile"` for deep links
- [ ] **`apps/mobile-v2/eas.json`** — Build profiles matching `apps/mobile/eas.json`
- [ ] **`apps/mobile-v2/tsconfig.json`** — Extend root, path aliases
- [ ] **`apps/mobile-v2/src/env.ts`** — `@t3-oss/env-core` with `runtimeEnvStrict`, `isServer: false`, `emptyStringAsUndefined: true`, `skipValidation: !!process.env.CI && !process.env.EAS_BUILD`

#### Research Insights

- **Metro monorepo config** — Must set `watchFolders: [monorepoRoot]` and `resolver.nodeModulesPaths` to resolve `@forge/graphql`. See existing `apps/mobile/metro.config.js` pattern. (Framework research)
- **Lazy SDK init** — Never instantiate Apollo Client at module scope. Use `getApolloClient()` getter. Module-scope instantiation crashes imports when env vars are missing in CI. (Learnings: new-app-ci-and-deployment-patterns)
- **EAS_BUILD guard** — Both CI and EAS set `CI=true`. The `!process.env.EAS_BUILD` guard prevents skipping validation during actual builds. (Learnings: eas-update-stakeholder-preview-setup)

- [ ] **`apps/mobile-v2/src/lib/apolloClient.ts`** — Lazy singleton. 15s timeout. Bearer token auth. `InMemoryCache()` with `apollo3-cache-persist` + `AsyncStorage`:
  ```typescript
  const cache = new InMemoryCache()
  await persistCache({ cache, storage: AsyncStorage })
  ```
- [ ] **`apps/mobile-v2/app/_layout.tsx`** — Root layout: `ApolloProvider` + `SafeAreaProvider` + `ExperienceProvider` + `VideoDecoderBudgetProvider` + `Stack`. `unstable_settings = { initialRouteName: '(tabs)' }` for deep link back navigation. ExperienceProvider must wrap the root Stack so both `(tabs)/index.tsx` and `video/[sectionKey].tsx` have access to section data.
- [ ] **`apps/mobile-v2/app/(tabs)/_layout.tsx`** — Single Home tab for MVP. `#CB333B` accent color. Use standard `<Tabs>` from expo-router (not unstable native tabs).
- [ ] **`apps/mobile-v2/CLAUDE.md`** — Conventions for this app

**Verification:** `npx expo start` boots, Apollo connects, persisted cache hydrates.

### Phase 2: SDUI Pipeline (Data Layer)

**Goal:** Experience data flows from Strapi → gql.tada typed query → thin normalizer → React hook.

#### Tasks

- [ ] **`apps/mobile-v2/src/lib/queries.ts`** — Define query and fragments using `graphql()` from `@forge/graphql`:

  ```typescript
  import { graphql } from "@forge/graphql"

  const VideoHeroFragment = graphql(`
    fragment VideoHeroFields on ComponentSectionsVideoHero {
      id
      sectionKey
      heading
      subheading
      streamingUrl
      ctaLabel
      video {
        documentId
        slug
        title
        imageAlt
        images {
          url
          mobileCinematicHigh
          videoStill
        }
      }
    }
  `)
  // ... fragments for all block types
  ```

  Must include ALL Experience block fragments (see complete list in origin document R7).
  **Critical**: Include `ctaLabel`/`ctaLink` on `ComponentSectionsRelatedQuestions` and `ctaLabel` on `ComponentSectionsMediaCollection` — these are missing from current mobile query. (SpecFlow Gap 4)
  **Critical**: Include `ComponentSectionsVideoCarousel` — completely unimplemented in current mobile app. (SpecFlow Gap 2)

- [ ] **`apps/mobile-v2/src/lib/normalizer.ts`** — Thin normalizer that:
  - Maps `__typename` strings to clean `kind` discriminants (`"ComponentSectionsVideoHero"` → `"videoHero"`)
  - Recursively normalizes Container slots and Section wrapper content
  - Returns `NormalizedSection` = original `ResultOf` data + an added `kind` string field. The type is: `{ kind: SectionKind } & ResultOf<typeof SomeFragment>`. Renderers receive the full gql.tada-typed data with `kind` added for dispatch.
  - Handles unknown `__typename` gracefully (`__DEV__` warning, returns null)
  - **Does NOT create a parallel type hierarchy** — `kind` is the only added field; all other fields come from the gql.tada `ResultOf` types unchanged

- [ ] **`apps/mobile-v2/src/contexts/ExperienceProvider.tsx`** — Holds the normalized experience data:
  - `ExperienceProvider` wraps the tab group in `app/(tabs)/_layout.tsx`
  - Builds a `Map<string, NormalizedSection>` keyed by `sectionKey` on data load
  - Exports `useSectionByKey(key: string)` hook for O(1) lookup
  - Video detail screen uses this to get section data without route-param serialization

- [ ] **`apps/mobile-v2/src/hooks/useExperience.ts`** — Apollo `useQuery` → normalize → return typed sections:
  - `cache-first` fetch policy with background `refetch()` after mount (instant render from persisted cache)
  - Tristate: loading/error/success
  - Cancellation-safe cleanup

- [ ] **`apps/mobile-v2/src/lib/resolveImageUrl.ts`** — Copy from `apps/mobile`. Allowlist: `jesusfilm.org`, `arclight.org`, `cloudfront.net`, `amazonaws.com`, `imagedelivery.net`, `stream.mux.com`, `unsplash.com`

- [ ] **`apps/mobile-v2/src/lib/validateUrl.ts`** (NEW) — Security utility:

  ```typescript
  export function validateActionUrl(url: string): boolean {
    // Require https: protocol. Reject javascript:, data:, tel:, sms:, file:
    // Optionally allowlist trusted domains for CTAs
  }
  export function validateStreamingUrl(url: string): boolean {
    // Require stream.mux.com domain
  }
  ```

  Applied to all CMS-sourced URLs before `Linking.openURL()` or `useVideoPlayer()`. (Security review Finding 2, 5)

- [ ] **`apps/mobile-v2/src/lib/color.ts`** — `hexToRgba` utility (never use `"transparent"` in gradients)

#### Research Insights

- **Fragment colocation** — Define fragments in `apps/mobile-v2/src/lib/queries.ts`, not in `@forge/graphql`. This follows the established convention. The web app's fragments in `apps/web/src/lib/fragments/` are a parallel pattern, not a shared one. Acceptable duplication. (Architecture review)
- **Codegen pitfall** — Ensure `optimizeDocumentNode: false` in codegen config. Without this, optional query variables are silently stripped. (Learnings: codegen-strips-optional-graphql-variables)
- **Composite React keys** — `key={`${item.kind}-${item.id}-${index}`}`. Strapi component IDs are per-type, not globally unique. (Learnings: schema-drift)

**Verification:** `useExperience({ slug: "easter" })` returns normalized sections. Console log section count and kinds. Cache persists across app restarts.

### Phase 3: Home Screen — Curated Gallery Layout

**Goal:** Renders the Experience as a curated gallery matching the 4th-iteration HIG/M3 mockups.

#### Tasks

- [ ] **`CuratedHomeLayout.tsx`** — Main home screen layout (two-layer architecture):
  - **Layer 1 (behind):** VideoHero rendered as an absolutely-positioned full-bleed background with expo-video player. Gradient fades to `#1c1917`. Scroll offset dims/blurs the hero.
  - **Layer 2 (on top):** FlashList with `contentContainerStyle={{ paddingTop: heroHeight }}` to leave space for the hero. NavigationCarousel is the first item in the data array (or inline header before the list).
    ```typescript
    <View style={{ flex: 1 }}>
      {/* Fixed hero behind scroll content */}
      <VideoHeroRenderer section={heroSection} style={StyleSheet.absoluteFill} />
      {/* Scrollable sections on top */}
      <FlashList
        data={feedSections}  // navCarousel + video cards + carousels
        estimatedItemSize={300}
        renderItem={({ item }) => <SectionDispatcher section={item} />}
        keyExtractor={(item, i) => `${item.kind}-${item.id}-${i}`}
        contentContainerStyle={{ paddingTop: heroHeight }}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        onViewableItemsChanged={handleViewableChange}
      />
    </View>
    ```
  - `onViewableItemsChanged` manages video play/pause for visible sections
  - Interactive hero elements (mute button) use `pointerEvents="box-none"` pass-through layer ABOVE the FlashList (Learnings: scrollview-touch-event)
  - **`classifySection()` function** determines rendering mode for SectionWrapper blocks:
    - If section contains a `Video` content block → render as `VideoCardRenderer` (cinematic card on home feed)
    - If section is a `VideoCarousel` → render as `VideoCarouselRenderer` (horizontal row)
    - If section is a `MediaCollection` → render as `MediaCollectionRenderer`
    - Otherwise → render via generic `SectionDispatcher`
    - On the detail screen, the same SectionWrapper renders ALL its content blocks (not just the video card). The `classifySection` logic is home-screen-only.

- [ ] **`VideoHeroRenderer.tsx`** — Full-bleed hero:
  - expo-video player: autoplay, muted, loop
  - Long gradient overlay fading to `#1c1917` (use `hexToRgba("#1c1917", 0)` NOT `"transparent"`)
  - Heading (34pt iOS / 32sp Android), subheading, "Watch now" CTA (#CB333B)
  - Safe areas: 59pt top for Dynamic Island (iOS), transparent status bar (Android)
  - AppState-aware play/pause. `useFocusEffect` to pause when navigating to detail.
  - iOS: `expo-blur` BlurView. Android: `rgba(0,0,0,0.6)` dim overlay fallback.
  - **Pitfall**: Android VideoView renders on top of all RN Views. Place video BEHIND scroll content via absolute positioning. (Learnings: full-bleed-video-hero)
  - **Pitfall**: Interactive elements (mute button) must be INSIDE the ScrollView/FlashList content tree or use `pointerEvents="box-none"` pass-through. (Learnings: scrollview-touch-event)

- [ ] **`NavigationCarouselRenderer.tsx`** — Horizontal scrollable "table of contents":
  - 6 rounded-rectangle cards (80pt × 100pt, 12pt corners)
  - `expo-image` with `priority="low"` (don't compete with hero for decode bandwidth)
  - Category label (11pt uppercase) + title (13pt)
  - Tap → `FlashList.scrollToIndex()` for corresponding section
  - Minimum 48dp touch targets

- [ ] **`VideoCardRenderer.tsx`** (NEW) — Full-width cinematic video card:
  - `expo-image` with `mobileCinematicHigh` source (1280×600), `contentFit="cover"`, `recyclingKey`
  - 12pt corners, gradient overlay at bottom with `hexToRgba`
  - Title + subtitle overlaid on gradient
  - 16pt horizontal margins, 16pt vertical gap
  - Tap → `router.push({ pathname: '/video/[sectionKey]', params: { sectionKey } })`
  - Touch feedback: iOS opacity (0.7), Android ripple

- [ ] **`VideoCarouselRenderer.tsx`** (NEW) — Titled horizontal row:
  - Header: `vcTitle` (22pt/22sp) + `vcSubtitle` (13pt/12sp muted)
  - Horizontal FlatList of item cards with `expo-image` thumbnails
  - **No video players in carousel items** — show poster images with play icon overlay. Only create a player when user taps (navigates to detail). (Performance review: decoder budget)
  - Tap → navigate to video detail

- [ ] **`MediaCollectionRenderer.tsx`** — Horizontal collection carousel:
  - Tall portrait cards with title, label, collectionSize
  - `expo-image` for thumbnails

#### Research Insights

- **FlashList over ScrollView** — Eliminates the need for custom LazySection mount/unmount logic. FlashList handles virtualization natively. Keep video play/pause gating via `viewabilityConfig`. Expected: 30-50% reduction in JS thread work during scroll. (Performance review)
- **expo-image vs Image** — 7+ cinematic images (1280×600) = ~21MB decoded bitmap memory with RN Image. expo-image's bounded LRU cache and decode-time downsampling reduces this to ~10-15MB. (Performance review)
- **Pause hero on detail navigation** — Use Expo Router's `useFocusEffect` to pause hero video when pushing to detail. Frees a decoder slot. (Performance review)

**Verification:** Home screen renders Easter Experience. FlashList scrolls smoothly on mid-range Android. No video decoder OOM.

### Phase 4: Video Detail Screen

**Goal:** Tapping a video card pushes to a detail screen with player + Section's content blocks.

#### Tasks

- [ ] **`apps/mobile-v2/app/video/[sectionKey].tsx`** — Video Detail route:
  - Validates `sectionKey` with strict regex: `/^[a-zA-Z0-9\-\/]+$/` — renders error for invalid keys (Security review Finding 4)
  - Reads `sectionKey` from `useLocalSearchParams()` (NOT `useGlobalSearchParams` — avoids re-renders)
  - Looks up section data via `useSectionByKey(sectionKey)` from ExperienceProvider
  - Renders pinned video player at top (16:9, full-width, 12pt corners)
  - Validates `streamingUrl` via `validateStreamingUrl()` before passing to `useVideoPlayer()`
  - Below player: title + subtitle
  - Below: renders the Section's nested content blocks via `ContentDispatcher` in a ScrollView
  - Navigation: iOS `<` chevron back. Android `←` arrow back. (handled by Expo Router native stack)

- [ ] **`ContentDispatcher.tsx`** — Recursive dispatcher for nested Section content:
  - Switch on normalized `kind`, renders matching renderer
  - `default` case: render nothing + `__DEV__` warning log (not a crash)
  - Validates all CMS-sourced action URLs via `validateActionUrl()` before `Linking.openURL()`

- [ ] **`TextRenderer.tsx`** — Heading + expandable paragraphs:
  - `contentParagraphs` is `string[]` — validate with `Array.isArray()` guard (Learnings: text-renderer-paragraph-type-mismatch)
  - "Read more"/"Show more" toggle in #CB333B

- [ ] **`BibleQuotesCarouselRenderer.tsx`** — Horizontal paging carousel:
  - `expo-image` for card backgrounds with `recyclingKey`
  - Only load visible card + neighbors (FlatList `windowSize={3}`, `initialNumToRender={1}`)
  - Last card may be CTA with `ctaLink` — validate via `validateActionUrl()`

- [ ] **`RelatedQuestionsRenderer.tsx`** — Heading + "Ask yours" CTA:
  - `ctaLabel` + `ctaLink` (newly added to query — was missing from mobile)
  - Opens external browser via `Linking.openURL()` after `validateActionUrl()`
  - If actual questions present, expandable accordion

- [ ] **`QuizButtonRenderer.tsx`** — Full-width CTA opening WebView:
  - Copy security hardening from existing: domain allowlist (nextstep.is), no file access, no third-party cookies, mixed content blocked
  - Add comment warning against adding `onMessage` without origin validation (Security review)

- [ ] **`EasterDatesRenderer.tsx`** — Easter/Passover dates with `@hebcal/hdate`
- [ ] **`ContainerRenderer.tsx`** — Responsive grid with `gridSpan`
- [ ] **`SectionWrapperRenderer.tsx`** — Background color wrapper. Add `"cosmic"` and `"purple"` to supported colors.

**Deferred to post-MVP:**

- `AdventCountdownRenderer.tsx` — Christmas-specific, not needed for Easter launch
- `CTARenderer.tsx` — Add when CTA blocks appear in target Experiences
- `CardRenderer.tsx` — Add when Card blocks appear
- PR preview via EAS Update — see Stretch Goals below

**Verification:** Tap video card → detail shows player + all Section content. Bible quotes scroll. "Ask yours" opens external link. Quiz opens WebView.

### Phase 5: Platform Compliance & Polish

**Goal:** Passes visual review against HIG and M3 guidelines.

#### Tasks

- [ ] **Safe areas** — `useSafeAreaInsets()`:
  - iOS: 59pt top (Dynamic Island), 34pt bottom (home indicator)
  - Android: edge-to-edge with transparent bars. Content behind system bars handled by SafeAreaProvider.
  - All loading/error/empty states account for insets

- [ ] **Typography** — `fontFamily: 'System'` (SF Pro iOS, Roboto Android):
  - `useTypography()` hook with responsive scaling (screen width / 375 baseline, clamped 0.85x-1.15x)
  - `Math.round()` all scaled values on Android (sub-pixel font sizes = blurry text)
  - iOS: Large Title 34pt, Title 2 22pt, Body 17pt, Footnote 13pt, Caption 12pt
  - Android: Headline Large 32sp, Title Large 22sp, Body Large 16sp, Label Medium 12sp

- [ ] **Touch targets** — Minimum 48dp/pt everywhere (satisfies both platforms)

- [ ] **Touch feedback** — `Pressable`:
  - iOS: `style: ({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })`
  - Android: `android_ripple={{ color: 'rgba(255,255,255,0.1)' }}`

- [ ] **Card corners** — 12dp/pt consistently (M3 card spec, iOS compatible)

- [ ] **Navigation** — Expo Router native stack handles platform transitions automatically

- [ ] **Error retry** — "Retry" button on error states
- [ ] **Empty state** — "Content not available" message when sections array is empty

### Phase 6: Performance Verification & Hardening

**Goal:** Verify smooth performance on mid-range Android with 10+ sections. Fix any issues found.

Note: `VideoDecoderBudget` and `apollo3-cache-persist` are set up in Phase 1 (root layout). `expo-image` is used from Phase 3 onward. This phase is for profiling and fixing what the earlier phases missed.

#### Tasks

- [ ] **Profile on mid-range Android** — Test with Easter Experience (10+ sections, 3 VideoCarousels). Measure: scroll FPS, memory usage, decoder slot count, cold start time.
- [ ] **FlashList tuning** — Adjust `estimatedItemSize`, `drawDistance`, and `viewabilityConfig` thresholds based on profiling results.
- [ ] **Image audit** — Verify all `expo-image` instances use `recyclingKey`. Verify `priority="low"` on NavigationCarousel thumbnails.
- [ ] **Defensive video cleanup audit** — Verify all video players call `player.pause()` in unmount with try-catch (expo/expo#33804). Verify `useFocusEffect` pauses hero on detail navigation.
- [ ] **Gradient audit** — Grep for `"transparent"` in gradient arrays. Replace with `hexToRgba(targetColor, 0)`.
- [ ] **Dimensions audit** — Grep for `Dimensions.get()` at module scope. Replace with `useWindowDimensions()` hook.

## System-Wide Impact

### Interaction Graph

- `apps/mobile-v2/` → `@forge/graphql` (graphql() function only, query defined locally) → Strapi v5 GraphQL API
- `apps/mobile-v2/` → Apollo Client → InMemoryCache + AsyncStorage persistence → network fetch
- expo-video → Mux HLS URLs (validated via `validateStreamingUrl()`) → playback
- QuizButton WebView → nextstep.is iframe (domain-restricted)

### Error Propagation

- GraphQL errors → Apollo → `useExperience` returns `{ error }` → Error screen with Retry button
- Video streaming failures → expo-video error → poster image fallback
- Unknown `__typename` in normalizer → `null` + dev warning → silently skipped
- Invalid `sectionKey` route param → sanitized + error UI (not crash)

### State Lifecycle Risks

- Apollo cache persisted to AsyncStorage — stale data possible on cold start (mitigated by background refetch)
- Video players must release decoder slots on unmount — `VideoDecoderBudget` tracks this globally
- `ExperienceProvider` context holds section data — re-renders propagate to consumers on refetch (acceptable with single experience, infrequent fetches)

## Acceptance Criteria

### Functional Requirements

- [ ] Home screen renders VideoHero, NavigationCarousel, video cards, VideoCarousels, and MediaCollection from Easter Experience
- [ ] Every Section with a Video renders as a tappable full-width cinematic card
- [ ] VideoCarousel blocks render as titled horizontal scroll rows (poster images, no inline playback)
- [ ] Tapping a video card pushes to detail screen with player + Section content blocks
- [ ] All CMS-sourced URLs validated before use (streaming, action, image)
- [ ] BibleQuotesCarousel, RelatedQuestions (with CTA), QuizButton, Text, EasterDates all render correctly
- [ ] NavigationCarousel taps scroll to corresponding section in FlashList
- [ ] ALL block types in Easter Experience JSON have a renderer — deferred types get a silent no-op

### Non-Functional Requirements

- [ ] iOS: HIG-compliant (Dynamic Island safe area, system font, 44pt+ touch targets, tab bar)
- [ ] Android: M3-compliant (edge-to-edge, system font, 48dp touch targets, bottom nav)
- [ ] Platform-specific code: ~3-5 `Platform.select()` calls only
- [ ] Smooth scroll on mid-range Android (FlashList, no jank at 60fps)
- [ ] No video decoder OOM (VideoDecoderBudget limits concurrent players)
- [ ] Cold start < 100ms for returning users (Apollo cache persistence)

### Quality Gates

- [ ] Works on both iOS simulator and Android emulator
- [ ] Loads and renders both Easter and Christmas Experiences without code changes
- [ ] TypeScript strict mode, no `any` types
- [ ] gql.tada types validate against current CMS schema
- [ ] API token is read-only with minimal scope (public content only)

## Dependencies & Prerequisites

- Strapi v5 CMS running with GraphQL plugin and Experience content populated
- `@forge/graphql` codegen up-to-date (`optimizeDocumentNode: false` set)
- Expo SDK 54 environment
- EAS CLI for builds

## Risk Analysis & Mitigation

| Risk                                | Likelihood | Impact | Mitigation                                               |
| ----------------------------------- | ---------- | ------ | -------------------------------------------------------- |
| gql.tada query too large for Strapi | Low        | High   | Strapi maxLimit=100; increase in config/api.ts           |
| Android video decoder exhaustion    | Medium     | High   | VideoDecoderBudget + poster-only carousels               |
| expo-blur not working on Android    | Certain    | Low    | Platform fallback (dim overlay)                          |
| CMS schema change breaks query      | Medium     | High   | gql.tada catches at compile time                         |
| Large Experience (20+ sections)     | Low        | Medium | FlashList virtualization handles natively                |
| Native tabs unstable in SDK 54      | Certain    | Medium | Use standard JS tabs instead                             |
| API token in client bundle          | Certain    | Medium | Read-only scope, public content only                     |
| Unsigned Mux streaming URLs         | Medium     | Medium | `validateStreamingUrl()` + consider signed URLs post-MVP |

## Stretch Goals (Post-MVP)

### PR Preview via EAS Update

The current CI workflow (`.github/workflows/ci.yml`) has no EAS Update step — it only runs lint, typecheck, test, and build. Adding a PR preview job would let stakeholders scan a QR code on each PR to preview mobile-v2 changes in Expo Go.

**Proposed workflow job:**

```yaml
eas-update-mobile-v2:
  needs: affected
  if: >
    github.event_name == 'pull_request' &&
    contains(fromJson(needs.affected.outputs.services), '@forge/mobile-v2')
  runs-on: ubuntu-latest
  steps:
    - name: Checkout
      uses: actions/checkout@v6
    - name: Setup pnpm
      uses: pnpm/action-setup@v4
    - name: Setup Node
      uses: actions/setup-node@v6
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - name: Setup EAS
      uses: expo/expo-github-action@v8
      with:
        eas-version: latest
        token: ${{ secrets.EXPO_TOKEN }}
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    - name: Publish PR preview
      working-directory: apps/mobile-v2
      run: eas update --branch=pr-${{ github.event.number }} --message="PR #${{ github.event.number }}"
```

**Prerequisites:**

- `EXPO_TOKEN` secret configured in GitHub repo settings
- `eas init` run in `apps/mobile-v2/` to generate a unique `projectId`
- `runtimeVersion: { policy: "sdkVersion" }` in `app.json` for Expo Go compatibility (see learnings: eas-update-stakeholder-preview-setup)

**Notes:**

- Uses Turborepo's `affected` detection — only runs when `@forge/mobile-v2` files change
- Completely independent from `apps/mobile/` — different EAS project, different update branch
- The existing mobile app's CI is unaffected
- Consider adding a PR comment with the QR code via `expo/expo-github-action`'s built-in comment feature

### Other Stretch Goals

- **Deep linking** — Register `jesusfilm.org/watch/*` as universal links (iOS) / App Links (Android)
- **Locale detection** — Device locale with English fallback, matching the i18n-enabled CMS content
- **Apollo cache persistence to disk** — Already in Phase 1 plan, but offline-first behavior (showing stale content when offline) is a stretch enhancement
- **Mux signed URLs** — Server-side signing endpoint for streaming URL security

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-04-01-mobile-experience-redesign-requirements.md](docs/brainstorms/2026-04-01-mobile-experience-redesign-requirements.md) — Key decisions: curated gallery (not catalog), full-width cinematic cards in CMS order, NavigationCarousel as quick-access, VideoCarousels as horizontal rows, no invented metrics

### Internal References

- SDUI pipeline: `apps/mobile/src/lib/sectionModels.ts`, `sectionMapper.ts`, `experienceService.ts`
- Section renderers: `apps/mobile/src/components/sections/`
- Web fragments: `apps/web/src/lib/fragments/`
- Apollo pattern: `apps/mobile/src/lib/apolloClient.ts`
- Env validation: `apps/mobile/src/env.ts`

### Institutional Learnings (Applied)

- `docs/solutions/mobile/android-lazy-section-viewport-gating-oom-fix.md` → VideoDecoderBudget
- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` → Hero layout + blur fallback
- `docs/solutions/mobile/react-native-scrollview-touch-event-z-index-fix.md` → pointerEvents pass-through
- `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md` → hexToRgba pattern
- `docs/solutions/mobile/text-renderer-paragraph-type-mismatch.md` → string[] validation
- `docs/solutions/mobile/quiz-button-section-webview-modal-pipeline.md` → 4-layer atomicity
- `docs/solutions/mobile/videorenderer-mute-button-offscreen-detection.md` → Android mute button
- `docs/solutions/mobile/translucent-section-backgrounds-with-react-context.md` → HeroSectionContext
- `docs/solutions/mobile/media-collection-overlay-carousel-pipeline.md` → Duplicate fragment pitfall
- `docs/solutions/mobile/eas-update-stakeholder-preview-setup.md` → Env config patterns
- `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` → Lazy SDK init
- `docs/solutions/platform/adding-new-apps.md` → Monorepo scaffolding
- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` → gql.tada migration rationale
- `docs/solutions/cms/codegen-strips-optional-graphql-variables.md` → optimizeDocumentNode fix

### Stitch Mockups (4th Iteration — HIG/M3 Compliant)

- Project: `Easter Mobile Redesign — iOS + Android` (projects/4168049777513341773)
- iOS Home (HIG): `ab10cbd749e74b3fbdfca6fe74b1bae9`
- Android Home (M3): `5af129a2e68947648310f5553867d1f9`
- iOS Detail (HIG): `8527727701ed4b2485e6b67f9072d9c8`
- Android Detail (M3): `567f8a50736146da809301dc48563cc8`
