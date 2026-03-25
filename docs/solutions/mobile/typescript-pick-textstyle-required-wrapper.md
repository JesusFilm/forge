---
title: "Pick<TextStyle> makes fields optional — use Required<Pick<T, K>> for enforced subsets"
category: mobile
date: 2026-03-26
tags:
  - typescript
  - react-native
  - pick
  - required
  - optional-types
  - textStyle
  - type-safety
  - typography
severity: medium
components:
  - apps/mobile/src/hooks/useTypography.ts
  - apps/mobile/src/lib/sectionModels.ts
symptoms:
  - "TypographyToken fields (fontSize, lineHeight) typed as number | undefined despite being logically required"
  - "Consumers forced to add ?? 0 fallbacks throughout rendering code"
  - "Optional types propagate silently to downstream components with no compile error at the source"
  - "Test assertions need ?? 0 for values that should always exist"
---

# Pick\<TextStyle\> makes fields optional — use Required\<Pick\<T, K\>\>

## Problem

In a React Native/Expo app, `type TypographyToken = Pick<TextStyle, "fontSize" | "lineHeight">` was used to create a typography token type. React Native's `TextStyle` defines these fields as optional (`number | undefined`). When you `Pick` them, the result is `{ fontSize?: number; lineHeight?: number }` — both optional.

This caused:

- `computeTypographyScale` required `?? 0` fallbacks: `Math.round((token.fontSize ?? 0) * factor)`
- Test assertions needed `?? 0`: `(token.lineHeight ?? 0) >= (token.fontSize ?? 0)`
- The `TypographyScale` return type propagated optional fields to all consumers
- TypeScript would not flag accidental `undefined` fontSize/lineHeight when spreading tokens into style props

## Root Cause

`Pick<T, K>` preserves the optionality of the source type's properties. Since React Native's `TextStyle.fontSize` and `TextStyle.lineHeight` are both typed as `number | undefined`, `Pick<TextStyle, "fontSize" | "lineHeight">` results in `{ fontSize?: number; lineHeight?: number }`. The token type is a domain-defined value that should always have concrete numeric values; the optionality comes from the host type, not from domain intent.

## Solution

Wrap the `Pick` with `Required<>` to strip the optionality:

```typescript
// Before — fields are optional, inherited from TextStyle
type TypographyToken = Pick<TextStyle, "fontSize" | "lineHeight">
// Resolves to: { fontSize?: number; lineHeight?: number }

// After — fields are required, domain intent enforced
type TypographyToken = Required<Pick<TextStyle, "fontSize" | "lineHeight">>
// Resolves to: { fontSize: number; lineHeight: number }
```

After this change:

1. Remove all `?? 0` fallbacks from `computeTypographyScale` — the compiler guarantees numeric values
2. Remove `?? 0` from test assertions — values are known to be `number`
3. All consumers receive guaranteed `number` values with no narrowing required
4. TypeScript correctly flags any code path that would produce `undefined`

## When to Apply This Pattern

Use `Required<Pick<T, K>>` instead of `Pick<T, K>` whenever:

- You are picking from a type that originates in a UI framework (e.g., React Native's `TextStyle`, `ViewStyle`) where fields are broadly optional for API flexibility
- The domain concept you are modeling requires those fields to always be present
- Downstream code would otherwise need null-coalescing (`?? 0`, `?? ''`) to satisfy the compiler

Use bare `Pick<T, K>` when you intentionally want the fields to remain optional (e.g., style override props from callers).

## Code Smell Detection

If you see any of these in code that uses `Pick` from a style type, the type is likely wrong:

| Signal                                                             | Root Cause                                      | Fix                             |
| ------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------- |
| `?? 0` on a style property from a `Pick` type                      | Missing `Required<>`                            | Add `Required<Pick<...>>`       |
| `prop!` non-null assertion on a picked style value                 | Same                                            | Same                            |
| `?? undefined` no-op on a picked property                          | Author patched the symptom                      | Fix the type                    |
| Test assertion uses `?? default` for a "should always exist" value | Type allows `undefined` that should be required | Fix the type, then fix the test |

The ESLint rule `@typescript-eslint/no-unnecessary-condition` will flag `?? 0` when TypeScript knows the value can never be `undefined`. If the rule is _not_ firing and you have `?? 0`, the type genuinely allows `undefined` — which is your signal to audit the `Pick`.

## Investigation Steps

1. TypeScript reviewer agent identified that `Pick<TextStyle>` creates optional fields during code review of PR #541
2. Confirmed by checking React Native's `TextStyle` definition where `fontSize` and `lineHeight` are `number | undefined`
3. Applied `Required<Pick<...>>` wrapper (1 line change)
4. Removed all `?? 0` fallbacks in `computeTypographyScale` and test assertions
5. Ran 166 tests — all passed, confirming the types were the only issue

## Related Patterns

### `satisfies` for Scale Definitions

Use `as const satisfies Record<...>` to get compile-time validation on scale objects without losing literal type inference:

```typescript
const BASE_SCALE = {
  body: { fontSize: 16, lineHeight: 24 },
  heading: { fontSize: 24, lineHeight: 32 },
} as const satisfies Record<string, TypographyToken>
```

### Domain Types Belong in Domain Modules

`TextHeadingLevel` (a CMS heading level concept) was defined in `useTypography.ts` (a hooks file) and re-exported from `sectionModels.ts`. This inverted the correct dependency direction — domain models should not depend on hooks. Fix: keep domain types in `sectionModels.ts` and import into the hook.

## Cross-References

- [responsive-typography-hook.md](./responsive-typography-hook.md) — The full typography system documentation (partially stale — does not yet reflect `Required<Pick<>>` pattern)
- [full-bleed-video-hero-with-scroll-over-content.md](./full-bleed-video-hero-with-scroll-over-content.md) — Documents `useWindowDimensions()` vs `Dimensions.get()` anti-pattern
- PR: https://github.com/JesusFilm/forge/pull/541
