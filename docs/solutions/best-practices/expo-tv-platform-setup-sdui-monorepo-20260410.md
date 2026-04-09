---
title: "Expo TV Platform Setup in an SDUI Monorepo"
date: "2026-04-10"
category: best-practices
module: tv-app
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Adding Apple TV or Android TV to a monorepo with an existing Expo/React Native SDUI pipeline"
  - "Porting an SDUI dispatcher to a 10-foot UI (TV, kiosk, car)"
  - "Designing a TV home screen against a CMS modeled for single-Experience deep-links"
tags:
  - expo
  - tv
  - react-native
  - sdui
  - monorepo
  - focus-management
  - architecture
---

# Expo TV Platform Setup in an SDUI Monorepo

## Context

A monorepo has a working mobile Expo app (SDK 54, React Native 0.81.5) and a web Next.js app, both consuming a Server-Driven UI pipeline: Strapi CMS -> GraphQL -> gql.tada -> normalizer -> dispatcher -> renderers. The team wanted to add Apple TV and Android TV support without duplicating SDUI logic or diverging from the existing content model.

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

### 2. Separate App, Shared Logic

Create `apps/tv/` as a new Expo app -- do NOT add TV as a platform target inside the mobile app. Touch UX assumptions (gestures, small screen, portrait) conflict with 10-foot TV UX (D-pad, focus rings, landscape).

```
apps/
  mobile-v2/    # touch app -- do not modify for TV
  tv/           # new Expo app for Apple TV + Android TV
packages/
  graphql/      # shared typed GraphQL client (already exists)
```

Import normalizer and queries from mobile-v2 via pnpm workspace paths. Avoids copy-and-drift -- a CMS schema change propagates automatically after codegen. Renderers are rewritten from scratch for TV.

### 3. Home Screen Data Model

Mobile SDUI apps load one Experience at a time. A TV home screen needs multiple Experiences as a browsable rail. Use existing queries:

- **Hero**: Fetch the `isHomepage` Experience via `GET_WATCH_EXPERIENCE`, render its `VideoHero` block full-width at the top
- **Rail**: Fetch all Experiences via `LIST_EXPERIENCES` (returns ogImage + title), render as horizontal cards

No new CMS queries or content types needed.

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

**Every interactive element needs a visible focus ring** -- the default highlight is insufficient at 10-foot viewing distance.

**Known issue:** Focus lost on back-navigation (react-native-tvos issue #852). Workaround: restore focus via `hasTVPreferredFocus` in a `useEffect` on screen focus.

## Why This Matters

- **Prevents copy-and-drift**: Sharing normalizer/queries via workspace paths means CMS changes propagate automatically
- **Prevents silent content gaps**: Missing structural renderers cause sections to vanish without errors -- the hardest SDUI bug class to diagnose
- **Prevents wasted effort**: Day-1 spike surfaces platform blockers in hours, not weeks
- **Focus bugs are invisible in desktop testing**: Must test on TV Simulator with simulated remote

## When to Apply

- Adding any new platform (TV, kiosk, car) to a monorepo with an existing SDUI pipeline
- Expo SDK 54+ with react-native-tvos 0.81-stable
- Porting an SDUI dispatcher to a 10-foot or non-touch UI
- Designing a TV home screen against a CMS modeled for single-Experience views

## Examples

**Correct monorepo structure:**

```
apps/mobile-v2/   # untouched
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
// apps/mobile-v2/app.json -- DO NOT DO THIS
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

- `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md` -- baseline SDUI scaffold pattern (mobile-v2); TV diverges with react-native-tvos alias and EXPO_TV=1
- `docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md` -- Metro/pnpm singleton resolution required for apps/tv from day one
- `docs/solutions/build-errors/expo-doctor-sdk54-health-checks-mobile-v2-20260409.md` -- Expo SDK 54 health checks apply verbatim to TV builds
- `docs/solutions/mobile/sdui-experience-provider-block-index-parent-child-loss.md` -- ExperienceProvider `siblingContent` propagation must be preserved in TV port
- `docs/solutions/mobile/experience-selection-provider-library-tab-pattern-2026-04-08.md` -- `isHomepage` resolution pattern used for TV home screen hero
- `docs/solutions/best-practices/playlist-video-player-sdui-mobile-20260409.md` -- `useVideoPlayer` stability patterns; TV adds remote control event mapping
- `docs/solutions/platform/adding-new-apps.md` -- monorepo scaffold checklist; TV uses EAS Build instead of Railway
- `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md` -- `encodeURIComponent` for `experience/[slug]` route params
- `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` -- full requirements document for the TV prototype
- Roadmap: feat-072 through feat-076 -- implementation tickets
