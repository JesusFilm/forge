---
artifactType: plan
sourceIssueNumber: 143
sourceIssueTitle: "feat(cms): add schema for Container component (side-by-side items)"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/143"
linkedPrs: []
---

# Plan Artifact: #143

## Objective

- A Container component exists that accepts a list of items (e.g. repeatable component or blocks).
- Schema supports side-by-side layout configuration (e.g. ratio, order) so the web app can render content accordingly.

## Planned approach

1. Add `components/sections/container.json` with `items` (type: component, repeatable: true) and optional `layout` / `ratio` enum or string.
2. Use a shared `container-item` component for each slot so items can be polymorphic (text, image, etc.).

## Validation

- [ ] Container component JSON schema added in CMS.
- [ ] Component accepts `items` (or equivalent) as repeatable children.
- [ ] Component registered and available where needed; GraphQL regenerated if contracts change.

## Source links

- Issue: [#143](https://github.com/JesusFilm/forge/issues/143)
- PRs:
- None
