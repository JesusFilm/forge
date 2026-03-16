---
artifactType: plan
sourceIssueNumber: 155
sourceIssueTitle: "feat(web): add Section component (background, blur hash, children)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/155"
linkedPrs: []
---

# Plan Artifact: #155

## Objective

- A Section component in `apps/web` that consumes Section block data (backgroundColor, blurHash, items/children) and renders a styled section with correct background and child content.

## Planned approach

1. Add `apps/web/src/components/sections/Section.tsx`; apply `backgroundColor`/theme and optional blur-hash image placeholder; map `items` to section children components.
2. Integrate with existing layout/section wrapper if one exists; keep styling tokens consistent.

## Validation

- [ ] Section component implemented and wired to API/GraphQL shape.
- [ ] Applies background color (or theme) from schema.
- [ ] Uses blur hash for placeholder/loading where applicable.
- [ ] Renders children/items (e.g. via dynamic component map); integrated into page rendering.

## Source links

- Issue: [#155](https://github.com/JesusFilm/forge/issues/155)
- PRs:
- None
