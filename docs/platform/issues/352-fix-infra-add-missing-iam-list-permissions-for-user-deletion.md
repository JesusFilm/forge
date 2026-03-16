---
artifactType: issue
issueNumber: 352
issueTitle: "fix(infra): add missing IAM list permissions for user deletion"
issueUrl: "https://github.com/JesusFilm/forge/issues/352"
state: "CLOSED"
closedAt: "2026-03-11T01:12:36Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #352

## Background

The `forge-github-actions-terraform-apply-prod` role fails when Terraform tries to force-destroy IAM users (`*-dev-secrets`). The AWS provider calls `iam:ListUserPolicies` and `iam:ListAttachedUserPolicies` to enumerate policies before deletion, but neither action is in the role's policy.

```
Error: removing IAM User (tataihono-dev-secrets) policies: listing IAM User (tataihono-dev-secrets) policies:
operation error IAM: ListUserPolicies, api error AccessDenied:
User: arn:aws:sts::031374266475:assumed-role/forge-github-actions-terraform-apply-prod/GitHubActions
is not authorized to perform: iam:ListUserPolicies on resource: user tataihono-dev-secrets
```

## Expected outcome

Terraform can successfully delete IAM users via the GitHub Actions apply workflow without 403 errors.

## Acceptance criteria

- [ ] `iam:ListUserPolicies` added to `TerraformIamUserManagement` statement
- [ ] `iam:ListAttachedUserPolicies` added to `TerraformIamUserManagement` statement
- [ ] Terraform apply succeeds for user deletion

## Possible solution(s)

Add both list actions to the existing `TerraformIamUserManagement` statement in `infra/aws/github/terraform.tf`. These are read-only list operations — they don't conflict with the `DenyIamCredentialMutation` deny statement.

## References

- `infra/aws/github/terraform.tf` — role policy definition
- `infra/aws/iam/users/dev_secrets/main.tf` — affected IAM users

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
