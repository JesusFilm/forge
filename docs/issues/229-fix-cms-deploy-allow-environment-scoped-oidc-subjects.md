---
artifactType: issue
issueNumber: 229
issueTitle: "fix(cms-deploy): allow environment-scoped OIDC subjects"
issueUrl: "https://github.com/JesusFilm/forge/issues/229"
state: "CLOSED"
closedAt: "2026-03-06T04:59:04Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #229

## Background

The merged `cms-deploy` fix switched the workflow to the `cms-stage` / `cms-prod` GitHub environments so it can read the environment-scoped `CMS_DEPLOY_ROLE_ARN` secret. The deploy job now reaches AWS auth, but the run still fails at `Configure AWS credentials` with `Not authorized to perform sts:AssumeRoleWithWebIdentity` because the CMS deploy IAM role trust policy only allows branch-ref OIDC subjects.

## Expected outcome

`cms-deploy` can assume the stage/prod deploy roles when the job is bound to the `cms-stage` / `cms-prod` GitHub environments, and pushes to `stage` / `main` no longer fail during AWS credential configuration.

## Acceptance criteria

- [ ] The CMS deploy IAM trust policy allows the GitHub OIDC subjects emitted by `cms-stage` and `cms-prod` environments.
- [ ] The existing branch guard for `stage` / `main` is preserved or equivalently enforced.
- [ ] Terraform remains the source of truth for the trust relationship.
- [ ] Validation covers the touched Terraform and workflow assumptions.

## Possible solution(s)

1. Extend `infra/aws/github/cms.tf` to allow both the existing branch ref subject and the environment subject for each environment.
2. Keep the workflow unchanged and fix the IAM/OIDC policy in Terraform so the environment-bound deploy job can authenticate.
3. Validate the resulting policy matches the `cms-deploy` workflow’s `environment` mapping for `stage` and `main`.

## References

- Failed run: https://github.com/JesusFilm/forge/actions/runs/22748399405/job/65977250065
- Previous fix: #226
- Merged PR: #227
- `.github/workflows/cms-deploy.yml`
- `infra/aws/github/cms.tf`
- `infra/github/actions.tf`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
