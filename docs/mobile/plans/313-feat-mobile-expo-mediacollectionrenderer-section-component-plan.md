---
artifactType: plan
sourceIssueNumber: 313
sourceIssueTitle: "feat(mobile-expo): MediaCollectionRenderer section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/313"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #313

## Objective

- A `MediaCollectionRenderer` component that handles all 5 variants and renders a collection of media items.
- Accepts typed props from the data layer (MediaCollection model from #304).

## Planned approach

1. Single component with internal variant switch: FlatList (horizontal for carousel, vertical for collection), multi-column FlatList for grid, single-item View for hero, player-specific layout for player.
2. Shared `MediaCollectionItem` sub-component used across variants.
3. Item number overlay or prefix when `showItemNumbers` is true.

## Validation

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

## Source links

- Issue: [#313](https://github.com/JesusFilm/forge/issues/313)
- PRs:
- None
