---
title: "feat: Add QuizButton section component to mobile app"
type: feat
status: active
date: 2026-03-27
origin: docs/brainstorms/2026-03-27-mobile-quiz-button-requirements.md
deepened: 2026-03-27
---

# feat: Add QuizButton section component to mobile app

## Enhancement Summary

**Deepened on:** 2026-03-27
**Agents used:** TypeScript reviewer, architecture strategist, security sentinel, performance oracle, frontend races reviewer, pattern recognition specialist, code simplicity reviewer, framework docs researcher, best practices researcher

### Key Improvements

1. **Scope corrected**: GraphQL fragment and mapper cases scoped to `SectionContent` only (not 3 nesting levels) — matches actual CMS schema
2. **State machine replaces 3 booleans**: Eliminates impossible state combinations and race conditions in the modal lifecycle
3. **WebView security hardening**: Client-side URL validation + hardening flags added as defense-in-depth
4. **Performance**: Conditional render (unmount on close) prevents 50-150 MB memory leak; lazy-import WebView; isolate modal state into child component
5. **Simplified**: Dropped hero context hooks, color scheme hooks, error+retry state, and navigation restriction for v1 — matches web's actual behavior

---

## Overview

The CMS `ComponentSectionsQuizButton` data type exists and renders on web, but the mobile app silently drops it — the section pipeline has no support for it. Users on mobile never see the quiz CTA. This plan adds the full pipeline: GraphQL fragment, section model, mapper, dispatcher, and a styled renderer with a full-screen WebView modal.

## Problem Statement

The Easter experience includes a quiz button ("What's your next step of faith?") that links to a nextstep.is quiz. On web this renders as a gradient button that opens a dialog with an iframe. On mobile it is silently filtered out because `sectionMapper.ts` and `SectionDispatcher.tsx` have no case for `ComponentSectionsQuizButton`, and the GraphQL query does not fetch its fields.

## Proposed Solution

Add the QuizButton to the mobile section pipeline following the established pattern (model → mapper → dispatcher → renderer), introduce `react-native-webview` for the full-screen modal, and style the button to match the design reference.

## Technical Considerations

### Schema placement

`ComponentSectionsQuizButton` is present in `SectionContentDynamicZone` (nested inside SectionWrapper/Section content) but **NOT** in `ExperienceBlocksDynamicZone` (top-level blocks) or `ContainerSlotContentDynamicZone`. This means:

- Add the GraphQL fragment **only** inside `ComponentSectionsSection > sectionContent` spread
- Add to `mapContentItem()` switch only (nested content)
- Add to `renderContent()` in the dispatcher only
- Do NOT add to top-level `blocks` spread or container `slotContent` — the schema unions do not include this type, and adding fragments for non-member types is schema-inaccurate
- (see origin: `docs/brainstorms/2026-03-27-mobile-quiz-button-requirements.md`)

### Native dependency: react-native-webview

`react-native-webview` is a native module compatible with Expo managed workflow — no config plugin required for standard usage. Install with `npx expo install react-native-webview` (ensures SDK-compatible version).

Per `apps/mobile/CLAUDE.md`: "OTA updates only work for JS changes, not native module additions." A new EAS Build is required across all profiles (development, preview, production) before this feature can ship.

### Research Insights: react-native-webview

- **Version**: `13.16.1` is compatible with Expo SDK 54 / RN 0.81.5, supports both Old and New Architecture
- **`onShouldStartLoadWithRequest` caveat**: On Android, this is NOT called on the first load (only subsequent navigations). On iOS it fires for every load including the initial one.
- **Modals don't inherit safe area context**: Must use `useSafeAreaInsets()` from `react-native-safe-area-context` (already installed) inside the modal
- **Cookie/storage**: WebView cookies are NOT shared with React Native's fetch — not relevant for this feature since the quiz is stateless from the app's perspective

### Gradient styling

Per documented learning (`docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`): never use the `"transparent"` keyword in `LinearGradient` color arrays. The quiz button gradient is amber-to-red (no transparency needed). Define colors as module-level constants for stable references:

```typescript
const GRADIENT_COLORS = ["#F59E0B", "#EF4444", "#B91C1C"] as const
```

### State machine (replaces 3 booleans)

**Research insight (frontend races review):** Three booleans (`modalVisible`, `loading`, `error`) create 8 combinations, at least 3 of which are impossible states. Replace with a single discriminated state:

```typescript
type QuizModalState =
  | "idle"
  | "opening"
  | "loading"
  | "loaded"
  | "errored"
  | "closing"
```

**Transition table:**

```
idle     → opening   (user taps button; guard: only from idle)
opening  → loading   (Modal onShow fires; WebView starts loading)
loading  → loaded    (onLoadEnd, no prior error)
loading  → errored   (onError)
loading  → closing   (user closes while loading)
loaded   → closing   (user taps close / back button)
errored  → closing   (user taps close / back button)
closing  → idle      (modal unmounts)
```

**Session counter ref**: Bump on every open. All WebView callbacks check the counter before updating state — prevents stale callbacks from a previous session from affecting the current one.

**Defer WebView render until `onShow`**: Don't render the WebView until the modal entrance animation completes. This prevents the loading spinner from appearing and disappearing during the slide animation.

### Component architecture (performance)

**Critical: Conditionally render Modal+WebView** — unmount everything when closed. A hidden WebView consumes 50-150 MB RAM (WKWebView/Android WebView process). Use `{state !== 'idle' && <Modal>...</Modal>}`, NOT `<Modal visible={state !== 'idle'}>`.

**Isolate modal into a child `QuizModal` component**: The parent `QuizButtonRenderer` owns only `state === 'idle' | 'opening'` (whether to show the modal). The child `QuizModal` owns all WebView lifecycle state (`loading`, `loaded`, `errored`, `closing`). This prevents WebView callbacks from re-rendering the gradient button underneath.

**Lazy-import WebView**:

```tsx
const WebView = React.lazy(() =>
  import("react-native-webview").then((m) => ({ default: m.WebView })),
)
```

Wrap in `<Suspense fallback={<ActivityIndicator />}>`. Saves ~15-25 KB from the critical path bundle.

### WebView behavior decisions

| Concern                | Decision                                        | Rationale                                                                        |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Loading state          | Centered `ActivityIndicator` on dark background | Matches web spinner; RN WebView has no built-in indicator                        |
| Error handling         | Close button only (no retry) for v1             | Web has no error state either; add retry if users report issues                  |
| Android back button    | Always closes modal                             | Simplest; matches single close-button paradigm                                   |
| Navigation restriction | None for v1                                     | CMS validates URL; web doesn't restrict iframe navigation either. Add if needed. |
| Background color       | Dark (`rgba(0,0,0,0.9)`)                        | Matches web's `bg-black/80` overlay                                              |
| Orientation            | Follow device (no lock)                         | Quiz content may benefit from landscape                                          |
| StatusBar              | Toggle to `light-content` when modal is open    | Dark overlay requires light status bar text                                      |

### WebView security hardening

**Client-side URL validation** (defense-in-depth — CMS-only validation is a single point of failure):

```typescript
function isAllowedQuizUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    if (
      parsed.hostname !== "nextstep.is" &&
      !parsed.hostname.endsWith(".nextstep.is")
    )
      return false
    if (parsed.username || parsed.password) return false
    return true
  } catch {
    return false
  }
}
```

If validation fails, don't render the button at all (silent drop — CMS data is corrupted).

**WebView hardening flags**:

```tsx
<WebView
  source={{ uri: validatedUrl }}
  javaScriptEnabled={true}
  allowFileAccess={false}
  allowFileAccessFromFileURLs={false}
  allowUniversalAccessFromFileURLs={false}
  javaScriptCanOpenWindowsAutomatically={false}
  mixedContentMode="never"
  thirdPartyCookiesEnabled={false}
  mediaPlaybackRequiresUserAction={true}
/>
```

### Accessibility

- Button: `accessibilityRole="button"`, `accessibilityLabel="Open faith quiz"` (matches web's `aria-label`)
- Close button: `accessibilityLabel="Close"`, `hitSlop={8}` for minimum 44pt touch target
- "QUIZ" badge: decorative — use `accessibilityElementsHidden` (iOS) and `importantForAccessibility="no-hide-descendants"` (Android) per documented pattern (`docs/solutions/mobile/decorative-icon-view-text-pattern.md`)
- Minimum touch target: 44x44pt (Apple HIG). Use `hitSlop` if visual button is smaller.

### Intentional skips

- **`useSectionColorScheme()`**: Skipped because the gradient provides its own contrast-compliant background with white text. Unlike text-only sections, this button's colors are fixed regardless of context.
- **`useIsInsideHero()`**: Skipped because the gradient button is visually self-contained. Hero context primarily affects background color, which this component provides itself.
- **Error state with retry**: Deferred. Web has no error state. Add if users report issues.
- **Navigation restriction (`onShouldStartLoadWithRequest`)**: Deferred. CMS validates URL with regex; web doesn't restrict iframe navigation. Add if security review escalates.

## Acceptance Criteria

- [ ] QuizButton renders in the Easter experience on mobile wherever it appears on web
- [ ] Button styled per design: amber-to-red gradient, "QUIZ" badge, centered `buttonText`, arrow icon
- [ ] Tapping opens full-screen modal with WebView loading `iframeSrc`
- [ ] Loading spinner shown while WebView loads
- [ ] Client-side URL validation before rendering WebView
- [ ] WebView hardening flags set (`allowFileAccess=false`, etc.)
- [ ] Close button (top-right) dismisses modal; Android back button also dismisses
- [ ] Modal+WebView unmounted on close (not hidden)
- [ ] Accessibility roles and labels on button and close button
- [ ] Uses `useTypography()` for readable text (buttonText)
- [ ] Unit tests for mapper and dispatcher cases
- [ ] Smoke test for QuizButtonRenderer (with `jest.mock('react-native-webview')`)

## Implementation Plan

### Phase 1: Dependency & GraphQL (setup)

**1.1 Install `react-native-webview`**

```bash
cd apps/mobile && npx expo install react-native-webview
```

Verify with `npx expo prebuild --clean` to check native linking. A full EAS build is required before this feature ships.

**1.2 Add QuizButton fragment to GraphQL query**

`apps/mobile/src/lib/graphql/queries.ts`

Add `"ComponentSectionsQuizButton"` to the `WatchExperienceBlock.__typename` union type, and add the inline fragment **only** inside `ComponentSectionsSection > sectionContent`:

```graphql
... on ComponentSectionsQuizButton {
  id
  buttonText
  iframeSrc
}
```

**Do NOT add** to top-level `blocks` or Container `slotContent` — `ComponentSectionsQuizButton` is not a member of those dynamic zone unions per the CMS schema.

### Phase 2: Type System & Mapper (plumbing)

**2.1 Add section model**

`apps/mobile/src/lib/sectionModels.ts`

```typescript
export interface QuizButtonSection {
  kind: "quizButton"
  id: string
  sectionKey: string | null
  buttonText: string
  iframeSrc: string
}
```

Note: Uses `interface` (not `type`) to match the convention in this file where all 12 existing section models use `interface`.

Add `QuizButtonSection` to the `SectionContent` union only. Do NOT add to `ExperienceSection` directly — `ComponentSectionsQuizButton` is not in `ExperienceBlocksDynamicZone`.

**2.2 Add mapper function and switch cases**

`apps/mobile/src/lib/sectionMapper.ts`

```typescript
function mapQuizButton(
  raw: RawSection & { __typename: "ComponentSectionsQuizButton" },
): QuizButtonSection {
  return {
    kind: "quizButton",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    buttonText: raw.buttonText,
    iframeSrc: raw.iframeSrc,
  }
}
```

Note: Uses `raw.sectionKey ?? null` (not hardcoded `null`) to match every other mapper and be forward-compatible if the CMS type gains a `sectionKey` field.

Add `case "ComponentSectionsQuizButton": return mapQuizButton(raw)` to `mapContentItem()` only.

Add `case "quizButton": break` to `firstSectionTitle()` — quiz button text is a CTA label, not a section title.

**2.3 Add mapper tests**

`apps/mobile/src/lib/sectionMapper.test.ts`

Add a test fixture for `ComponentSectionsQuizButton` and verify it maps to `{ kind: "quizButton", buttonText, iframeSrc }`.

### Phase 3: Component & Dispatcher (UI)

**3.1 Create QuizButtonRenderer**

`apps/mobile/src/components/sections/QuizButtonRenderer.tsx`

```typescript
export interface QuizButtonRendererProps {
  section: QuizButtonSection
}
```

**Parent component (`QuizButtonRenderer`):**

- Owns only `modalVisible` state
- Validates `iframeSrc` with `isAllowedQuizUrl()` — if invalid, returns `null` (silent drop)
- Button: `Pressable` wrapping a `LinearGradient` with amber-to-red color constants
  - Left: "QUIZ" badge (bordered, uppercase, small bold text — decorative, hidden from a11y)
  - Center: `buttonText` using `useTypography()` body/titleSmall token
  - Right: Arrow icon (Unicode `→` or SVG path matching web)
  - Press feedback: `opacity: 0.85` on `pressed` state (simple, matches existing patterns)
- Conditionally renders: `{modalVisible && <QuizModal ... />}`

**Child component (`QuizModal`):**

- Owns WebView lifecycle state as a state machine: `'loading' | 'loaded' | 'errored' | 'closing'`
- Session counter ref — bumped on mount, checked in all WebView callbacks
- `Modal` with `animationType="slide"`, `statusBarTranslucent={true}`, `transparent={true}`
- Defers WebView render until `onShow` (modal animation complete)
- `useSafeAreaInsets()` for close button positioning (top-right)
- Lazy-loaded `WebView` wrapped in `<Suspense fallback={<ActivityIndicator />}>`
- WebView hardening flags (see security section)
- `ActivityIndicator` shown while state is `'loading'`
- `onRequestClose` (Android back) → close modal
- On close: set state to `'closing'`, bump session counter

**3.2 Add dispatcher case**

`apps/mobile/src/components/sections/SectionDispatcher.tsx`

Add `case "quizButton": return <QuizButtonRenderer section={section} />` to `renderContent()` only (not `SectionDispatcher()` — quiz button cannot appear at the top level).

**3.3 Add barrel export**

`apps/mobile/src/components/sections/index.ts`

Export `QuizButtonRenderer`.

**3.4 Add component smoke test**

`apps/mobile/src/components/sections/QuizButtonRenderer.test.tsx`

Add `jest.mock('react-native-webview')` at the top. Smoke test: renders without crashing, displays buttonText, renders QUIZ badge.

**3.5 Update dispatcher test**

`apps/mobile/src/components/sections/SectionDispatcher.test.tsx`

Add a `quizButton` fixture to the `allSections` array.

## Files to Create

| File                                                              | Purpose                                   |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `apps/mobile/src/components/sections/QuizButtonRenderer.tsx`      | Quiz button + `QuizModal` child component |
| `apps/mobile/src/components/sections/QuizButtonRenderer.test.tsx` | Smoke tests (with WebView mock)           |

## Files to Modify

| File                                                             | Change                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/mobile/package.json`                                       | Add `react-native-webview` dependency                                        |
| `apps/mobile/src/lib/graphql/queries.ts`                         | Add QuizButton fragment in `sectionContent` + typename union                 |
| `apps/mobile/src/lib/sectionModels.ts`                           | Add `QuizButtonSection` interface + `SectionContent` union membership        |
| `apps/mobile/src/lib/sectionMapper.ts`                           | Add `mapQuizButton()` + `mapContentItem()` case + `firstSectionTitle()` case |
| `apps/mobile/src/lib/sectionMapper.test.ts`                      | Add QuizButton mapper test fixture                                           |
| `apps/mobile/src/components/sections/SectionDispatcher.tsx`      | Add quizButton case to `renderContent()`                                     |
| `apps/mobile/src/components/sections/SectionDispatcher.test.tsx` | Add quizButton fixture to `allSections`                                      |
| `apps/mobile/src/components/sections/index.ts`                   | Add barrel export                                                            |

## Dependencies & Risks

- **`react-native-webview` requires native rebuild** — Cannot ship via OTA. Must run EAS Build before merging. Test on all three profiles (development, preview, production).
- **nextstep.is availability** — If the quiz service is down, users see a blank modal with a close button. No fallback content.
- **"QUIZ" badge is hardcoded English** — Matches web; localization deferred.
- **First modal pattern in the codebase** — No existing convention to follow. If a second modal use case arises, extract the WebView modal into a shared component. This is a conscious deferral, not an oversight.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-27-mobile-quiz-button-requirements.md](docs/brainstorms/2026-03-27-mobile-quiz-button-requirements.md) — Key decisions: full-screen modal over bottom sheet, WebView over expo-web-browser
- **Web reference implementation:** [apps/web/src/components/sections/QuizButton.tsx](apps/web/src/components/sections/QuizButton.tsx)
- **CMS data type:** [apps/cms/src/components/sections/quiz-button.json](apps/cms/src/components/sections/quiz-button.json)
- **GraphQL schema unions:** [apps/cms/schema.graphql:2611](apps/cms/schema.graphql) — `SectionContentDynamicZone` includes `ComponentSectionsQuizButton`; `ExperienceBlocksDynamicZone` (line 1505) and `ContainerSlotContentDynamicZone` (line 948) do NOT
- **Gradient gotcha:** [docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md](docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md)
- **Decorative icon pattern:** [docs/solutions/mobile/decorative-icon-view-text-pattern.md](docs/solutions/mobile/decorative-icon-view-text-pattern.md)
- **Typography hook:** [docs/solutions/mobile/responsive-typography-hook.md](docs/solutions/mobile/responsive-typography-hook.md)
- **Section pipeline pattern:** [docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md](docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md)
- **react-native-webview docs:** [GitHub Reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md)
- **Expo WebView docs:** [docs.expo.dev/versions/latest/sdk/webview](https://docs.expo.dev/versions/latest/sdk/webview/)
- **react-native-safe-area-context:** [docs.expo.dev/versions/latest/sdk/safe-area-context](https://docs.expo.dev/versions/latest/sdk/safe-area-context/)
