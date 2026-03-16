---
artifactType: issue
issueNumber: 153
issueTitle: "feat(web): add Container component (side-by-side items)"
issueUrl: "https://github.com/JesusFilm/forge/issues/153"
state: "CLOSED"
closedAt: "2026-03-16T02:44:58Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #153

## Background

The CMS will expose Container blocks with side-by-side items (see feat(cms) schema issue). The web app needs a Container component that renders these items in a configurable side-by-side (or multi-column) layout.

## Expected outcome

- A Container component in `apps/web` that accepts container block data (items, optional layout/ratio) and renders children side by side with correct responsive behavior.

## Acceptance criteria

- [ ] Container component implemented and wired to API/GraphQL shape.
- [ ] Renders repeatable items (e.g. text, image, nested components) in side-by-side layout.
- [ ] Supports layout options (e.g. ratio, order) from schema; responsive (stack on small screens if needed).
- [ ] Integrated into dynamic zone or section rendering.

## Possible solution(s)

1. Add `apps/web/src/components/sections/Container.tsx`; map `items` to child component by type (text, image, etc.) and apply layout via CSS grid/flex.
2. Use existing layout primitives; keep one component per schema component for clear ownership.

## References

- Resolves/Implements schema: #143 (feat(cms): add schema for Container component)
- `apps/web` component structure

- Parent: #176 Epic B (Web)
- Related (CMS schema): #143

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
