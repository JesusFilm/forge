---
artifactType: plan
sourceIssueNumber: 196
sourceIssueTitle: "fix(infra): grant Terraform apply role Secrets Manager permissions for RDS"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/196"
linkedPrs: []
---

# Plan Artifact: #196

## Objective

Terraform apply (terraform-apply workflow) can create RDS instances with managed master password; the apply role can create/update secrets in Secrets Manager as required by RDS.

## Planned approach

1. Add `secretsmanager:*` to the apply policy in `infra/aws/github/terraform.tf` (recommended).
2. Add a scoped statement for Secrets Manager with only CreateSecret, PutSecretValue, DescribeSecret, GetSecretValue, TagResource as needed.

## Validation

- [ ] GitHub Actions Terraform apply IAM policy includes `secretsmanager:*` (or minimal required actions).
- [ ] terraform-apply workflow succeeds when creating/updating platform RDS (e.g. forge-cms-prod-db).

## Source links

- Issue: [#196](https://github.com/JesusFilm/forge/issues/196)
- PRs:
- None
