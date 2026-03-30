---
title: "Fix TextRenderer paragraph separation for JSON array content"
category: "mobile"
date: "2026-03-30"
severity: "medium"
module: "apps/mobile"
tags:
  - react-native
  - text-rendering
  - json-array
  - type-coercion
  - strapi-v5
  - paragraph-separation
  - backward-compatibility
  - 4-layer-pipeline
related_files:
  - apps/mobile/src/lib/sectionModels.ts
  - apps/mobile/src/lib/sectionMapper.ts
  - apps/mobile/src/components/sections/TextRenderer.tsx
  - apps/mobile/src/lib/sectionMapper.test.ts
  - apps/mobile/src/components/sections/TextRenderer.test.tsx
---

# Fix TextRenderer paragraph separation for JSON array content

## Problem

The mobile `TextRenderer` component concatenated the `contentParagraphs` JSON array into a single string, producing a wall of text with no paragraph breaks. The CMS (Strapi v5) stores `contentParagraphs` as `type: "json"` — an array of plain-text paragraph strings (e.g., `["First paragraph.", "Second paragraph."]`). The web app already handled this correctly by mapping each element to a separate `<p>` tag, but the mobile app's 4-layer pipeline treated it as a single string across all layers.

**Symptom:** All paragraph text in text sections ran together with no visual separation — one continuous wall of text.

## Root Cause

The mobile 4-layer pipeline (model -> mapper -> renderer -> tests) typed `content` as `string` instead of `string[]`.

1. `sectionModels.ts` defined `content: string` (should be `string[]`)
2. `sectionMapper.ts` passed `raw.textContent` directly without array coercion
3. `TextRenderer.tsx` rendered it as a single `<Text>` element
4. Tests used string fixtures, masking the type error

The GraphQL schema defines `contentParagraphs` as `JSON` (untyped scalar), so TypeScript could not catch this mismatch at compile time. When React Native's `<Text>` component received an array, it implicitly stringified it, losing all paragraph separation.

## Investigation Steps

1. Examined CMS schema: `contentParagraphs` is `type: "json"` in `apps/cms/src/components/sections/text.json:27-30`
2. Checked GraphQL schema: `contentParagraphs: JSON` in `apps/cms/schema.graphql:793`
3. Checked CMS seed data: `apps/cms/src/bootstrap/seed-easter.ts:509-513` — seeded as a 3-element string array
4. Found web app handles it correctly: `apps/web/src/components/sections/Text.tsx:45-47` uses `Array.isArray()` check
5. Traced mobile pipeline: query aliases `contentParagraphs` as `textContent`, mapper passes through uncoerced, model types as `string`

## Solution

### 1. Update model type (`sectionModels.ts`)

```typescript
// Before
content: string

// After
content: string[]
```

### 2. Add safe array coercion in mapper (`sectionMapper.ts`)

Use `.filter()` type guard instead of `as string[]` cast to validate each element:

```typescript
const rawContent = raw.textContent
const content = Array.isArray(rawContent)
  ? rawContent.filter((item): item is string => typeof item === "string")
  : typeof rawContent === "string"
    ? [rawContent]
    : []
```

This handles three cases:

- **Array of strings** (happy path): filters to only valid string elements
- **Single string** (backward compat): wraps in an array
- **Null/undefined/other** (defensive): returns empty array

### 3. Render paragraphs as separate Text elements (`TextRenderer.tsx`)

```tsx
{
  content.map((paragraph, index) => (
    <Text
      key={index}
      style={[
        styles.content,
        contentToken,
        isOnDark && styles.contentLight,
        index < content.length - 1 && styles.paragraphSpacing,
      ]}
    >
      {paragraph}
    </Text>
  ))
}
```

Add spacing style:

```typescript
paragraphSpacing: {
  marginBottom: 16
}
```

The conditional `index < content.length - 1` ensures no trailing margin after the last paragraph. Paragraphs render directly as siblings — no unnecessary wrapping `<View>`.

### 4. Update tests

- Changed all test fixtures from `content: "text"` to `content: ["text"]`
- Added backward-compatibility coercion tests:

```typescript
it("coerces a single string textContent into an array", () => {
  const legacyRaw = { ...rawText, textContent: "Legacy single string" }
  const [section] = mapSections([legacyRaw] as any)
  if (section.kind !== "text") return
  expect(section.content).toEqual(["Legacy single string"])
})

it("returns empty content array for null textContent", () => {
  const nullRaw = { ...rawText, textContent: null }
  const [section] = mapSections([nullRaw] as any)
  if (section.kind !== "text") return
  expect(section.content).toEqual([])
})

it("filters non-string elements from textContent array", () => {
  const mixedRaw = {
    ...rawText,
    textContent: ["Valid", 42, null, "Also valid"],
  }
  const [section] = mapSections([mixedRaw] as any)
  if (section.kind !== "text") return
  expect(section.content).toEqual(["Valid", "Also valid"])
})
```

## Verification

1. **Unit tests**: `pnpm test` in apps/mobile — 198 tests pass across 23 suites
2. **Visual check**: Text sections with multiple paragraphs now render with 16px spacing between each paragraph
3. **Cross-platform**: Mobile rendering now matches web app paragraph separation

## Prevention Strategies

### Treat every GraphQL `JSON` scalar as `unknown`

Strapi `type: "json"` fields arrive as untyped `JSON` through GraphQL. Always validate shape with `Array.isArray()` and element-level type guards (`.filter()`) rather than bare type assertions (`as string[]`).

### Check web app first for reference

When the mobile app misrenders CMS data, the web app often already has the correct handling. Use it as a reference implementation before investigating further.

### Assert structural shape in mapper tests

Tests for mappers that consume JSON scalars must verify the **shape** of the output, not just existence. Use `Array.isArray()` and `toEqual()` to catch type mismatches:

```typescript
expect(Array.isArray(result.content)).toBe(true)
expect(result.content).toEqual(["expected", "values"])
```

### 4-layer pipeline consistency

Model, mapper, renderer, and tests must all agree on the type. When changing a field type, update all four layers in the same commit. Missing any layer creates silent bugs.

## Cross-References

- **Web app reference**: `apps/web/src/components/sections/Text.tsx:45-97` — correct array handling
- **CMS schema**: `apps/cms/src/components/sections/text.json:27-30` — JSON field definition
- **4-layer pipeline pattern**: `docs/solutions/mobile/quiz-button-section-webview-modal-pipeline.md`
- **Array coercion precedent**: `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md`
- **Typography tokens**: `docs/solutions/mobile/responsive-typography-hook.md` — `useTypography()` pattern used for content styling
