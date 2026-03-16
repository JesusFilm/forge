---
artifactType: issue
issueNumber: 177
issueTitle: "fix(terraform): allow OIDC assume role for GitHub Environments"
issueUrl: "https://github.com/JesusFilm/forge/issues/177"
state: "CLOSED"
closedAt: "2026-03-04T00:15:12Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #177

## Background

`terraform-apply` workflow uses job-level `environment: aws-prod` / `environment: aws-stage`. With that, GitHub issues OIDC tokens whose `sub` is `repo:JesusFilm/forge:environment:aws-*`, not `repo:JesusFilm/forge:ref:refs/heads/*`. The IAM trust policy for the apply role only allowed ref-based subjects, so AssumeRoleWithWebIdentity failed (e.g. [run 22648610964](https://github.com/JesusFilm/forge/actions/runs/22648610964)).

## Expected outcome

Apply-aws job can assume the Terraform apply role when the job runs with GitHub Environments (aws-stage / aws-prod).

## Acceptance criteria

- [ ] IAM trust policy for `forge-github-actions-terraform-apply-*` allows both `ref:refs/heads/*` and `environment:aws-*` subjects.
- [ ] terraform-apply workflow run (apply-aws) succeeds with OIDC.

## Possible solution(s)

Add `repo:JesusFilm/forge:environment:aws-${each.key}` to the assume-role policy `StringLike` condition in `infra/aws/github/terraform.tf` (keep existing ref-based value).

## References

- Failed run: https://github.com/JesusFilm/forge/actions/runs/22648610964/job/65642561788
- `infra/aws/github/terraform.tf`, `infra/aws/github/oidc.tf`
- `.github/workflows/terraform-apply.yml` (environment: aws-prod / aws-stage)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
