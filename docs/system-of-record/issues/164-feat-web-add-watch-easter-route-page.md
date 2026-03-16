---
artifactType: issue
issueNumber: 164
issueTitle: "feat(web): add /watch/easter route page"
issueUrl: "https://github.com/JesusFilm/forge/issues/164"
state: "CLOSED"
closedAt: "2026-03-09T19:52:15Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #164

## Background

We need a dedicated watch page for the Easter event so that live and/or on-demand video is available at a predictable URL.

## Expected outcome

A new public route `/watch/easter` exists in the web app, consistent with existing watch pages and powered by content from the CMS.

## Acceptance criteria

- [ ] Visiting `/watch/easter` in production renders without error.
- [ ] Layout and theming match existing watch or series pages.
- [ ] Core content (title, description, hero image, video or livestream embed configuration) is editable in the CMS.
- [ ] Page is responsive across mobile, tablet, and desktop.
- [ ] Basic SEO metadata (title and description) is set appropriately.

## Possible solution(s)

1. Add a new route/page component for `/watch/easter` in the web app, following patterns from existing `/watch` pages.
2. Extend or reuse existing CMS content types to drive copy, imagery, and video configuration for the Easter page.

## References

- Existing `/watch/...` route implementations in the web app.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
