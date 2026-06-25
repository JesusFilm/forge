---
title: "Expo TV Platform Setup in an SDUI Monorepo"
date: "2026-04-10"
last_updated: "2026-06-25"
category: best-practices
module: tv-app
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Adding Apple TV or Android TV to a monorepo with an existing Expo/React Native SDUI pipeline"
  - "Porting an SDUI dispatcher to a 10-foot UI (TV, kiosk, car)"
  - "Designing a TV home screen against a CMS modeled for single-Experience deep-links"
  - "Debugging New Architecture crashes on tvOS with react-native-tvos"
  - "FlatList rendering zero-height items on tvOS"
  - "Android TV emulator can't reach host localhost"
tags:
  - expo
  - tv
  - react-native
  - sdui
  - monorepo
  - focus-management
  - architecture
  - new-architecture
  - android-tv
---

# Expo TV Platform Setup in an SDUI Monorepo

## Context

A monorepo has a working mobile Expo app (SDK 54, React Native 0.81.5) and a web Next.js app, both consuming a Server-Driven UI pipeline: admin GraphQL -> gql.tada -> normalizer -> dispatcher -> renderers. The team wanted to add Apple TV and Android TV support without duplicating SDUI logic or diverging from the existing content model.

The key challenge was uncertainty about whether Expo SDK 54 supported TV targets at all, combined with the architectural question of how to share the SDUI pipeline across a fundamentally different interaction model (D-pad focus vs touch).

## Guidance

### 1. Expo SDK 54 TV Toolchain

Expo SDK 54 supports TV via `react-native-tvos` and the `@react-native-tvos/config-tv` plugin. No ejection required.

Install `react-native-tvos` as an npm alias:

```jsonc
// apps/tv/package.json
{
  "dependencies": {
    "react-native": "npm:react-native-tvos@0.81-stable",
  },
}
```

Add the config plugin:

```jsonc
// apps/tv/app.json
{
  "expo": {
    "plugins": [["@react-native-tvos/config-tv", { "isTV": true }]],
  },
}
```

Build for TV:

```bash
EXPO_TV=1 npx expo prebuild --clean
```

Key facts:

- expo-video has tvOS support (expo/expo PR #29560, merged June 2024)
- Expo Router works on TV (confirmed by ExpoRouterTV demo project)
- No Expo Go on TV -- dev-client builds only
- TV-specific file extensions supported: `*.tv.tsx`, `*.ios.tv.tsx`, `*.android.tv.tsx`
- `npx expo prebuild --clean` is required when switching between phone and TV targets

**tvOS deployment target:** The `@react-native-tvos/config-tv` plugin defaults to tvOS 13.4, but Expo SDK 54 modules require tvOS 15.1+. Set `tvosDeploymentTarget` explicitly:

```jsonc
// apps/tv/app.json
{
  "plugins": [
    [
      "@react-native-tvos/config-tv",
      { "isTV": true, "tvosDeploymentTarget": "16.0" },
    ],
  ],
}
```

Without this, the build fails with: `compiling for tvOS 13.4, but module 'Expo' has a minimum deployment target of tvOS 15.1`.

### 1b. Disable New Architecture on tvOS

React Native's New Architecture (`newArchEnabled: true`) causes a hard crash on tvOS with react-native-tvos 0.81:

```
Failed to call into JavaScript module method RCTEventEmitter.receiveEvent().
Module has not been registered as callable.
```

This is a known incompatibility. Disable it in `app.json`:

```jsonc
// apps/tv/app.json
{
  "expo": {
    "newArchEnabled": false,
  },
}
```

Do not debug the event emitter error — it is not fixable without upstream react-native-tvos changes. The Legacy Architecture works correctly for TV.

### 1c. Expo Dev Client on TV Simulator

`expo run:ios` builds the app successfully but fails to detect the installed app on the TV Simulator:

```
CommandError: No development build (org.jesusfilm.forgetv) for this project is installed.
```

The app IS installed — the Expo CLI's tvOS Simulator detection is broken. Use a two-terminal workaround:

**Terminal 1** — start Metro bundler:

```bash
EXPO_TV=1 npx expo start --clear
```

**Terminal 2** — launch via deep link:

```bash
xcrun simctl openurl <simulator-id> \
  "exp+<slug>://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

Get the simulator ID from `xcrun simctl list devices | grep "Apple TV"`. The first launch shows an "Open in forge-tv?" dialog — accept it once, subsequent launches auto-connect.

### 1d. Android TV Localhost Resolution

The Android emulator cannot reach the host machine's `localhost`. Detect the platform and swap:

```typescript
// apps/tv/src/lib/config.ts
import { Platform } from "react-native"

export function getGraphQLUrl(): string {
  const url = env.EXPO_PUBLIC_GRAPHQL_URL
  if (__DEV__ && Platform.OS === "android" && url.includes("localhost")) {
    return url.replace("localhost", "10.0.2.2")
  }
  return url
}
```

This is a known Android emulator behavior — `10.0.2.2` maps to the host machine's loopback interface.

### 2. Separate App, Shared Logic

Create `apps/tv/` as a new Expo app -- do NOT add TV as a platform target inside the mobile app. Touch UX assumptions (gestures, small screen, portrait) conflict with 10-foot TV UX (D-pad, focus rings, landscape).

```
apps/
  mobile/       # touch app -- do not modify for TV
  tv/           # new Expo app for Apple TV + Android TV
packages/
  admin-graphql/  # shared gql.tada admin GraphQL client (@forge/admin-graphql)
```

Import normalizer and queries from mobile via pnpm workspace paths (or copy with a sync comment). Avoids copy-and-drift -- an admin GraphQL schema change propagates after codegen. Renderers are rewritten from scratch for TV.

### 3. Home Screen Data Model

Mobile SDUI apps load one Experience at a time. A TV home screen needs multiple Experiences as a browsable rail. Two shapes have shipped in `apps/tv`:

- **Static hero shape (original, still valid for mobile)**: fetch the `isHomepage` Experience via `GET_WATCH_EXPERIENCE`, render its `VideoHero` block full-width at the top; fetch all Experiences via `LIST_EXPERIENCES` for the rail below.
- **Focus-driven hero shape (current `apps/tv`)**: `LIST_EXPERIENCES` on TV **intentionally diverges** from mobile's lighter shape and carries each Experience's `VideoHero` block inline. The hero then swaps its poster/title/video to whichever Experience is focused in the rail. See `apps/tv/src/lib/queries.ts` for the header comment warning against re-syncing from mobile. The hero is **non-interactive** — the rail owns all focus. See `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` for the full pattern.

No new CMS _content types_ were needed for either shape — both are driven by the existing Experience model plus its `VideoHero` block.

### 4. Structural Renderers Are Mandatory

Most CMS blocks are nested inside structural wrappers (`SectionWrapper`, `Container`). If these aren't handled in the dispatcher, nested content silently disappears -- no error, just blank space.

Always implement:

- `SectionWrapperRenderer` -- renders children, passes layout props
- `ContainerRenderer` -- renders children, passes width/padding props
- `PlaceholderRenderer` -- logs unhandled block types in dev, returns null

```typescript
// PlaceholderRenderer.tsx
export function PlaceholderRenderer({ block }: BlockProps) {
  if (__DEV__) {
    console.warn(`[TV] Unhandled block type: ${block.kind}`)
  }
  return null
}
```

### 5. Day-1 Spike Pattern

Before building any features, validate the toolchain end-to-end with a throwaway spike:

1. Minimal Expo TV app (single screen)
2. Build for Apple TV Simulator
3. Confirm expo-video plays an HLS stream
4. Confirm D-pad reaches a focusable element
5. Go/no-go gate -- only proceed if all pass

This catches blocking platform issues before any UI or data layer investment.

### 6. Focus Management

Focus management is the defining TV UX challenge.

**Constrain D-pad navigation within rails:**

```tsx
import { TVFocusGuideView } from 'react-native';

<TVFocusGuideView>
  <FlatList horizontal data={items} renderItem={...} />
</TVFocusGuideView>
```

**Per-session focus memory (in-memory only):**

```typescript
const focusMemory = new Map<string, number>() // railId -> itemIndex
```

**Every interactive element needs a visible focus ring** -- the default highlight is insufficient at 10-foot viewing distance. Use `Animated.spring` (not state-toggled transforms) for smooth 60fps focus transitions. Split focusable cards into an outer `Animated.View` (`overflow: "visible"` for shadow/transform) and an inner `View` (`overflow: "hidden"` for content clipping with `borderRadius`). When cards are inside horizontal FlatList rails, add `paddingVertical` to item wrapper Views — `contentContainerStyle` padding does not expand FlatList's clip boundary. See `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md`.

**Overlay VideoView focus pattern:** In fullscreen video overlays where `TVFocusGuideView` with `trapFocusUp/Down/Left/Right` already constrains D-pad navigation, do NOT wrap `VideoView` in `<View pointerEvents="none">`. The wrapper blocks AVPlayerLayer rendering on tvOS (black screen, controls work). Use `focusable={false}` directly on the `VideoView` instead. The `pointerEvents="none"` wrapper is only correct for inline VideoViews without focus trapping. See `docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md`.

**Known issue:** Focus lost on back-navigation (react-native-tvos issue #852). For a screen with one fixed control to restore, set a one-shot `hasTVPreferredFocus` on re-entry. For a screen with **many** focusables (rails, hero, tabs) where the user should land back on the _exact_ element, use a screen-level focus memory (`requestTVFocus` on the remembered node, on `useFocusEffect` re-entry) instead — see [`../design-patterns/tv-back-nav-focus-restoration-screen-focus-memory.md`](../design-patterns/tv-back-nav-focus-restoration-screen-focus-memory.md).

**Focus-driven background media heroes (rail-owns-focus pattern):** If a hero reacts to rail focus with a background `VideoView`, prefer making the hero subtree fully non-interactive (no `Pressable`/`focusable`/`hasTVPreferredFocus` anywhere in the hero) and letting the rail's `TVFocusGuideView autoFocus` own focus outright. Wrapping the hero in `TVFocusGuideView` with `destinations` is fragile once the video is actively playing — `VideoView` continues to intercept focus despite `focusable={false}` + `pointerEvents="none"` + `isTVSelectable={false}`. See `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` for the full pattern (including the poster-hold technique that hides the black flash during HLS source swap).

### 7. FlatList Zero-Height Items on tvOS

FlatList with complex SDUI block content may render all items at zero height, producing a completely blank screen despite correct data. This is a tvOS-specific layout measurement issue with dynamically sized items.

**Workaround:** Use `ScrollView` with mapped items instead of FlatList for the experience detail feed:

```tsx
// Instead of FlatList (blank screen on tvOS):
<FlatList data={sections} renderItem={({ item }) => <SectionDispatcher section={item} />} />

// Use ScrollView (works reliably):
<ScrollView>
  {sections.map((section, index) => (
    <View key={`${section.kind}-${section.id}-${index}`}>
      <SectionDispatcher section={section} />
    </View>
  ))}
</ScrollView>
```

Horizontal FlatList (used in ContentRail) works correctly — the issue is specific to vertical FlatList with variable-height SDUI content.

Vertical FlatList IS viable on tvOS when rows are **fixed-height** with
`getItemLayout` provided (no dynamic measurement) — the watch menus virtualize
2,000+ fixed-height rows this way. See
`docs/solutions/best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md`
for that configuration and its own pitfalls (Yoga maxHeight, one-shot
`hasTVPreferredFocus`, mount-once `initialScrollIndex`).

### 8. GraphQL Fragment Alias Pitfalls

When gql.tada fragments use field aliases (e.g., `videoRef: video`), the normalized SDUI block carries the **aliased** name. Renderers must read the alias, not the original field name:

```typescript
// Fragment in queries.ts
fragment VideoSectionFields on ComponentSectionsVideo {
  videoRef: video { documentId title images { videoStill } }
  videoTitle: title
}

// Renderer — CORRECT: use aliased names
const video = section.videoRef   // ✓
const title = section.videoTitle // ✓

// Renderer — WRONG: original names are undefined
const video = section.video      // ✗ undefined at runtime
const title = section.title      // ✗ undefined at runtime
```

This is silent — TypeScript doesn't catch it because `NormalizedBlock` uses `[key: string]: unknown`. The only symptom is blank rendering with no errors. Verify field names against the actual fragment definitions in `queries.ts`.

## Why This Matters

- **Prevents copy-and-drift**: Sharing normalizer/queries via workspace paths means CMS changes propagate automatically
- **Prevents silent content gaps**: Missing structural renderers cause sections to vanish without errors -- the hardest SDUI bug class to diagnose
- **Prevents wasted effort**: Day-1 spike surfaces platform blockers in hours, not weeks
- **Focus bugs are invisible in desktop testing**: Must test on TV Simulator with simulated remote
- **New Arch crash is a dead end**: The `RCTEventEmitter.receiveEvent()` error has no workaround — only disabling New Architecture resolves it. Without this knowledge, debugging takes days
- **tvOS deployment target is a build blocker**: The default (13.4) fails silently deep in the Xcode build — not obvious from the error output
- **GraphQL alias mismatch is silent**: Renders blank content with no errors or warnings — only discoverable by comparing fragment definitions against renderer field access
- **Validates the SDUI architecture**: The same CMS content, GraphQL fragments, and normalizer serve mobile, web, and TV with shared pipeline code

## When to Apply

- Adding any new platform (TV, kiosk, car) to a monorepo with an existing SDUI pipeline
- Expo SDK 54+ with react-native-tvos 0.81-stable
- Porting an SDUI dispatcher to a 10-foot or non-touch UI
- Designing a TV home screen against a CMS modeled for single-Experience views
- Debugging "RCTEventEmitter.receiveEvent() not registered" on tvOS — disable New Architecture
- Debugging blank screens on tvOS after data loads successfully — check FlatList vs ScrollView
- Android TV emulator returning "Network request failed" — swap localhost to 10.0.2.2
- SDUI renderer showing blank content with no errors — check GraphQL fragment alias names

## Examples

**Correct monorepo structure:**

```
apps/mobile/      # untouched
apps/tv/          # new app -- shares logic, rewrites renderers
  app/
    _layout.tsx
    index.tsx                 # home: hero + experiences rail
    experience/[slug].tsx     # detail: vertical section feed
  src/
    components/sections/      # all new TV renderers
    lib/                      # imports normalizer + queries from mobile-v2
```

**Incorrect approach -- do not add TV target to mobile app:**

```jsonc
// apps/mobile/app.json -- DO NOT DO THIS
{
  "expo": {
    "platforms": ["ios", "android", "tvos"],
  },
}
```

**Home screen composition using existing queries:**

```typescript
const { data: homepage } = useExperience("homepage")
const { data: experiences } = useListExperiences()

const heroBlock = homepage?.blocks.find((b) => b.kind === "videoHero")
const rail = experiences.map((e) => ({
  title: e.title,
  image: e.ogImage,
  slug: e.slug,
}))
```

## Related

- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` -- focus-driven hero shape (Section 3 above) and rail-owns-focus pattern (Section 6 above); supersedes earlier guidance to wrap the hero in `TVFocusGuideView` with destinations
- `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md` -- baseline SDUI scaffold pattern (mobile-v2); TV diverges with react-native-tvos alias and EXPO_TV=1
- `docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md` -- Metro/pnpm singleton resolution required for apps/tv from day one
- `docs/solutions/build-errors/expo-doctor-sdk54-health-checks-mobile-v2-20260409.md` -- Expo SDK 54 health checks apply verbatim to TV builds
- `docs/solutions/mobile/sdui-experience-provider-block-index-parent-child-loss.md` -- ExperienceProvider `siblingContent` propagation must be preserved in TV port
- `docs/solutions/mobile/experience-selection-provider-library-tab-pattern-2026-04-08.md` -- `isHomepage` resolution pattern used for TV home screen hero
- `docs/solutions/best-practices/playlist-video-player-sdui-mobile-20260409.md` -- `useVideoPlayer` stability patterns; TV adds remote control event mapping
- `docs/solutions/platform/adding-new-apps.md` -- monorepo scaffold checklist; TV uses EAS Build instead of Railway
- `docs/solutions/build-errors/eas-managed-react-native-tvos-build-gotchas-20260615.md` -- the EAS **cloud-build** + TestFlight + app-icon layer this doc leaves open. This doc covers local prebuild / dev-client; that one covers the managed-workflow provisioning-profile-resolves-to-iOS failure, the Android `ic_launcher` duplicate-resource collision, and `appleTVImages` asset constraints
- `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md` -- `encodeURIComponent` for `experience/[slug]` route params
- `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` -- full requirements document for the TV prototype
- Roadmap: feat-072 through feat-076 -- implementation tickets
