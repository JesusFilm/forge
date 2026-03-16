---
artifactType: plan
sourceIssueNumber: 163
sourceIssueTitle: "feat(web): add /watch/easter route page"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/163"
linkedPrs: []
---

# Plan Artifact: #163

## Objective

- A new route `/watch/easter` exists in the web app.
- The page follows existing `/watch` layout, navigation, and SEO patterns.
- Content can be updated without code changes where feasible (e.g. via CMS-driven content blocks).

## Planned approach

1. Add a new page under `apps/web` following the existing `/watch` routing structure and reuse existing page shell components.
2. Wire the page content to CMS-driven sections (e.g. hero, featured content lists) so editors can update Easter content without redeploying.

## Validation

- [ ] Navigating to `/watch/easter` renders a dedicated Easter page with no errors.
- [ ] The route integrates cleanly with existing `/watch` routing and navigation.
- [ ] Page uses existing shared layout components (header, footer, shell) and SEO utilities.
- [ ] Basic SEO metadata is set (title, description, Open Graph) at parity with other `/watch` pages.
- [ ] Page is responsive and passes accessibility checks comparable to existing `/watch` routes.

## Source links

- Issue: [#163](https://github.com/JesusFilm/forge/issues/163)
- PRs:
- None
