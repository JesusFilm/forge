---
artifactType: issue
issueNumber: 312
issueTitle: "feat(mobile-expo): CardRenderer section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/312"
state: "CLOSED"
closedAt: "2026-03-11T00:16:37Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #312

## Background

The `Card` section type renders a standalone card with title, description, media, and optional link — used for featured content blocks and promotional items on experience pages. This issue implements the React Native renderer.

## Expected outcome

- A `CardRenderer` component that displays a card with media and text.
- Accepts typed props from the data layer (Card model from #304).

## Acceptance criteria

- [ ] Renders `title` and `description` text.
- [ ] Displays `media` image (UploadFile) when present.
- [ ] Tappable via `link` (opens URL or navigates).
- [ ] Supports `variant` styling: default and featured (more prominent/larger).
- [ ] Handles missing optional fields gracefully (e.g. no image if media is absent).
- [ ] Replaces the Card stub in SectionDispatcher.
- [ ] Accessible (labels, tap targets).

## Possible solution(s)

1. Pressable View with optional Image, title Text, description Text.
2. Featured variant gets larger image, bolder styling, or different layout.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsCard` — title, description, media (UploadFile), link, variant (default/featured), sectionKey

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
