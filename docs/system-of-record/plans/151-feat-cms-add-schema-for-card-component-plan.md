---
artifactType: plan
sourceIssueNumber: 151
sourceIssueTitle: "feat(cms): add schema for Card component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/151"
linkedPrs: []
---

# Plan Artifact: #151

## Objective

- A Card component exists with attributes such as image, title, description, optional link/CTA, and any variant (e.g. default, featured).

## Planned approach

1. Add `components/shared/card.json` or `sections/card.json` with `title`, `description` (text), `media` (file or relation), `link` (optional), `variant` (optional enum).
2. Reuse for card grids by placing Card in a repeatable container or section.

## Validation

- [ ] Card component JSON schema added in CMS.
- [ ] Attributes support at least title, description, optional media and link.
- [ ] Component registered and available in sections/containers; GraphQL regenerated if contracts change.

## Source links

- Issue: [#151](https://github.com/JesusFilm/forge/issues/151)
- PRs:
- None
