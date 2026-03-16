---
artifactType: plan
sourceIssueNumber: 243
sourceIssueTitle: "fix(ci): allow manual cms deploy without affected gate"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/243"
linkedPrs: []
---

# Plan Artifact: #243

## Objective

`cms-deploy` can be started manually from GitHub Actions, and manual runs are not blocked by the affected-detection gate.

## Planned approach

1. Add `workflow_dispatch` to the workflow triggers and bypass the affected condition when `github.event_name == 'workflow_dispatch'`.
2. Keep the `affected` job for push events, but make the deploy job condition accept either a manual dispatch or an affected CMS package.

## Validation

- [ ] `cms-deploy` supports `workflow_dispatch`
- [ ] Manual `workflow_dispatch` runs do not depend on the affected result to deploy
- [ ] Push-triggered runs still keep the existing affected-based deploy gate

## Source links

- Issue: [#243](https://github.com/JesusFilm/forge/issues/243)
- PRs:
- None
