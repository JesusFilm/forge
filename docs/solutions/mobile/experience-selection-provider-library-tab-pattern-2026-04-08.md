---
title: "Dynamic Experience Selection with AsyncStorage Persistence — Library Tab Pattern"
date: "2026-04-08"
category: mobile
module: "apps/mobile-v2"
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - "App has multiple CMS experiences and users need to browse/switch between them"
  - "No experience slug is persisted yet (first launch)"
  - "ExperienceShell renders before a slug is resolved"
  - "React context is consumed outside its provider boundary"
tags:
  - mobile
  - react-native
  - expo
  - sdui
  - experience-selection
  - async-storage
  - provider-pattern
  - stale-closure
  - first-launch-default
  - graphql
files_touched:
  - "apps/mobile-v2/src/contexts/ExperienceSelectionProvider.tsx"
  - "apps/mobile-v2/src/contexts/ExperienceShell.tsx"
  - "apps/mobile-v2/app/(tabs)/library.tsx"
  - "apps/mobile-v2/src/lib/queries.ts"
---

# Dynamic Experience Selection with AsyncStorage Persistence — Library Tab Pattern

## Context

The mobile-v2 app uses a Server-Driven UI (SDUI) pipeline where Strapi controls all content blocks via an `Experience` content type. Originally, `ExperienceShell.tsx` hardcoded `DEFAULT_SLUG = "easter"`, preventing users from ever switching experiences. The Library tab existed as a placeholder. All experiences were available in the CMS but inaccessible from the app.

The solution introduces a four-part pattern: a lightweight metadata-only GraphQL query, a persistent selection context, a refactored shell that auto-resolves the default experience on first launch, and a Library tab UI for browsing and switching. (auto memory [claude]: Urim owns mobile-v2 and focuses on cross-platform Experience delivery, making this pattern foundational for future TV and web app parity.)

## Guidance

### 1. Use a metadata-only query for listing experiences

Define a separate `LIST_EXPERIENCES` query that fetches only `documentId`, `slug`, `title`, `metaDescription`, `isHomepage`, and `ogImage`. Never reuse the full experience query (which fetches the dynamic zone blocks) — that query is expensive and unnecessary for a listing UI.

### 2. Create an ExperienceSelectionProvider with AsyncStorage persistence

The context shape is `{ currentSlug: string | null, selectExperience: (slug: string) => void, isReady: boolean }`. Key rules:

- Initialize `currentSlug` as `null` (not a hardcoded default) so the shell can detect first-launch and resolve the homepage experience dynamically.
- Use `createContext(null)` with a throw guard in the hook — prevents silent stale defaults if a component is accidentally rendered outside the provider.
- `isReady` gates rendering — do not render the shell until AsyncStorage has been read.
- `selectExperience` writes to AsyncStorage as fire-and-forget (best-effort persistence).

### 3. Refactor ExperienceShell to auto-resolve on first launch

When `currentSlug === null` (no persisted selection), fire `LIST_EXPERIENCES` and call `selectExperience` with the `isHomepage === true` experience, or fall back to the first result. Critical: use a `resolvedRef` (`useRef(false)`) to prevent the `useEffect` from firing twice or overwriting a user selection via stale closure. Always show a loading indicator while resolving and an error UI with retry on failure — **never return `null` silently** (blank screen with no error is a P0 incident).

### 4. Library tab: FlashList of experience cards

Each card renders the `ogImage` via `resolveImageUrl()` (never pass raw CMS URLs to `expo-image`), title, and `metaDescription`. Highlight the active card with an accent border and checkmark. On tap, call `selectExperience(slug)` then `router.navigate("/(tabs)/")` to return the user to Home with the new experience loaded.

## Why This Matters

Hardcoding a slug creates a single-experience app that cannot grow without a code release. This pattern decouples experience identity from the binary — the CMS controls which experience is default (via `isHomepage`) and users control their active selection.

The `resolvedRef` guard is non-obvious but critical: without it, a slow first-launch resolution race can overwrite a user's explicit selection if they navigate to Library quickly. The stale closure captures `needsDefault === true` even after the user has already called `selectExperience` — the ref breaks this cycle.

The metadata-only query is equally important. Fetching full block data for all experiences on every Library tab open would multiply GraphQL payload size by N. Keeping listing and rendering as separate queries is the correct SDUI separation.

## When to Apply

- Any time a new CMS content type needs to be "selectable" from a list and persisted locally — the `ExperienceSelectionProvider` shape is the reusable template.
- Any time you add a new listing screen in mobile-v2: write a lightweight metadata query, never reuse the full rendering query.
- Any time a shell component resolves state on mount via an async call: add a `resolvedRef` to guard against stale closure double-fires, especially when the resolution involves a GraphQL call followed by a context write.
- Any new context that wraps root layout: initialize as `null`, throw in the hook, check `isReady` before rendering children.

## Examples

**ExperienceSelectionProvider pattern template:**

```typescript
const Ctx = createContext<ExperienceSelectionContextValue | null>(null)

export function useExperienceSelection() {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error(
      "useExperienceSelection must be used within ExperienceSelectionProvider",
    )
  }
  return ctx
}
```

**resolvedRef guard in ExperienceShell first-launch effect:**

```typescript
const resolvedRef = useRef(false)

useEffect(() => {
  if (!needsDefault) {
    resolvedRef.current = false
    return
  }
  if (resolvedRef.current || !listData?.experiences) return

  const experiences = listData.experiences.filter(
    (e): e is NonNullable<typeof e> => e !== null,
  )
  const homepage = experiences.find((e) => e.isHomepage)
  const resolved = homepage ?? experiences[0]
  if (resolved) {
    resolvedRef.current = true
    selectExperience(resolved.slug)
  }
}, [needsDefault, listData, selectExperience])
```

**First-launch error handling (never return null silently):**

```typescript
// Wrong: blank screen on error or empty list
if (currentSlug === null) return null

// Right: show error UI with retry
if (currentSlug === null) {
  if (listError) {
    return <ErrorWithRetry onRetry={() => listRefetch()} />
  }
  return <LoadingIndicator />
}
```

## Related

- `docs/solutions/mobile/sdui-experience-provider-block-index-parent-child-loss.md` — ExperienceProvider indexBlock internals and siblingContent propagation
- `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md` — Apollo Client v4 setup, cache-and-network policy, and why apollo3-cache-persist is incompatible
- `docs/solutions/best-practices/expo-glass-effect-interactive-flash-2026-04-08.md` — Tab-switch flash with GlassView isInteractive (affects Library card styling)
- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` — Fragment validation and composite React keys
- `docs/plans/2026-04-08-001-feat-library-tab-experience-selector-plan.md` — Full implementation plan
- `docs/brainstorms/library-tab-experience-selector-requirements.md` — Requirements document
