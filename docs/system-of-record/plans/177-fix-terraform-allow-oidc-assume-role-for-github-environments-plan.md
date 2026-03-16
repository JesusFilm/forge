---
artifactType: plan
sourceIssueNumber: 177
sourceIssueTitle: "fix(terraform): allow OIDC assume role for GitHub Environments"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/177"
linkedPrs: []
---

# Plan Artifact: #177

## Objective

Apply-aws job can assume the Terraform apply role when the job runs with GitHub Environments (aws-stage / aws-prod).

## Planned approach

Add `repo:JesusFilm/forge:environment:aws-${each.key}` to the assume-role policy `StringLike` condition in `infra/aws/github/terraform.tf` (keep existing ref-based value).

## Validation

- [ ] IAM trust policy for `forge-github-actions-terraform-apply-*` allows both `ref:refs/heads/*` and `environment:aws-*` subjects.
- [ ] terraform-apply workflow run (apply-aws) succeeds with OIDC.

## Source links

- Issue: [#177](https://github.com/JesusFilm/forge/issues/177)
- PRs:
- None
