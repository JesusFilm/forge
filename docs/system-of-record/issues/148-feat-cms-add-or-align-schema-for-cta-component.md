---
artifactType: issue
issueNumber: 148
issueTitle: "feat(cms): add or align schema for CTA component"
issueUrl: "https://github.com/JesusFilm/forge/issues/148"
state: "CLOSED"
closedAt: "2026-03-05T03:46:41Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #148

## Background

CTA (call-to-action) blocks need a clear schema so editors can configure buttons/links and optional copy. An existing `sections/cta.json` may need to be formalized or extended.

## Expected outcome

- CTA component has a defined schema: at least label, link (or URL), optional heading/description, and any variant (e.g. primary/secondary) for the web app.

## Acceptance criteria

- [ ] CTA component schema is defined or updated in CMS (e.g. `apps/cms/src/components/sections/cta.json`).
- [ ] Attributes cover label, link/URL, optional heading/description and variant.
- [ ] Component registered and available; GraphQL regenerated if contracts change.

## Possible solution(s)

1. Review `sections/cta.json`; add missing fields (e.g. `variant`, `description`) and ensure link structure matches web.
2. If CTA is used inside other components, ensure it is registered as a nested component where needed.

## References

- `apps/cms/src/components/sections/cta.json`
- `apps/cms/schema.graphql`

- Parent: #175 Epic A (CMS)
- Related (web implementation): #158

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
