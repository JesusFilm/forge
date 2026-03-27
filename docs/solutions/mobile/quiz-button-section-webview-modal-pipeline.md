---
title: "Add QuizButton section pipeline with WebView modal to mobile app"
category: mobile
date: 2026-03-27
tags:
  - react-native
  - expo
  - webview
  - modal
  - graphql-fragment
  - section-pipeline
  - strapi-cms
  - android
module: apps/mobile
severity: medium
symptom: "QuizButton sections from CMS silently dropped in mobile app — no error, no render"
root_cause: "Mobile section pipeline (GraphQL query, mapper, dispatcher, renderer) had no support for ComponentSectionsQuizButton"
---

# Add QuizButton Section Pipeline with WebView Modal

## Problem

The CMS `ComponentSectionsQuizButton` type (with `buttonText` and `iframeSrc` fields) existed and rendered on web, but the mobile app silently dropped it. No error, no warning — the quiz button simply never appeared. This affected the Easter experience where a "What's your next step of faith?" CTA was invisible to mobile users.

## Root Cause

The mobile section pipeline has four layers that all need explicit support for each section type. None of them had `ComponentSectionsQuizButton` entries:

1. **`queries.ts`** — No inline fragment to fetch `buttonText` or `iframeSrc`
2. **`sectionModels.ts`** — No `QuizButtonSection` in the `SectionContent` union
3. **`sectionMapper.ts`** — No case for `__typename: "ComponentSectionsQuizButton"` in `mapContentItem()`
4. **`SectionDispatcher.tsx`** — No renderer case for `kind: "quizButton"` in `renderContent()`

The missing fragment meant no data was returned for that union member. The mapper then skipped the unknown typename silently via its `default: return null` branch.

## Solution

### 1. GraphQL Fragment — Only in `sectionContent`

Add the fragment **only** inside `ComponentSectionsSection > sectionContent`. QuizButton is a member of `SectionContentDynamicZone` but **NOT** `ExperienceBlocksDynamicZone` or `ContainerSlotContentDynamicZone`.

```graphql
... on ComponentSectionsQuizButton {
  id
  buttonText
  iframeSrc
}
```

### 2. Section Model

```typescript
export interface QuizButtonSection {
  kind: "quizButton"
  id: string
  sectionKey: string | null
  buttonText: string
  iframeSrc: string
}
```

Add to `SectionContent` union only (not `ExperienceSection`).

### 3. Mapper — `mapContentItem()` only

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

Add case in `mapContentItem()` and `case "quizButton": break` in `firstSectionTitle()`.

### 4. Dispatcher — `renderContent()` only

```tsx
case "quizButton":
  return <QuizButtonRenderer section={section} />
```

### 5. Component — Parent/Child Split

- **`QuizButtonRenderer`**: Gradient button, owns `modalVisible` state, validates URL
- **`QuizModal`**: Modal + WebView, owns loading/loaded/errored state machine

The modal unmounts on close (`{modalVisible && <QuizModal />}`), so all WebView state is automatically cleaned up.

### 6. WebView Security Hardening

```tsx
<WebView
  source={{ uri: url }}
  originWhitelist={["https://*"]}
  onShouldStartLoadWithRequest={(req) => isAllowedQuizUrl(req.url)}
  javaScriptEnabled
  domStorageEnabled
  allowFileAccess={false}
  allowFileAccessFromFileURLs={false}
  allowUniversalAccessFromFileURLs={false}
  javaScriptCanOpenWindowsAutomatically={false}
  mixedContentMode="never"
  thirdPartyCookiesEnabled={false}
  mediaPlaybackRequiresUserAction
/>
```

Client-side URL validation as defense-in-depth:

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

### 7. Global Jest Mock

Add to `jest.setup.js` (not individual test files) to prevent cascading failures from transitive imports through `SectionDispatcher`:

```javascript
jest.mock("react-native-webview", () => ({
  WebView: "WebView",
}))
```

## Gotchas

### 1. `ComponentSectionsQuizButton` has NO `sectionKey` field

Unlike most section types, QuizButton does not have `sectionKey` in the CMS schema. Requesting it in the GraphQL fragment causes **"Cannot query field sectionKey on type ComponentSectionsQuizButton"** — this breaks the **entire query** on both iOS and Android, not just the QuizButton section. Always verify fields exist in the CMS schema before adding them to fragments.

### 2. Android WebView requires explicit props

`domStorageEnabled={true}` and `originWhitelist={["https://*"]}` must be set explicitly. Without `domStorageEnabled`, many quiz/form pages fail with `ERR_NAME_NOT_RESOLVED` or blank screens on Android. iOS works without these props.

### 3. Schema union membership determines fragment placement

`ComponentSectionsQuizButton` exists only in `SectionContentDynamicZone`. Adding its fragment to `ExperienceBlocksDynamicZone` or `ContainerSlotContentDynamicZone` is schema-inaccurate and may cause errors with strict GraphQL validation. Always check `schema.graphql` for the union definition before placing fragments.

### 4. Native module mocks cascade through transitive imports

Any test file that imports `SectionDispatcher` (which imports `QuizButtonRenderer`, which imports `WebView`) needs the native module mocked. Place the mock in `jest.setup.js` to cover all test suites globally, not in individual test files.

### 5. `React.lazy()` provides no bundle splitting in React Native

Metro bundler does not support dynamic `import()` for code splitting. `React.lazy` adds Suspense complexity with zero performance benefit in RN. Use direct imports.

### 6. Session counter refs are unnecessary with mount/unmount lifecycle

When the modal unmounts on close, the WebView and all its callbacks are destroyed. Ref-based session counters for stale callback prevention add complexity for no gain.

### 7. `react-native-webview` requires an EAS native build

Per `apps/mobile/CLAUDE.md`: "OTA updates only work for JS changes, not native module additions." The first deployment with WebView requires a full EAS Build across all profiles (development, preview, production). Cannot ship via EAS Update alone.

## Prevention Strategies

- [ ] Before writing GraphQL fragments, verify every field exists in the CMS schema (`schema.graphql` or GraphiQL introspection)
- [ ] Before adding fragments to a dynamic zone, check which unions actually include the component type
- [ ] When adding `react-native-webview` or any native module, always set Android-required props (`domStorageEnabled`, `originWhitelist`) from the start
- [ ] Add native module Jest mocks in `jest.setup.js` in the same commit as the dependency addition
- [ ] Prefer direct imports over `React.lazy()` in React Native
- [ ] Use mount/unmount lifecycle for cleanup instead of manual ref-based cancellation
- [ ] Test WebView content on Android emulator/device before marking complete

## Related Documentation

- [Section pipeline pattern](../integration-issues/expo-graphql-schema-drift-and-fragment-validation.md) — canonical procedure for adding new section types
- [LinearGradient transparent keyword](linear-gradient-dark-banding-transparent-keyword.md) — gradient color stop gotcha
- [Decorative icon pattern](decorative-icon-view-text-pattern.md) — QUIZ badge accessibility hiding
- [Responsive typography hook](responsive-typography-hook.md) — `useTypography()` usage and exclusions for decorative text
- [Translucent hero backgrounds](translucent-section-backgrounds-with-react-context.md) — `useIsInsideHero()` intentionally skipped for self-contained gradients
