---
title: "Mobile v2 SDUI App — Scaffold, Launch Issues, and Review Findings"
category: mobile
tags:
  [
    expo-router,
    gql-tada,
    apollo-client,
    sdui,
    flashlist,
    code-review,
    expo-sdk-54,
  ]
date: 2026-04-02
module: apps/mobile-v2
severity: high
symptom: "Multiple launch failures (TypeError, Forbidden access, fragment spread errors) during new Expo app scaffold; code review surfaced type erasure and performance patterns"
root_cause: "Package version mismatches, missing env config, invalid GraphQL fragment spreads on wrong dynamic zone unions, and normalizer design erasing gql.tada type safety"
---

## Problem

Building a new React Native Expo app (`apps/mobile-v2/`) alongside the existing `apps/mobile/` in a pnpm monorepo. The app renders Strapi v5 Experience pages via Server-Driven UI (SDUI) with gql.tada typed GraphQL. Multiple issues surfaced during scaffold, first launch, and code review.

## Issues Encountered (in order)

### 1. TypeError on Launch — apollo3-cache-persist incompatible with Apollo Client v4

**Symptom:** `TypeError: property is not writable` and `Cannot read property 'default' of undefined` on every launch.

**Root cause:** `apollo3-cache-persist@0.15.0` only supports Apollo Client v3. Its internal imports fail against v4's restructured module exports.

**Fix:** Remove `apollo3-cache-persist` and `@react-native-async-storage/async-storage`. Use synchronous `getApolloClient()` singleton (matching `apps/mobile/` pattern). Cache persistence can be revisited with a v4-compatible library. _Update 2026-06-11:_ the revisit happened as a hand-rolled, per-query AsyncStorage snapshot rather than a library — see `docs/solutions/design-patterns/asyncstorage-swr-snapshot-slow-admin-resolver.md`.

### 2. Expo Router Version Mismatch — SDK 54 expects different versions

**Symptom:** Same TypeError errors persisted even after removing apollo3-cache-persist.

**Root cause:** `expo-router@5.0.7` is for SDK 53. SDK 54 expects `expo-router@~6.0.23`, `expo-image@~3.0.11`, `expo-linear-gradient@~15.0.8`, etc. The version mismatch caused module resolution failures in Metro.

**Fix:** Run `npx expo install --fix` to auto-align all packages with SDK 54. This resolved the TypeError errors immediately.

**Key learning:** Always run `npx expo install --check` after creating a new Expo app in the monorepo. Don't guess version numbers — let Expo's resolver pick the right ones for the installed SDK version.

### 3. Missing babel.config.js

**Symptom:** Bundle compiled but routes didn't load properly.

**Root cause:** Expo Router requires `babel-preset-expo` to be explicitly configured. The existing `apps/mobile/` doesn't have one because it doesn't use Expo Router.

**Fix:** Create `apps/mobile-v2/babel.config.js`:

```javascript
/* global module */
module.exports = function (api) {
  api.cache(true)
  return { presets: ["babel-preset-expo"] }
}
```

### 4. Forbidden Access — Missing API Token in .env.local

**Symptom:** "Forbidden access" error on home screen. Strapi rejects the GraphQL query.

**Root cause:** `.env.local` was copied from `.env.example` which has `EXPO_PUBLIC_STRAPI_TOKEN` commented out. Without the token, the Bearer header is empty.

**Fix:** Set the actual token in `.env.local`. This is a local config issue (gitignored), not a code bug.

### 5. Fragment Spread on Wrong Dynamic Zone Union

**Symptom:** "Fragment cannot be spread here as objects of type 'SectionContentDynamicZone' can never be of type 'ComponentSectionsEasterDates'"

**Root cause:** `EasterDates` and `AdventCountdown` are members of `ContainerSlotContentDynamicZone` but NOT `SectionContentDynamicZone`. The `SectionFragment` incorrectly spread them in `sectionContent`.

**Fix:** Remove `EasterDates` and `AdventCountdown` fragment spreads from `SectionFragment`. Keep them only in `ContainerFragment` where they belong. Added schema comments documenting which types belong to each union.

**Key learning:** Before spreading a fragment on a dynamic zone, ALWAYS verify the target type is a member of that union in `apps/cms/schema.graphql`. Strapi validates this at query time and rejects the entire query (blank screen) for any invalid spread. This was already documented in `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` but hit us again.

### 6. Code Review Findings — Normalizer Type Erasure

**Symptom:** ~60 `as` casts across all renderers. Schema field changes silently break at runtime instead of compile time.

**Root cause:** The `NormalizedBlock` type uses `[key: string]: unknown` index signature, which erases all gql.tada field information at the normalizer boundary.

**Fix (applied):** Added `as const satisfies Record<string, string>` on `TYPENAME_TO_KIND` so `SectionKind` is a literal union. Full fix (discriminated union over `ResultOf` types) tracked as follow-up.

### 7. Double-Fetch Pattern Causes Loading Flash

**Symptom:** Content briefly shows a loading spinner after data is already visible.

**Root cause:** Manual `useExperience` hook called `setLoading(true)` on the background network refetch, causing a re-render cycle that flashed the loading state.

**Fix:** Replaced manual state machine with Apollo's `useQuery` + `cache-and-network` fetch policy. Only shows loading when `experience === null` (first load), not on background refetches.

## Prevention

1. **Always run `npx expo install --check`** after adding dependencies to a new Expo app. Never manually pick version numbers.
2. **Verify dynamic zone membership** in `schema.graphql` before adding fragment spreads. Add comments documenting which types belong to each union.
3. **Use Apollo's built-in fetch policies** (`cache-and-network`) instead of manual state machines. The built-in policies handle edge cases (unmount races, loading states) that manual implementations miss.
4. **Test with a real Strapi instance** early — don't wait until all renderers are done. The fragment spread error only surfaces at query time.
5. **When adding `apollo3-cache-persist` or similar libraries**, verify compatibility with your Apollo Client major version first. v3 libraries don't work with v4.

## Cross-References

- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` — The fragment spread validation issue (hit again)
- `docs/solutions/mobile/eas-update-stakeholder-preview-setup.md` — Env file handling patterns
- `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` — Lazy SDK init, CI env skip guard
- PR #630: `JesusFilm/forge#630`
- Plan: `docs/plans/2026-04-02-001-feat-watch-app-sdui-experience-renderer-plan.md`
