---
title: "feat: Library tab experience selector"
type: feat
status: completed
date: 2026-04-08
origin: docs/brainstorms/library-tab-experience-selector-requirements.md
---

# feat: Library tab experience selector

## Overview

Replace the Library tab placeholder with a scrollable experience browser. Users tap an experience card to switch the Home tab's SDUI content. The selected experience persists across app restarts via AsyncStorage.

## Problem Frame

The mobile app hardcodes `DEFAULT_SLUG = "easter"` in `ExperienceShell.tsx`. CMS authors create multiple Experiences but users have no way to browse or switch between them. The Library tab exists as a placeholder — this plan turns it into the experience switcher. (see origin: `docs/brainstorms/library-tab-experience-selector-requirements.md`)

## Requirements Trace

- R1. Display all published CMS Experience objects in the Library tab
- R2. Each card shows thumbnail (`ogImage`), title, and description (`metaDescription`)
- R3. Tapping a card sets the active experience and navigates to the Home tab
- R4. Home re-renders with the selected experience's SDUI content
- R5. The selected experience persists across app restarts (AsyncStorage)
- R6. The currently active experience is visually indicated in the Library list
- R7. Loading and error states are handled gracefully
- R8. On first launch, default to `isHomepage: true` experience or first in list

## Scope Boundaries

- No search or filtering in the Library (future iteration)
- No offline-first caching beyond Apollo's existing cache
- No experience preview/detail screen
- No favoriting or bookmarking

## Context & Research

### Relevant Code and Patterns

| File                                                 | Role                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `apps/mobile-v2/src/contexts/ExperienceShell.tsx`    | Hardcoded slug — needs dynamic state                    |
| `apps/mobile-v2/src/contexts/ExperienceProvider.tsx` | Already accepts any experience — no changes needed      |
| `apps/mobile-v2/src/hooks/useExperience.ts`          | Already accepts slug param — no changes needed          |
| `apps/mobile-v2/app/(tabs)/library.tsx`              | Placeholder — replace with experience list              |
| `apps/mobile-v2/app/(tabs)/_layout.tsx`              | Tab definitions — no changes needed                     |
| `apps/mobile-v2/app/_layout.tsx`                     | Root layout — insert new provider above ExperienceShell |
| `apps/mobile-v2/src/lib/queries.ts`                  | Add new lightweight listing query                       |
| `apps/mobile-v2/src/lib/apolloClient.ts`             | Lazy singleton, `cache-and-network` — no changes needed |
| `apps/mobile-v2/src/lib/color.ts`                    | Color tokens for consistent styling                     |

### Institutional Learnings

- **apollo3-cache-persist is incompatible with Apollo Client v4** — do not use for persistence. Use `@react-native-async-storage/async-storage` directly for slug persistence only.
- **`cache-and-network` fetch policy** — already in use by `useExperience`. When switching to a previously visited experience, Apollo serves cached data immediately while refetching in background. Good UX for free.
- **GlassView `isInteractive` causes white flash on tab switch** — avoid `isInteractive` on any glass effects in Library cards; let `Pressable` own touch handling.
- **FlashList patterns** — never set `backgroundColor` on `contentContainerStyle`; apply opaque backgrounds per-item.

## Key Technical Decisions

- **Separate selection context**: Create `ExperienceSelectionProvider` above `ExperienceShell`. This is structurally required because the Library tab (a sibling of Home inside the tab navigator) needs to read and write the current slug, while `ExperienceShell` sits above both tabs. A shared context above `ExperienceShell` is the only way for Library to communicate the selection upward.

- **AsyncStorage for persistence**: The app has zero persistence today. Adding `@react-native-async-storage/async-storage` for a single key (`selectedExperienceSlug`) is the lightest path. No need for a full state management library.

- **Lightweight listing query**: Fetch only metadata (`documentId`, `slug`, `title`, `metaDescription`, `ogImage`) — never `blocks`. The blocks dynamic zone is expensive and only needed when rendering the home page.

- **Programmatic tab navigation**: Use Expo Router's `router.navigate("/(tabs)/")` to switch to Home tab after selection. This is the standard Expo Router pattern for cross-tab navigation.

## Open Questions

### Resolved During Planning

- **Where does selection state live?** A new `ExperienceSelectionProvider` context wrapping `ExperienceShell` in the root layout. Exposes `{ currentSlug, selectExperience }`.
- **How to avoid flash on cold start?** Read AsyncStorage before first render. Show the app loading state until the persisted slug is resolved, then initialize `ExperienceShell` with the correct slug.

### Deferred to Implementation

- **Exact card dimensions and spacing** — will be refined during implementation based on how it looks on device.
- **Pagination** — unlikely needed (few experiences expected), but if the CMS grows, standard Apollo pagination can be added later.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
Provider tree (root _layout.tsx):
  ApolloProvider
    SafeAreaProvider
      ExperienceSelectionProvider  ← NEW (holds slug state + AsyncStorage persistence)
        ExperienceShell            ← MODIFIED (reads slug from selection context)
          ExperienceProvider       ← UNCHANGED
            Stack
              (tabs)
                Home               ← UNCHANGED (auto re-renders via context)
                Library            ← NEW UI (lists experiences, calls selectExperience)
              video/[sectionKey]   ← UNCHANGED

Data flow on experience switch:
  Library tap → selectExperience(slug) → persist to AsyncStorage
    → ExperienceSelectionProvider re-renders with new slug
      → ExperienceShell sees new slug, calls useExperience(newSlug)
        → Apollo fetches (or serves cache) → ExperienceProvider updates
          → Home tab re-renders with new content
    → router.navigate("/(tabs)/") → tab switches to Home
```

## Implementation Units

- [x] **Unit 1: Add `LIST_EXPERIENCES` GraphQL query**

  **Goal:** Define a lightweight query for fetching experience metadata without blocks.

  **Requirements:** R1, R2

  **Dependencies:** None

  **Files:**
  - Modify: `apps/mobile-v2/src/lib/queries.ts`

  **Approach:**
  - Add a new `LIST_EXPERIENCES` query selecting `documentId`, `slug`, `title`, `metaDescription`, `isHomepage`, and `ogImage { url alternativeText width height }`.
  - Accept `$locale: I18NLocaleCode!` parameter (matches existing query pattern).
  - No filters — fetch all published experiences.

  **Patterns to follow:**
  - `GET_WATCH_EXPERIENCE` query structure in the same file
  - `graphql()` function from `@forge/graphql`

  **Test scenarios:**
  - Happy path: Query returns array of experience objects with all requested fields
  - Edge case: Experience with null `ogImage` — query still returns without error
  - Edge case: Experience with null `metaDescription` — field is nullable, should return null

  **Verification:**
  - TypeScript compiles. `ResultOf<typeof LIST_EXPERIENCES>` resolves to the expected shape via gql.tada.

- [x] **Unit 2: Install AsyncStorage and create `ExperienceSelectionProvider`**

  **Goal:** Add persistent experience selection state management.

  **Requirements:** R5, R8

  **Dependencies:** None (can be done in parallel with Unit 1)

  **Files:**
  - Modify: `apps/mobile-v2/package.json` (add `@react-native-async-storage/async-storage`)
  - Create: `apps/mobile-v2/src/contexts/ExperienceSelectionProvider.tsx`

  **Approach:**
  - Install `@react-native-async-storage/async-storage`.
  - Create `ExperienceSelectionProvider` context that:
    - On mount, reads persisted slug from AsyncStorage key `selectedExperienceSlug`.
    - Exposes `{ currentSlug: string | null, selectExperience: (slug: string) => void, isReady: boolean }`.
    - `isReady` is `false` until AsyncStorage read completes (prevents flash).
    - `selectExperience` updates state and writes to AsyncStorage.
    - When no persisted slug exists (`null`), `currentSlug` stays `null` — the consumer (`ExperienceShell`) decides the default.

  **Patterns to follow:**
  - `ExperienceProvider.tsx` context pattern (createContext, provider component, custom hook)
  - Existing `useRef` + lazy init pattern in `apolloClient.ts`

  **Test scenarios:**
  - Happy path: Provider reads persisted slug on mount and exposes it via context
  - Happy path: `selectExperience("christmas")` updates state and persists to AsyncStorage
  - Edge case: No persisted value (first launch) — `currentSlug` is `null`, `isReady` becomes `true`
  - Edge case: AsyncStorage read fails — treat as first launch (null slug), `isReady` still becomes `true`
  - Integration: Child component calling `selectExperience` triggers re-render with new slug

  **Verification:**
  - Context provides correct slug after mount. Slug persists across provider remounts (simulating app restart).

- [x] **Unit 3: Update `ExperienceShell` to use dynamic slug**

  **Goal:** Replace the hardcoded `"easter"` slug with the selection context value.

  **Requirements:** R4, R8

  **Dependencies:** Unit 1, Unit 2

  **Files:**
  - Modify: `apps/mobile-v2/src/contexts/ExperienceShell.tsx`
  - Modify: `apps/mobile-v2/app/_layout.tsx` (wrap `ExperienceShell` with `ExperienceSelectionProvider`)

  **Approach:**
  - `ExperienceShell` reads `currentSlug` and `isReady` from `useExperienceSelection()`.
  - While `!isReady`, render nothing (return `null`). This blocks the entire subtree until AsyncStorage resolves (~<10ms), preventing any flash of wrong content.
  - When `currentSlug` is `null` (first launch), `ExperienceShell` fires `LIST_EXPERIENCES` to find the experience with `isHomepage: true` (or the first item). Once resolved, it calls `selectExperience(resolvedSlug)` to persist the default and proceeds to fetch the full experience. This satisfies R8 without hardcoding a slug.
  - Remove the `DEFAULT_SLUG` constant.
  - In `app/_layout.tsx`, insert `ExperienceSelectionProvider` above `ExperienceShell` in the provider tree.

  **Patterns to follow:**
  - Existing provider wrapping pattern in `app/_layout.tsx`

  **Test scenarios:**
  - Happy path: Shell fetches experience matching the slug from selection context
  - Happy path: Changing the selection context slug triggers a refetch with the new slug
  - Edge case: `currentSlug` is null — fires LIST_EXPERIENCES to resolve default, persists it, then fetches full experience
  - Edge case: `isReady` is false — returns null (blocks subtree), does not fetch with undefined slug
  - Edge case: LIST_EXPERIENCES returns no experiences — renders error state

  **Verification:**
  - Home tab renders the experience matching the persisted slug. Changing the slug via context causes Home to re-render with new content.

- [x] **Unit 4: Build Library tab UI with experience selection**

  **Goal:** Replace the placeholder Library tab with a scrollable experience list. Tapping a card sets the active experience and navigates to the Home tab.

  **Requirements:** R1, R2, R3, R4, R6, R7

  **Dependencies:** Unit 1, Unit 2, Unit 3

  **Files:**
  - Modify: `apps/mobile-v2/app/(tabs)/library.tsx`

  **Approach:**
  - Use `useQuery(LIST_EXPERIENCES, { variables: { locale: "en" } })` with `cache-and-network` fetch policy.
  - Render with `FlashList` for virtualization (consistent with home screen pattern).
  - Each card: `expo-image` thumbnail, title text, description text. Use `Pressable` for touch.
  - Visually indicate the active experience by comparing each card's slug against `currentSlug` from `useExperienceSelection()`. Use an accent border or badge.
  - On card press: call `selectExperience(slug)` then `router.navigate("/(tabs)/")` to switch to Home. If the tapped experience is already active, skip `selectExperience` and just navigate.
  - Handle loading state with skeleton/placeholder cards.
  - Handle error state with message and retry button.
  - Handle empty list with "No experiences available" message.
  - Apply dark theme styling using color tokens from `src/lib/color.ts`.
  - Use `useSafeAreaInsets()` for top padding.
  - Validate image URLs via `resolveImageUrl` before passing to `expo-image`.
  - Cards without `ogImage` show a fallback gradient background.

  **Patterns to follow:**
  - `CuratedHomeLayout.tsx` FlashList usage pattern
  - `VideoCardRenderer.tsx` card styling and `expo-image` usage
  - Color tokens from `src/lib/color.ts`
  - `Pressable` for touch targets with `accessibilityRole` and `accessibilityLabel`
  - Expo Router `useRouter()` and `router.navigate()` for programmatic tab navigation

  **Test scenarios:**
  - Happy path: Library renders a list of experience cards with correct title, description, and image
  - Happy path: Active experience card shows visual indicator
  - Happy path: Tapping a non-active experience updates the slug and navigates to Home
  - Happy path: Home tab renders the newly selected experience content
  - Edge case: Experience with no `ogImage` — card renders with fallback visual
  - Edge case: Experience with no `metaDescription` — card renders title only, no crash
  - Edge case: Tapping the already-active experience navigates to Home without calling selectExperience
  - Error path: Query fails — error message with retry button shown
  - Edge case: Empty experience list — "No experiences available" message
  - Integration: Full flow — tap card in Library → Home tab shows loading briefly → new experience renders

  **Verification:**
  - Library tab shows all CMS experiences. Active experience is visually distinct. Tapping an experience switches to Home showing that experience's content. The slug persists across app restarts.

## System-Wide Impact

- **Interaction graph:** `ExperienceSelectionProvider` → `ExperienceShell` → `ExperienceProvider` → all section renderers. The Library tab writes to the selection context; the Home tab reads from the experience context downstream. No other existing components are affected.
- **Error propagation:** Library query errors stay local to the Library tab. Experience fetch errors propagate through `ExperienceProvider` to `HomeScreen`, which already handles them.
- **State lifecycle risks:** AsyncStorage write is fire-and-forget (best effort). If it fails, the app still works — just won't remember the selection on next launch. No partial-write concern since it's a single atomic key.
- **API surface parity:** The web app (`apps/web`) also consumes Experiences but has its own routing — no parity concern.
- **Unchanged invariants:** `ExperienceProvider`, `useExperience`, normalizer, all section renderers, video detail route — all unchanged. The new selection context is purely additive above `ExperienceShell`.

## Risks & Dependencies

| Risk                                                     | Mitigation                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| AsyncStorage read blocks first render                    | `isReady` flag prevents rendering until resolved; AsyncStorage reads are typically <10ms   |
| Few experiences in CMS makes Library feel empty          | Not a technical risk — CMS content will grow. Cards can be styled to fill space gracefully |
| Apollo cache eviction loses previously loaded experience | `cache-and-network` refetches anyway; brief loading state is acceptable UX                 |

## Sources & References

- **Origin document:** [docs/brainstorms/library-tab-experience-selector-requirements.md](docs/brainstorms/library-tab-experience-selector-requirements.md)
- Institutional: `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md` (Apollo v4 cache, fetch policy)
- Institutional: `docs/solutions/best-practices/expo-glass-effect-interactive-flash-2026-04-08.md` (tab switch flash)
- Related code: `apps/mobile-v2/src/contexts/ExperienceShell.tsx` (primary modification target)
- Related code: `apps/mobile-v2/src/lib/queries.ts` (query patterns)
