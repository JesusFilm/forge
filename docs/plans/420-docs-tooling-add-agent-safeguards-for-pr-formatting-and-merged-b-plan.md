---
artifactType: plan
sourceIssueNumber: 420
sourceIssueTitle: "docs(tooling): add agent safeguards for PR formatting and merged branches"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/420"
linkedPrs: []
---

# Plan Artifact: #420

## Objective

Cursor rules and CLAUDE.md prevent both issues for all agents.

## Planned approach

1. Add formatting rule to `gh-workflow.mdc` and `CLAUDE.md`
2. Add merged-branch guard rule as always-apply

## Validation

- [ ] Rule: always use `gh` CLI with HEREDOC for multiline PR/issue bodies (never `\n` in MCP tool params)
- [ ] Rule: before committing, verify the current branch's PR is not already merged
- [ ] Mirrored in both `.cursor/rules/` and `CLAUDE.md`

## Source links

- Issue: [#420](https://github.com/JesusFilm/forge/issues/420)
- PRs:
- None
