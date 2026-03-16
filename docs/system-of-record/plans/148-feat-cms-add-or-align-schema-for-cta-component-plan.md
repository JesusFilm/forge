---
artifactType: plan
sourceIssueNumber: 148
sourceIssueTitle: "feat(cms): add or align schema for CTA component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/148"
linkedPrs: []
---

# Plan Artifact: #148

## Objective

- CTA component has a defined schema: at least label, link (or URL), optional heading/description, and any variant (e.g. primary/secondary) for the web app.

## Planned approach

1. Review `sections/cta.json`; add missing fields (e.g. `variant`, `description`) and ensure link structure matches web.
2. If CTA is used inside other components, ensure it is registered as a nested component where needed.

## Validation

- [ ] CTA component schema is defined or updated in CMS (e.g. `apps/cms/src/components/sections/cta.json`).
- [ ] Attributes cover label, link/URL, optional heading/description and variant.
- [ ] Component registered and available; GraphQL regenerated if contracts change.

## Source links

- Issue: [#148](https://github.com/JesusFilm/forge/issues/148)
- PRs:
- None
