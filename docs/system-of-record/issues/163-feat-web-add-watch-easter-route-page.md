---
artifactType: issue
issueNumber: 163
issueTitle: "feat(web): add /watch/easter route page"
issueUrl: "https://github.com/JesusFilm/forge/issues/163"
state: "CLOSED"
closedAt: "2026-03-09T19:45:03Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #163

## Background

We need a dedicated page at `/watch/easter` within the web app to highlight Easter-specific content and campaigns. This route should follow existing `/watch` patterns so it can be linked from marketing and internal tools.

## Expected outcome

- A new route `/watch/easter` exists in the web app.
- The page follows existing `/watch` layout, navigation, and SEO patterns.
- Content can be updated without code changes where feasible (e.g. via CMS-driven content blocks).

## Acceptance criteria

- [ ] Navigating to `/watch/easter` renders a dedicated Easter page with no errors.
- [ ] The route integrates cleanly with existing `/watch` routing and navigation.
- [ ] Page uses existing shared layout components (header, footer, shell) and SEO utilities.
- [ ] Basic SEO metadata is set (title, description, Open Graph) at parity with other `/watch` pages.
- [ ] Page is responsive and passes accessibility checks comparable to existing `/watch` routes.

## Possible solution(s)

1. Add a new page under `apps/web` following the existing `/watch` routing structure and reuse existing page shell components.
2. Wire the page content to CMS-driven sections (e.g. hero, featured content lists) so editors can update Easter content without redeploying.

## References

- Existing `/watch` routes and components in the web app for layout and routing patterns.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
