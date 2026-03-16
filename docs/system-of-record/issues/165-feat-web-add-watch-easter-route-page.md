---
artifactType: issue
issueNumber: 165
issueTitle: "feat(web): add /watch/easter route page"
issueUrl: "https://github.com/JesusFilm/forge/issues/165"
state: "CLOSED"
closedAt: "2026-03-08T22:26:36Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #165

## Background

We need a dedicated Easter-focused watch page so that campaigns and traffic can be directed to a single, thematically curated destination. This route should highlight Easter content and fit within the existing `/watch` experience patterns.

## Expected outcome

A new page is available at `/watch/easter` in the web app, following existing design systems and navigation patterns, and showing curated Easter content. The page can be safely linked from marketing campaigns and internal tools without additional configuration.

## Acceptance criteria

- [ ] `/watch/easter` route is implemented in the web app and deploys without errors.
- [ ] Page uses the existing watch layout/navigation so it feels consistent with other `/watch` routes.
- [ ] Easter-specific content (copy and media slots) can be updated without code changes (e.g. via CMS/config or existing content mechanisms).
- [ ] Basic SEO metadata is set for the page (title, description, canonical) appropriate for Easter.
- [ ] Page is responsive and works on mobile, tablet, and desktop.

## Possible solution(s)

1. Add a new Next.js route under the existing `/watch` section (e.g. a route module or page component for `/watch/easter`) reusing existing watch layout components.
2. Configure content to come from Strapi or another existing CMS/content source so that Easter copy and assets can be updated editorially.
3. Add any necessary feature flags or configuration so the route can be enabled/disabled without code changes if required.

## References

- Existing `/watch` routes and components in `apps/web`.
- Any existing Easter or seasonal campaign pages (to align design and messaging).

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
