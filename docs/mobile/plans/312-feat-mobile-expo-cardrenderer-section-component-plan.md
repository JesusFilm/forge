---
artifactType: plan
sourceIssueNumber: 312
sourceIssueTitle: "feat(mobile-expo): CardRenderer section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/312"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #312

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

## Source links

- Issue: [#312](https://github.com/JesusFilm/forge/issues/312)
- PRs:
- None
