---
artifactType: issue
issueNumber: 313
issueTitle: "feat(mobile-expo): MediaCollectionRenderer section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/313"
state: "CLOSED"
closedAt: "2026-03-11T00:28:26Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #313

## Background

The `MediaCollection` section type is the most versatile section — it powers video grids, carousels, hero features, player embeds, and numbered course lists across experience pages. It has 5 layout variants and rich item-level overrides. This issue implements the React Native renderer.

## Expected outcome

- A `MediaCollectionRenderer` component that handles all 5 variants and renders a collection of media items.
- Accepts typed props from the data layer (MediaCollection model from #304).

## Acceptance criteria

- [ ] Renders `title`, `subtitle`, `description`, `categoryLabel`, and `footerText` when present.
- [ ] Supports all 5 `variant` layouts:
  - `carousel` — horizontal scrollable row of items.
  - `collection` — vertical list of items.
  - `grid` — multi-column grid of items.
  - `hero` — single featured item with prominent styling.
  - `player` — embedded player-style layout.
- [ ] Each item renders: video thumbnail (from `video.image` or `imageOverride`), `titleOverride` / `subtitleOverride` (falling back to video title/slug), `collectionSize`.
- [ ] `showItemNumbers` — when true, displays sequential numbers on each item.
- [ ] `linkToSectionKey` — items can deep-link to another section on the page (wire tap handler or pass through).
- [ ] `ctaLink` — optional link rendered as a tappable element on the collection.
- [ ] Handles empty items array gracefully.
- [ ] Replaces the MediaCollection stub in SectionDispatcher.
- [ ] Accessible (scroll hints, item labels, tap targets).

## Possible solution(s)

1. Single component with internal variant switch: FlatList (horizontal for carousel, vertical for collection), multi-column FlatList for grid, single-item View for hero, player-specific layout for player.
2. Shared `MediaCollectionItem` sub-component used across variants.
3. Item number overlay or prefix when `showItemNumbers` is true.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsMediaCollection` — title, subtitle, description, categoryLabel, footerText, ctaLink, variant (carousel/collection/grid/hero/player), showItemNumbers, sectionKey, items[] → `ComponentSectionsMediaCollectionItem` (video, imageOverride, titleOverride, subtitleOverride, linkToSectionKey, collectionSize)
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — video grids, film poster grid, day-by-day series, new believer course

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
