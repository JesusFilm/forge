---
artifactType: plan
sourceId: 229
sourceTitle: "fix(cms-deploy): allow environment-scoped OIDC subjects"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms-deploy): allow environment-scoped OIDC subjects"

## Objective

`cms-deploy` can assume the stage/prod deploy roles when the job is bound to the `cms-stage` / `cms-prod` GitHub environments, and pushes to `stage` / `main` no longer fail during AWS credential configuration.

## Planned approach

1. Extend `infra/aws/github/cms.tf` to allow both the existing branch ref subject and the environment subject for each environment.
2. Keep the workflow unchanged and fix the IAM/OIDC policy in Terraform so the environment-bound deploy job can authenticate.
3. Validate the resulting policy matches the `cms-deploy` workflow’s `environment` mapping for `stage` and `main`.

## Validation

- [ ] The CMS deploy IAM trust policy allows the GitHub OIDC subjects emitted by `cms-stage` and `cms-prod` environments.
- [ ] The existing branch guard for `stage` / `main` is preserved or equivalently enforced.
- [ ] Terraform remains the source of truth for the trust relationship.
- [ ] Validation covers the touched Terraform and workflow assumptions.

## References

- Failed run: https://github.com/JesusFilm/forge/actions/runs/22748399405/job/65977250065
- Previous fix: #226
- Merged PR: #227
- `.github/workflows/cms-deploy.yml`
- `infra/aws/github/cms.tf`
- `infra/github/actions.tf`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
