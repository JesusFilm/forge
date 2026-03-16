---
artifactType: plan
sourceIssueNumber: 223
sourceIssueTitle: "docs(agent): update handle-pr-review response guidance"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/223"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #223

## Objective

The command explicitly instructs agents to reply to review feedback with what was changed, a short reason when feedback is declined, or any blocking question that must be answered before proceeding.

## Planned approach

1. Update the summary comment section to require per-comment responses with handled, declined, or blocked states.
2. Add guidance in the fix/post-summary steps so the response requirement is explicit before posting.

## Validation

- [ ] The command says each review comment needs a response.
- [ ] It requires a short explanation when feedback is not applied.
- [ ] It requires stating any open question that blocks progress.

## Source links

- Issue: [#223](https://github.com/JesusFilm/forge/issues/223)
- PRs:
- None
