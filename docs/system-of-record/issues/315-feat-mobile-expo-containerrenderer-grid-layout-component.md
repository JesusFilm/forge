---
artifactType: issue
issueNumber: 315
issueTitle: "feat(mobile-expo): ContainerRenderer grid layout component"
issueUrl: "https://github.com/JesusFilm/forge/issues/315"
state: "CLOSED"
closedAt: "2026-03-11T00:46:03Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #315

## Background

The `Container` type provides grid-based layout by grouping content into slots with `gridSpan` values. Each slot contains its own nested `content` dynamic zone. This is used for multi-column layouts on experience pages (e.g. side-by-side video + text). The SectionDispatcher must already be functional with leaf renderers before this wrapper can render nested content.

## Expected outcome

- A `ContainerRenderer` component that implements grid layout with slots and recursively renders nested content via the SectionDispatcher.
- Accepts typed props from the data layer (Container model from #304).

## Acceptance criteria

- [ ] Renders slots in a grid/flex layout respecting each slot's `gridSpan` value (e.g. gridSpan 6 = half width in a 12-column grid, or proportional flex).
- [ ] Each slot's `content` array rendered by calling the SectionDispatcher for each child item.
- [ ] Handles empty slots array gracefully.
- [ ] Handles slots with empty content gracefully.
- [ ] Replaces the Container stub in SectionDispatcher.
- [ ] Does not break if nested content contains another Container or Section (recursive).
- [ ] Responsive: stacks slots vertically on narrow screens if needed.

## Possible solution(s)

1. Flexbox row with each slot's `flex` set proportional to `gridSpan` (e.g. `flex: gridSpan`).
2. Each slot is a View wrapping its content array mapped through SectionDispatcher.
3. Consider stacking vertically on small screens (single-column fallback).

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold), leaf renderer sub-issues (so nested content can render)
- Schema: `ComponentSectionsContainer` — sectionKey, slots[] → `ComponentSectionsContainerSlot` (gridSpan, content[] → `ContainerSlotContentDynamicZone` line 511)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
