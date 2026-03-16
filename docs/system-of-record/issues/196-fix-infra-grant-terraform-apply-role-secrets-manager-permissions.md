---
artifactType: issue
issueNumber: 196
issueTitle: "fix(infra): grant Terraform apply role Secrets Manager permissions for RDS"
issueUrl: "https://github.com/JesusFilm/forge/issues/196"
state: "CLOSED"
closedAt: "2026-03-04T09:33:44Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #196

## Background

Terraform apply fails when creating RDS with `manage_master_user_password = true` because RDS creates the master password secret in AWS Secrets Manager using the caller's credentials. The GitHub Actions Terraform apply role had `rds:*` but no `secretsmanager:*`, causing: `AccessDenied: The user isn't authorized to create a secret in AWS Secrets Manager`.

## Expected outcome

Terraform apply (terraform-apply workflow) can create RDS instances with managed master password; the apply role can create/update secrets in Secrets Manager as required by RDS.

## Acceptance criteria

- [ ] GitHub Actions Terraform apply IAM policy includes `secretsmanager:*` (or minimal required actions).
- [ ] terraform-apply workflow succeeds when creating/updating platform RDS (e.g. forge-cms-prod-db).

## Possible solution(s)

1. Add `secretsmanager:*` to the apply policy in `infra/aws/github/terraform.tf` (recommended).
2. Add a scoped statement for Secrets Manager with only CreateSecret, PutSecretValue, DescribeSecret, GetSecretValue, TagResource as needed.

## References

- terraform-apply run: fix(infra): platform db_engine_version default to 16.8 (#195) #6
- `infra/aws/modules/cms/main.tf` uses `manage_master_user_password = true`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
