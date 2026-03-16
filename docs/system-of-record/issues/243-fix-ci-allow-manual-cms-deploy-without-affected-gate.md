---
artifactType: issue
issueNumber: 243
issueTitle: "fix(ci): allow manual cms deploy without affected gate"
issueUrl: "https://github.com/JesusFilm/forge/issues/243"
state: "CLOSED"
closedAt: "2026-03-06T05:31:34Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #243

## Background

The `cms-deploy` workflow currently only runs on pushes to `stage` and `main`, and its deploy job is gated by the `affected` job output. That makes it awkward to trigger intentionally from GitHub Actions for an environment deploy, even when an operator explicitly wants to run the workflow.

## Expected outcome

`cms-deploy` can be started manually from GitHub Actions, and manual runs are not blocked by the affected-detection gate.

## Acceptance criteria

- [ ] `cms-deploy` supports `workflow_dispatch`
- [ ] Manual `workflow_dispatch` runs do not depend on the affected result to deploy
- [ ] Push-triggered runs still keep the existing affected-based deploy gate

## Possible solution(s)

1. Add `workflow_dispatch` to the workflow triggers and bypass the affected condition when `github.event_name == 'workflow_dispatch'`.
2. Keep the `affected` job for push events, but make the deploy job condition accept either a manual dispatch or an affected CMS package.

## References

- Closed related issue: #241
- Workflow: `.github/workflows/cms-deploy.yml`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
