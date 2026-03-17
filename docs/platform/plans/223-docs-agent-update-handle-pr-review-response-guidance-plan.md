---
artifactType: plan
sourceId: 223
sourceTitle: "docs(agent): update handle-pr-review response guidance"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "docs(agent): update handle-pr-review response guidance"

## Objective

The command explicitly instructs agents to reply to review feedback with what was changed, a short reason when feedback is declined, or any blocking question that must be answered before proceeding.

## Planned approach

1. Update the summary comment section to require per-comment responses with handled, declined, or blocked states.
2. Add guidance in the fix/post-summary steps so the response requirement is explicit before posting.

## Validation

- [ ] The command says each review comment needs a response.
- [ ] It requires a short explanation when feedback is not applied.
- [ ] It requires stating any open question that blocks progress.

## References

- `.claude/commands/handle-pr-review.md`
- `AGENTS.md`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
