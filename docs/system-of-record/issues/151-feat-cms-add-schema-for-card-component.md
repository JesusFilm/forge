---
artifactType: issue
issueNumber: 151
issueTitle: "feat(cms): add schema for Card component"
issueUrl: "https://github.com/JesusFilm/forge/issues/151"
state: "CLOSED"
closedAt: "2026-03-06T02:13:04Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #151

## Background

Need a Card component schema so editors can create card-style content blocks (image, title, description, optional link) for use in grids or lists on the web.

## Expected outcome

- A Card component exists with attributes such as image, title, description, optional link/CTA, and any variant (e.g. default, featured).

## Acceptance criteria

- [ ] Card component JSON schema added in CMS.
- [ ] Attributes support at least title, description, optional media and link.
- [ ] Component registered and available in sections/containers; GraphQL regenerated if contracts change.

## Possible solution(s)

1. Add `components/shared/card.json` or `sections/card.json` with `title`, `description` (text), `media` (file or relation), `link` (optional), `variant` (optional enum).
2. Reuse for card grids by placing Card in a repeatable container or section.

## References

- `apps/cms/src/components/`
- `apps/cms/schema.graphql`

- Parent: #175 Epic A (CMS)
- Related (web implementation): #161

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
