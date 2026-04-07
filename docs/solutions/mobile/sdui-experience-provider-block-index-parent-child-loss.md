---
title: "Video detail page missing sibling content from parent sectionWrapper"
category: mobile
date: 2026-04-07
tags:
  [
    sdui,
    experience-provider,
    video-detail,
    sibling-content,
    react-native,
    expo,
    navigation,
    block-index,
  ]
module: apps/mobile-v2
severity: high
---

# Video Detail Page Missing Sibling Content From Parent SectionWrapper

## Problem

In the `apps/mobile-v2` SDUI app, tapping a video thumbnail on the home page navigated to a video detail page that only showed the video player, title, and description. All associated sibling content from the parent Experience section — text blocks, related questions, Bible quotes carousel, quiz buttons, Easter dates — was missing.

## Root Cause

`ExperienceProvider` builds an O(1) `Map<string, NormalizedBlock>` indexed by `sectionKey` for fast lookups from detail screens. A `sectionWrapper` and its video child have **different** `sectionKey` values (e.g., parent: `"my-last-day-section"`, child: `"my-last-day/english"`).

When `VideoCardRenderer` navigates to `/video/[sectionKey]` using the video's key, `useSectionByKey` returns only the video block — which has no `sectionContent`. The parent sectionWrapper (holding all sibling blocks) is indexed under a different key. The video detail page had no path back to sibling content.

**Key insight:** The block index is the single lookup mechanism for route-level rendering. If sibling context is needed at the route level, it must be attached to each block **at indexing time**, not reconstructed later.

## Solution

Attach a synthetic `siblingContent` field to each child block during the indexing pass, carrying forward the parent sectionWrapper's `sectionContent` array.

### ExperienceProvider — indexBlock with siblingContent propagation

```typescript
// apps/mobile-v2/src/contexts/ExperienceProvider.tsx
function indexBlock(
  block: NormalizedBlock,
  siblingContent?: NormalizedBlock[],
) {
  const key =
    (block.sectionKey as string | undefined) ?? (block.id as string | undefined)
  if (key) {
    map.set(key, siblingContent ? { ...block, siblingContent } : block)
  }

  if (block.kind === "sectionWrapper" && Array.isArray(block.sectionContent)) {
    const children = block.sectionContent as NormalizedBlock[]
    for (const child of children) {
      indexBlock(child, children)
    }
  }

  // Containers are structural wrappers — their children see the
  // enclosing sectionWrapper's content, not the slot's own content.
  if (block.kind === "container" && Array.isArray(block.slots)) {
    for (const slot of block.slots as Array<{
      slotContent?: NormalizedBlock[]
    }>) {
      if (Array.isArray(slot.slotContent)) {
        for (const child of slot.slotContent) {
          indexBlock(child, siblingContent)
        }
      }
    }
  }
}
```

### Video detail page — consuming siblingContent

```typescript
// apps/mobile-v2/app/video/[sectionKey].tsx
const siblings = (section.siblingContent as NormalizedBlock[] | undefined) ?? []
const currentKey = section.sectionKey as string | undefined
const nestedContent = siblings.filter(
  (c) => (c.sectionKey as string | undefined) !== currentKey,
)
```

The existing `ContentDispatcher` renders siblings automatically — no new rendering code needed.

## Design Decisions

| Decision                     | Chosen                                 | Rejected                           | Rationale                                                                                             |
| ---------------------------- | -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Where to attach siblings     | At index time in `indexBlock`          | At render time via parent lookup   | Single point of enrichment; no reverse-index needed                                                   |
| Sibling filter strategy      | sectionKey identity comparison         | `kind !== "video"` exclusion       | Preserves other video siblings; more correct semantically                                             |
| Fallback to `sectionContent` | No fallback (YAGNI)                    | `siblingContent ?? sectionContent` | A video's `sectionContent` is its own children, not siblings — conflating the two is a semantic error |
| Synthetic field naming       | `siblingContent` (no underscore)       | `_siblingContent`                  | Consistent with `kind`, which is also a synthetic field without underscore prefix                     |
| Container propagation        | Pass parent's `siblingContent` through | Stop propagation at container      | Containers are structural wrappers, not semantic boundaries                                           |

## Prevention

1. **Indexing is tree-flattening, not list-scanning.** Every child entering the index must carry its structural context. When adding new detail-style routes that need parent context, check whether parent and child share the same `sectionKey`. If they differ, the child needs an explicit reference.

2. **New structural block types** (like `container`) that nest children should propagate `siblingContent` from the enclosing sectionWrapper, not from their own content arrays.

3. **Filter by identity, not by kind.** When rendering siblings, exclude the current item by its `sectionKey`, never by `kind`. Filtering by kind drops legitimate sibling items of the same type.

4. **No underscore prefixes for synthetic fields.** Synthetic fields added during indexing (`kind`, `siblingContent`) use plain, descriptive names — consistent with CMS-sourced field naming.

## Entry Points

- `apps/mobile-v2/src/contexts/ExperienceProvider.tsx` — `indexBlock` function with `siblingContent` propagation
- `apps/mobile-v2/app/video/[sectionKey].tsx` — reads `siblingContent`, filters current video, renders via ContentDispatcher
- `apps/mobile-v2/src/components/sections/ContentDispatcher.tsx` — renders sibling blocks

## Grep These

- `siblingContent` — the synthetic field attached during indexing
- `indexBlock` — the recursive function that builds the section map
- `useSectionByKey` — the hook that consumers use for O(1) lookup

## Cross-References

- `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md` — sectionKey encoding/decoding that happens before lookup
- `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md` — overall SDUI architecture and normalizer type erasure
- `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md` — composite React keys for dynamic zone content
- `docs/solutions/mobile/quiz-button-section-webview-modal-pipeline.md` — canonical 4-layer section pipeline example
