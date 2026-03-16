---
artifactType: issue
issueNumber: 143
issueTitle: "feat(cms): add schema for Container component (side-by-side items)"
issueUrl: "https://github.com/JesusFilm/forge/issues/143"
state: "CLOSED"
closedAt: "2026-03-04T03:58:23Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #143

## Background

Need a Container component that handles content laid out side by side, with items taken as repeatable content so editors can build flexible two-column (or multi-column) sections in the CMS.

## Expected outcome

- A Container component exists that accepts a list of items (e.g. repeatable component or blocks).
- Schema supports side-by-side layout configuration (e.g. ratio, order) so the web app can render content accordingly.

## Acceptance criteria

- [ ] Container component JSON schema added in CMS.
- [ ] Component accepts `items` (or equivalent) as repeatable children.
- [ ] Component registered and available where needed; GraphQL regenerated if contracts change.

## Possible solution(s)

1. Add `components/sections/container.json` with `items` (type: component, repeatable: true) and optional `layout` / `ratio` enum or string.
2. Use a shared `container-item` component for each slot so items can be polymorphic (text, image, etc.).

## References

- `apps/cms/src/components/sections/`
- `apps/cms/schema.graphql`

- Parent: #175 Epic A (CMS)
- Related (web implementation): #153

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
