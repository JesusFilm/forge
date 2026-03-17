---
artifactType: plan
sourceId: 420
sourceTitle: "docs(tooling): add agent safeguards for PR formatting and merged branches"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "docs(tooling): add agent safeguards for PR formatting and merged branches"

## Objective

Cursor rules and CLAUDE.md prevent both issues for all agents.

## Planned approach

1. Add formatting rule to `gh-workflow.mdc` and `CLAUDE.md`
2. Add merged-branch guard rule as always-apply

## Validation

- [ ] Rule: always use `gh` CLI with HEREDOC for multiline PR/issue bodies (never `\n` in MCP tool params)
- [ ] Rule: before committing, verify the current branch's PR is not already merged
- [ ] Mirrored in both `.cursor/rules/` and `CLAUDE.md`

## References

- PR #413 had broken body from `\n` escape sequences
- Docs commit `0ae1402` pushed to already-merged branch

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
