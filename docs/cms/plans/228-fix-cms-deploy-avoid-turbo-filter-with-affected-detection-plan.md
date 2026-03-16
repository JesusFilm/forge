---
artifactType: plan
sourceIssueNumber: 228
sourceIssueTitle: "fix(cms-deploy): avoid turbo filter with affected detection"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/228"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #228

## Objective

`cms-deploy` detects affected workspaces successfully and deploys only when `@forge/cms` is actually part of the affected set.

## Planned approach

1. Run Turbo with `--affected --dry-run=json` and inspect returned tasks for `@forge/cms`.
2. Keep the existing fallback path for true Turbo/jq failures.
3. Align the implementation with the existing affected detection pattern already used in `ci.yml`.

## Validation

- [ ] `cms-deploy` no longer combines Turbo `--filter` with `--affected`.
- [ ] The workflow still sets `cms=true` when affected detection genuinely fails, to avoid false negatives.
- [ ] Validation covers the touched workflow logic.

## Source links

- Issue: [#228](https://github.com/JesusFilm/forge/issues/228)
- PRs:
- None
