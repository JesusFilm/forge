---
artifactType: issue
issueNumber: 155
issueTitle: "feat(web): add Section component (background, blur hash, children)"
issueUrl: "https://github.com/JesusFilm/forge/issues/155"
state: "CLOSED"
closedAt: "2026-03-16T02:45:02Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #155

## Background

The CMS will expose Section blocks with background color, blur hash, and child items (see feat(cms) schema issue). The web app needs a Section wrapper component that applies background styling and optional blur-hash placeholder, and renders children.

## Expected outcome

- A Section component in `apps/web` that consumes Section block data (backgroundColor, blurHash, items/children) and renders a styled section with correct background and child content.

## Acceptance criteria

- [ ] Section component implemented and wired to API/GraphQL shape.
- [ ] Applies background color (or theme) from schema.
- [ ] Uses blur hash for placeholder/loading where applicable.
- [ ] Renders children/items (e.g. via dynamic component map); integrated into page rendering.

## Possible solution(s)

1. Add `apps/web/src/components/sections/Section.tsx`; apply `backgroundColor`/theme and optional blur-hash image placeholder; map `items` to section children components.
2. Integrate with existing layout/section wrapper if one exists; keep styling tokens consistent.

## References

- Resolves/Implements schema: #145 (feat(cms): add schema for Section component)
- `apps/web` component structure

- Parent: #176 Epic B (Web)
- Related (CMS schema): #145

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
