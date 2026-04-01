---
title: "jest.mock() Before Imports Triggers import/first ESLint Warning"
category: mobile
date: 2026-03-30
tags: [jest, eslint, import-first, testing, lint, ci]
module: apps/mobile
severity: low
symptom: "CI lint step fails with: 'Import in body of module; reorder to top  import/first' and '✖ 1 problem (0 errors, 1 warning)' with --max-warnings=0"
root_cause: "jest.mock() placed before import statements triggers ESLint import/first rule, even though Jest hoists mock calls automatically"
---

# jest.mock() Before Imports Triggers import/first ESLint Warning

## Problem

CI lint step (`eslint . --max-warnings=0`) fails with:

```
5:1  warning  Import in body of module; reorder to top  import/first
✖ 1 problem (0 errors, 1 warning)
```

The test file has `jest.mock("react-native", ...)` before the import statement, which ESLint's `import/first` rule flags as a non-import statement preceding an import.

## Root Cause

A common pattern when mocking React Native modules in Jest is to place `jest.mock()` before the import so the mock is "in place" when the module loads. However, **Jest automatically hoists `jest.mock()` calls to the top of the file** regardless of where they appear in source code. This means the ordering doesn't matter at runtime — but ESLint doesn't know about Jest's hoisting and flags the import as out of order.

The project runs ESLint with `--max-warnings=0`, so even a single warning fails CI.

## Solution

Place imports first, then `jest.mock()` after — matching the pattern used by other test files in the codebase (e.g., `navigateLink.test.ts`):

```typescript
// ✅ Correct — imports first, jest.mock after
import { resolveImageUrl, WEB_BASE_URL } from "./resolveImageUrl"

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}))
```

```typescript
// ❌ Wrong — triggers import/first warning
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}))

import { resolveImageUrl, WEB_BASE_URL } from "./resolveImageUrl"
```

Jest hoists the `jest.mock()` call either way, so behavior is identical.

## Prevention

When writing new test files that mock React Native modules, follow the existing pattern in `apps/mobile/src/lib/navigateLink.test.ts`: imports at the top, `jest.mock()` calls below. Run `npx eslint . --max-warnings=0` locally before pushing to catch this early.
