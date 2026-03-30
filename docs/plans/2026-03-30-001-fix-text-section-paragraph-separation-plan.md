---
title: "fix: Render contentParagraphs as separate paragraphs in mobile TextRenderer"
type: fix
status: completed
date: 2026-03-30
---

# fix: Render contentParagraphs as separate paragraphs in mobile TextRenderer

## Overview

The mobile `TextRenderer` component concatenates the `contentParagraphs` JSON array into a single string, producing a wall of text with no paragraph breaks. The web app already handles this correctly by mapping each array element to a separate `<p>` tag. The mobile app needs the same treatment.

## Problem Statement

The CMS stores `contentParagraphs` as a JSON array of strings (e.g. `["First paragraph.", "Second paragraph."]`). The GraphQL schema defines it as `JSON` type (`apps/cms/schema.graphql:793`).

**Current mobile pipeline:**

1. GraphQL query aliases `contentParagraphs` as `textContent` (`apps/mobile/src/lib/graphql/queries.ts:132`, plus 3 duplicate fragments at lines 237, 364, 507)
2. `sectionModels.ts:101` defines `content: string` (single string)
3. `sectionMapper.ts:159` maps `content: raw.textContent` directly (no array handling)
4. `TextRenderer.tsx:55-59` renders a single `<Text>{content}</Text>`

**Result:** The JSON array is coerced to a single string, all paragraphs run together with no visual separation.

**Web app reference** (`apps/web/src/components/sections/Text.tsx:45-47`):

```typescript
const paragraphs = Array.isArray(contentParagraphs)
  ? (contentParagraphs as string[])
  : []
```

Each paragraph is then rendered as a separate `<p>` with spacing.

## Proposed Solution

Update the mobile 4-layer pipeline (model, mapper, renderer, tests) to treat `contentParagraphs` as a `string[]` and render each element as a separate `<Text>` with paragraph spacing.

## Acceptance Criteria

- [ ] `TextSection.content` type changed from `string` to `string[]` in `apps/mobile/src/lib/sectionModels.ts`
- [ ] `mapText` in `apps/mobile/src/lib/sectionMapper.ts` safely coerces `raw.textContent` to `string[]` (handle both array and single-string fallback)
- [ ] `TextRenderer` in `apps/mobile/src/components/sections/TextRenderer.tsx` renders each paragraph as a separate `<Text>` with `marginBottom` spacing between them
- [ ] Existing tests updated to reflect the new array-based content
- [ ] New test case: multi-paragraph content renders without throwing
- [ ] Single-paragraph and empty-array edge cases handled gracefully

## MVP

### 1. `apps/mobile/src/lib/sectionModels.ts` - Change content type

```typescript
export interface TextSection {
  kind: "text"
  id: string
  sectionKey: string | null
  heading: string | null
  headingLevel: TextHeadingLevel | null
  subtitle: string | null
  content: string[] // was: string
  variant: TextVariant | null
}
```

### 2. `apps/mobile/src/lib/sectionMapper.ts` - Safe array coercion

```typescript
function mapText(
  raw: RawSection & { __typename: "ComponentSectionsText" },
): TextSection {
  const rawContent = raw.textContent
  const content = Array.isArray(rawContent)
    ? (rawContent as string[])
    : typeof rawContent === "string"
      ? [rawContent]
      : []

  return {
    kind: "text",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    heading: raw.textHeading ?? null,
    headingLevel: (raw.headingLevel as TextHeadingLevel) ?? null,
    subtitle: raw.textSubtitle ?? null,
    content,
    variant: (raw.textVariant as TextVariant) ?? null,
  }
}
```

### 3. `apps/mobile/src/components/sections/TextRenderer.tsx` - Render paragraphs separately

```tsx
{
  content.length > 0 && (
    <View>
      {content.map((paragraph, index) => (
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
      ))}
    </View>
  )
}
```

Add to styles:

```typescript
paragraphSpacing: {
  marginBottom: 16,
},
```

### 4. Update tests

- `apps/mobile/src/lib/sectionMapper.test.ts` - Change `textContent` fixture from `string` to `string[]`
- `apps/mobile/src/components/sections/TextRenderer.test.tsx` - Change `content` fixture from `string` to `string[]`, add multi-paragraph test case

## Files Affected

| File                                                        | Change                                    |
| ----------------------------------------------------------- | ----------------------------------------- |
| `apps/mobile/src/lib/sectionModels.ts`                      | `content: string` -> `content: string[]`  |
| `apps/mobile/src/lib/sectionMapper.ts`                      | Safe array coercion in `mapText`          |
| `apps/mobile/src/components/sections/TextRenderer.tsx`      | Map array to separate `<Text>` elements   |
| `apps/mobile/src/lib/sectionMapper.test.ts`                 | Update fixtures                           |
| `apps/mobile/src/components/sections/TextRenderer.test.tsx` | Update fixtures, add multi-paragraph test |

## Context

- The GraphQL query fragments do NOT need changes (they already fetch `contentParagraphs` correctly as JSON)
- There are 4 duplicate text fragments in `queries.ts` (lines 132, 237, 364, 507) - none need modification
- The `useTypography()` hook should continue to be used for the `contentToken` style
- Follow the web app's defensive `Array.isArray` check pattern since `contentParagraphs` is typed as `JSON` in GraphQL

## Sources

- Web app reference implementation: `apps/web/src/components/sections/Text.tsx:45-97`
- CMS schema definition: `apps/cms/src/components/sections/text.json:27-30`
- CMS seed data showing array format: `apps/cms/src/bootstrap/seed-easter.ts:509-513`
- Institutional learning: `docs/solutions/mobile/media-collection-overlay-carousel-pipeline.md` (4-layer pipeline pattern)
- Institutional learning: `docs/solutions/mobile/responsive-typography-hook.md` (use `useTypography()` tokens)
