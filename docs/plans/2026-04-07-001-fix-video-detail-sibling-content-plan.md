---
title: "fix: Video detail page renders sibling content from parent section"
type: fix
status: completed
date: 2026-04-07
origin: docs/brainstorms/2026-04-07-video-detail-sibling-content-requirements.md
---

# fix: Video detail page renders sibling content from parent section

## Overview

When tapping a video thumbnail on the home page, the video detail page only shows the video player, title, and description. All associated content from the parent Experience section (text blocks, containers with related questions, Bible quote carousels, quiz buttons, date displays) is missing.

## Problem Statement

The video detail page navigates via the **video child's** `sectionKey` (e.g., `"my-last-day/english"`), but the sibling content lives on the **parent sectionWrapper** (keyed `"my-last-day-section"`). The `ExperienceProvider` indexes both separately — the video detail page gets the video block, which has no `sectionContent`, so siblings never render.

**Correction from brainstorm**: The original brainstorm assumed a key collision between parent and child. Research confirmed the keys are **different** — the parent sectionWrapper and its video child have distinct `sectionKey` values. The fix is not index-order reversal but rather **attaching parent context to child blocks during indexing** (see origin: `docs/brainstorms/2026-04-07-video-detail-sibling-content-requirements.md`).

## Proposed Solution

Attach the parent sectionWrapper's `sectionContent` array to each child block as a synthetic `_siblingContent` field during the indexing pass in `ExperienceProvider`. The video detail page reads `_siblingContent` to render siblings, while video-specific fields (`streamingUrl`, `videoRef`, etc.) remain directly accessible on the block.

## Implementation

### Step 1: ExperienceProvider — attach parent content during indexing

**File**: `apps/mobile-v2/src/contexts/ExperienceProvider.tsx` (lines 39-67)

Modify `indexBlock` to accept an optional `parentContent` parameter. When indexing children of a sectionWrapper, pass the parent's `sectionContent`. When storing a block that has `parentContent`, spread the block with `_siblingContent` attached:

```typescript
// apps/mobile-v2/src/contexts/ExperienceProvider.tsx
function indexBlock(block: NormalizedBlock, parentContent?: NormalizedBlock[]) {
  const key =
    (block.sectionKey as string | undefined) ?? (block.id as string | undefined)
  if (key) {
    map.set(
      key,
      parentContent ? { ...block, _siblingContent: parentContent } : block,
    )
  }

  // Index nested content in sectionWrapper
  if (block.kind === "sectionWrapper" && Array.isArray(block.sectionContent)) {
    for (const child of block.sectionContent as NormalizedBlock[]) {
      indexBlock(child, block.sectionContent as NormalizedBlock[])
    }
  }

  // Index nested content in container slots
  if (block.kind === "container" && Array.isArray(block.slots)) {
    for (const slot of block.slots as Array<{
      slotContent?: NormalizedBlock[]
    }>) {
      if (Array.isArray(slot.slotContent)) {
        for (const child of slot.slotContent) {
          indexBlock(child, parentContent)
        }
      }
    }
  }
}
```

**Key details:**

- Shallow spread (`{ ...block, _siblingContent: parentContent }`) avoids mutating the original normalized block
- Container slots pass through the existing `parentContent` so deeply nested blocks can still reference their sectionWrapper's content
- Top-level sections pass no `parentContent` — behavior unchanged for blocks not inside a sectionWrapper

### Step 2: Video detail page — read `_siblingContent` for sibling rendering

**File**: `apps/mobile-v2/app/video/[sectionKey].tsx` (lines 146-149)

Replace the existing `sectionContent` extraction:

```typescript
// Before (line 146-149):
const sectionContent =
  (section.sectionContent as NormalizedBlock[] | undefined) ?? []
const nestedContent = sectionContent.filter((c) => c.kind !== "video")

// After:
const siblingContent =
  (section._siblingContent as NormalizedBlock[] | undefined) ??
  (section.sectionContent as NormalizedBlock[] | undefined) ??
  []
const nestedContent = siblingContent.filter((c) => c.kind !== "video")
```

**Fallback chain:**

1. `_siblingContent` — synthetic field from parent sectionWrapper (the common case)
2. `sectionContent` — for sectionWrapper blocks looked up directly (edge case / future-proofing)
3. `[]` — bare top-level videos with no parent context

No other changes needed — the existing `ContentDispatcher` at line 303-305 already handles rendering whatever blocks are in `nestedContent`.

## Acceptance Criteria

- [ ] Tapping "Easter Explained" shows video player + text + easter-dates container + text + related-questions container + Bible quotes carousel + quiz button
- [ ] Tapping any video on the Christmas experience shows its corresponding sibling content
- [ ] Bare top-level videos (if any) still render correctly without errors
- [ ] Home feed rendering and section classification are unaffected
- [ ] No changes to CMS data model or GraphQL schema

## Gotchas from Institutional Learnings

- **Composite React keys**: ContentDispatcher already uses `${kind}-${id}-${index}` keys — verify this holds for newly rendered siblings (see `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md`)
- **Type erasure at normalizer boundary**: `_siblingContent` will need `as NormalizedBlock[]` cast — this matches existing codebase patterns with ~60 `as` casts in renderers
- **Fragment nesting depth**: All sibling block types (text, container, relatedQuestions, bibleQuotesCarousel, quizButton, easterDates) are already queried at the correct nesting level in `SectionFragment` — no GraphQL query changes needed

## Sources

- **Origin document:** [docs/brainstorms/2026-04-07-video-detail-sibling-content-requirements.md](docs/brainstorms/2026-04-07-video-detail-sibling-content-requirements.md) — key decision: generic rendering via existing ContentDispatcher, no new hooks
- Existing pattern: `SectionDispatcher.classifySection` extracts video from sectionWrapper (line 22-26)
- Institutional learning: `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md`
- Institutional learning: `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md`
