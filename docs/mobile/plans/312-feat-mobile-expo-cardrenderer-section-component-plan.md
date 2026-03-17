---
artifactType: plan
sourceId: 312
sourceTitle: "feat(mobile-expo): CardRenderer section component"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: "feat(mobile-expo): CardRenderer section component"

## Objective

- A `CardRenderer` component that displays a card with media and text.
- Accepts typed props from the data layer (Card model from #304).

## Planned approach

1. Pressable View with optional Image, title Text, description Text.
2. Featured variant gets larger image, bolder styling, or different layout.

## Validation

- [ ] Renders `title` and `description` text.
- [ ] Displays `media` image (UploadFile) when present.
- [ ] Tappable via `link` (opens URL or navigates).
- [ ] Supports `variant` styling: default and featured (more prominent/larger).
- [ ] Handles missing optional fields gracefully (e.g. no image if media is absent).
- [ ] Replaces the Card stub in SectionDispatcher.
- [ ] Accessible (labels, tap targets).

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsCard` — title, description, media (UploadFile), link, variant (default/featured), sectionKey

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
