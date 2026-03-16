---
artifactType: issue
issueNumber: 213
issueTitle: "fix(infra): grant terraform-apply role ssm:GetParameter for plan/apply"
issueUrl: "https://github.com/JesusFilm/forge/issues/213"
state: "CLOSED"
closedAt: "2026-03-05T20:10:59Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #213

## Background

Terraform plan/apply in CI fails with AccessDeniedException: role `forge-github-actions-terraform-apply-prod` is not authorized for `ssm:GetParameter` on `/forge/github/*` and `/forge/vercel/api_token`. Those parameters are managed by modules (github/ssm.tf, vercel/ssm.tf); the apply role policy has no SSM actions.

## Expected outcome

- Terraform refresh/plan/apply can read (and where applicable write) SSM parameters under `/forge/*`.
- CI terraform-apply workflow completes without SSM permission errors.

## Acceptance criteria

- [ ] IAM policy for `forge-github-actions-terraform-apply-*` includes SSM actions needed for existing `aws_ssm_parameter` resources (at least GetParameter; full CRUD if Terraform manages them).
- [ ] Terraform plan/apply run in CI (e.g. on main) succeeds for infra/aws.

## Possible solution(s)

1. Add `ssm:*` to the existing "TerraformAwsServiceManagement" statement in `infra/aws/github/terraform.tf` (minimal change; consistent with other broad service permissions there).
2. Add a separate statement scoped to `arn:aws:ssm:*:*:parameter/forge/*` with only GetParameter, PutParameter, DeleteParameter, GetParameters if we want least privilege.

## References

- `infra/aws/github/terraform.tf` (data.aws_iam_policy_document.github_actions_terraform_apply)
- `infra/github/ssm.tf`, `infra/aws/vercel/ssm.tf` (resources reading/managing SSM)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
