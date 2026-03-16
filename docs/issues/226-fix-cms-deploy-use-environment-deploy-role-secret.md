---
artifactType: issue
issueNumber: 226
issueTitle: "fix(cms-deploy): use environment deploy role secret"
issueUrl: "https://github.com/JesusFilm/forge/issues/226"
state: "CLOSED"
closedAt: "2026-03-06T03:58:41Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #226

## Background

The `cms-deploy` workflow is failing on `main`/`stage` before AWS auth with `Validate role ARN is configured`. Infra provisions the deploy role as the environment-scoped secret `CMS_DEPLOY_ROLE_ARN`, but the workflow currently reads `AWS_DEPLOY_ROLE_ARN_*` and does not bind the deploy job to the `cms-stage` / `cms-prod` GitHub environments.

## Expected outcome

`cms-deploy` resolves the deploy role ARN from the correct GitHub environment secret and can authenticate to AWS for stage and prod deploys.

## Acceptance criteria

- [ ] `cms-deploy` selects `cms-stage` for `stage` and `cms-prod` for `main`.
- [ ] The deploy job reads `CMS_DEPLOY_ROLE_ARN` from the bound environment.
- [ ] The misleading repo-level `AWS_DEPLOY_ROLE_ARN*` fallback is removed.
- [ ] Validation covers the touched workflow logic.

## Possible solution(s)

1. Add an `environment` value to the deploy job based on branch and bind the job to that GitHub Actions environment.
2. Replace the role lookup with `secrets.CMS_DEPLOY_ROLE_ARN` and keep the existing validation step.
3. Optionally expose the resolved environment name from the vars step for reuse in comments/logs.

## References

- Failed run: https://github.com/JesusFilm/forge/actions/runs/22748025036/job/65976097934
- `.github/workflows/cms-deploy.yml`
- `infra/github/actions.tf`
- `infra/github/README.md`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
