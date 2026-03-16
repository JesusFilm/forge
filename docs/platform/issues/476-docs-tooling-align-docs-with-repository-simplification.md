---
artifactType: issue
issueNumber: 476
issueTitle: "docs(tooling): align docs with repository simplification"
issueUrl: "https://github.com/JesusFilm/forge/issues/476"
state: "CLOSED"
closedAt: "2026-03-16T02:38:42Z"
labels: ["tooling", "docs"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #476

## Background

Several bounded-context placeholders were removed (`apps/ai-orchestrator`, `packages/ai-config`, `packages/content-models`) and CODEOWNERS was simplified, but root/project docs still imply the old structure.

## Expected outcome

Repository docs accurately describe the current simplified layout and ownership model.

## Acceptance criteria

- [ ] Root docs no longer reference removed packages/apps as active contexts.
- [ ] Documentation reflects current CODEOWNERS ownership boundaries.
- [ ] Core workflow guidance remains accurate after simplification.

## Possible solution(s)

1. Update root docs (`README.md`, relevant architecture docs, and agent guidance) to remove stale references.
2. Keep descriptions minimal and point to currently maintained contexts only.

## References

- `CODEOWNERS`
- Local working tree deletions for ai-orchestrator/ai-config/content-models

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
