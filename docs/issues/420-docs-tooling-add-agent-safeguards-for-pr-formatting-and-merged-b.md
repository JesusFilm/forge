---
artifactType: issue
issueNumber: 420
issueTitle: "docs(tooling): add agent safeguards for PR formatting and merged branches"
issueUrl: "https://github.com/JesusFilm/forge/issues/420"
state: "CLOSED"
closedAt: "2026-03-12T02:38:04Z"
labels: ["tooling", "docs"]
linkedPrs: []
---

# Issue Artifact: #420

## Background

Two agent workflow issues discovered:

1. MCP tool string parameters render `\n` as literal text in PR/issue bodies, producing broken markdown.
2. Agents can commit to branches whose PRs have already been merged, pushing orphaned changes.

## Expected outcome

Cursor rules and CLAUDE.md prevent both issues for all agents.

## Acceptance criteria

- [ ] Rule: always use `gh` CLI with HEREDOC for multiline PR/issue bodies (never `\n` in MCP tool params)
- [ ] Rule: before committing, verify the current branch's PR is not already merged
- [ ] Mirrored in both `.cursor/rules/` and `CLAUDE.md`

## Possible solution(s)

1. Add formatting rule to `gh-workflow.mdc` and `CLAUDE.md`
2. Add merged-branch guard rule as always-apply

## References

- PR #413 had broken body from `\n` escape sequences
- Docs commit `0ae1402` pushed to already-merged branch

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
