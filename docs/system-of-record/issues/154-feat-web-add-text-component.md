---
artifactType: issue
issueNumber: 154
issueTitle: "feat(web): add Text component"
issueUrl: "https://github.com/JesusFilm/forge/issues/154"
state: "CLOSED"
closedAt: "2026-03-16T02:45:00Z"
labels: ["feat", "web"]
linkedPrs: []
---

# Issue Artifact: #154

## Background

The CMS will expose Text blocks (see feat(cms) schema issue). The web app needs a Text component that renders richtext or plain text (headings, paragraphs, lists) with optional heading level and variants.

## Expected outcome

- A Text component in `apps/web` that consumes Text block data and renders content with correct semantics and styling (including any richtext blocks if used).

## Acceptance criteria

- [ ] Text component implemented and wired to API/GraphQL shape.
- [ ] Renders content with appropriate HTML semantics (headings, paragraphs, lists).
- [ ] Supports optional heading and variant from schema; accessible and styled per design system.
- [ ] Integrated into dynamic zone or section rendering.

## Possible solution(s)

1. Add `apps/web/src/components/shared/Text.tsx` or `sections/Text.tsx`; use Strapi richtext renderer or map blocks to React components if blocks are used.
2. Reuse existing typography/richtext components; ensure block types (heading, paragraph, list) are handled.

## References

- Resolves/Implements schema: #144 (feat(cms): add schema for Text component)
- `apps/web` component structure

- Parent: #176 Epic B (Web)
- Related (CMS schema): #144

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
