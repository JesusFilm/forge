---
artifactType: plan
sourceIssueNumber: 226
sourceIssueTitle: "fix(cms-deploy): use environment deploy role secret"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/226"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #226

## Objective

`cms-deploy` resolves the deploy role ARN from the correct GitHub environment secret and can authenticate to AWS for stage and prod deploys.

## Planned approach

1. Add an `environment` value to the deploy job based on branch and bind the job to that GitHub Actions environment.
2. Replace the role lookup with `secrets.CMS_DEPLOY_ROLE_ARN` and keep the existing validation step.
3. Optionally expose the resolved environment name from the vars step for reuse in comments/logs.

## Validation

- [ ] `cms-deploy` selects `cms-stage` for `stage` and `cms-prod` for `main`.
- [ ] The deploy job reads `CMS_DEPLOY_ROLE_ARN` from the bound environment.
- [ ] The misleading repo-level `AWS_DEPLOY_ROLE_ARN*` fallback is removed.
- [ ] Validation covers the touched workflow logic.

## Source links

- Issue: [#226](https://github.com/JesusFilm/forge/issues/226)
- PRs:
- None
