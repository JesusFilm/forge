---
artifactType: issue
issueNumber: 223
issueTitle: "docs(agent): update handle-pr-review response guidance"
issueUrl: "https://github.com/JesusFilm/forge/issues/223"
state: "CLOSED"
closedAt: "2026-03-06T03:04:09Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #223

## Background

The `.claude/commands/handle-pr-review.md` command documents how review feedback should be handled, but it does not clearly require a response for each comment explaining the outcome.

## Expected outcome

The command explicitly instructs agents to reply to review feedback with what was changed, a short reason when feedback is declined, or any blocking question that must be answered before proceeding.

## Acceptance criteria

- [ ] The command says each review comment needs a response.
- [ ] It requires a short explanation when feedback is not applied.
- [ ] It requires stating any open question that blocks progress.

## Possible solution(s)

1. Update the summary comment section to require per-comment responses with handled, declined, or blocked states.
2. Add guidance in the fix/post-summary steps so the response requirement is explicit before posting.

## References

- `.claude/commands/handle-pr-review.md`
- `AGENTS.md`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
