---
artifactType: plan
sourceIssueNumber: 153
sourceIssueTitle: "feat(web): add Container component (side-by-side items)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/153"
linkedPrs: []
---

# Plan Artifact: #153

## Objective

- A Container component in `apps/web` that accepts container block data (items, optional layout/ratio) and renders children side by side with correct responsive behavior.

## Planned approach

1. Add `apps/web/src/components/sections/Container.tsx`; map `items` to child component by type (text, image, etc.) and apply layout via CSS grid/flex.
2. Use existing layout primitives; keep one component per schema component for clear ownership.

## Validation

- [ ] Container component implemented and wired to API/GraphQL shape.
- [ ] Renders repeatable items (e.g. text, image, nested components) in side-by-side layout.
- [ ] Supports layout options (e.g. ratio, order) from schema; responsive (stack on small screens if needed).
- [ ] Integrated into dynamic zone or section rendering.

## Source links

- Issue: [#153](https://github.com/JesusFilm/forge/issues/153)
- PRs:
- None
