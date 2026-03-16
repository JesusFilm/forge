---
artifactType: plan
sourceIssueNumber: 213
sourceIssueTitle: "fix(infra): grant terraform-apply role ssm:GetParameter for plan/apply"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/213"
linkedPrs: []
---

# Plan Artifact: #213

## Objective

- Terraform refresh/plan/apply can read (and where applicable write) SSM parameters under `/forge/*`.
- CI terraform-apply workflow completes without SSM permission errors.

## Planned approach

1. Add `ssm:*` to the existing "TerraformAwsServiceManagement" statement in `infra/aws/github/terraform.tf` (minimal change; consistent with other broad service permissions there).
2. Add a separate statement scoped to `arn:aws:ssm:*:*:parameter/forge/*` with only GetParameter, PutParameter, DeleteParameter, GetParameters if we want least privilege.

## Validation

- [ ] IAM policy for `forge-github-actions-terraform-apply-*` includes SSM actions needed for existing `aws_ssm_parameter` resources (at least GetParameter; full CRUD if Terraform manages them).
- [ ] Terraform plan/apply run in CI (e.g. on main) succeeds for infra/aws.

## Source links

- Issue: [#213](https://github.com/JesusFilm/forge/issues/213)
- PRs:
- None
