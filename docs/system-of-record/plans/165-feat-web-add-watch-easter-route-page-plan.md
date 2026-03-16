---
artifactType: plan
sourceIssueNumber: 165
sourceIssueTitle: "feat(web): add /watch/easter route page"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/165"
linkedPrs: []
---

# Plan Artifact: #165

## Objective

A new page is available at `/watch/easter` in the web app, following existing design systems and navigation patterns, and showing curated Easter content. The page can be safely linked from marketing campaigns and internal tools without additional configuration.

## Planned approach

1. Add a new Next.js route under the existing `/watch` section (e.g. a route module or page component for `/watch/easter`) reusing existing watch layout components.
2. Configure content to come from Strapi or another existing CMS/content source so that Easter copy and assets can be updated editorially.
3. Add any necessary feature flags or configuration so the route can be enabled/disabled without code changes if required.

## Validation

- [ ] `/watch/easter` route is implemented in the web app and deploys without errors.
- [ ] Page uses the existing watch layout/navigation so it feels consistent with other `/watch` routes.
- [ ] Easter-specific content (copy and media slots) can be updated without code changes (e.g. via CMS/config or existing content mechanisms).
- [ ] Basic SEO metadata is set for the page (title, description, canonical) appropriate for Easter.
- [ ] Page is responsive and works on mobile, tablet, and desktop.

## Source links

- Issue: [#165](https://github.com/JesusFilm/forge/issues/165)
- PRs:
- None
