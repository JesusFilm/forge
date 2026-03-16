---
artifactType: plan
sourceIssueNumber: 352
sourceIssueTitle: "fix(infra): add missing IAM list permissions for user deletion"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/352"
linkedPrs: []
---

# Plan Artifact: #352

## Objective

Terraform can successfully delete IAM users via the GitHub Actions apply workflow without 403 errors.

## Planned approach

Add both list actions to the existing `TerraformIamUserManagement` statement in `infra/aws/github/terraform.tf`. These are read-only list operations — they don't conflict with the `DenyIamCredentialMutation` deny statement.

## Validation

- [ ] `iam:ListUserPolicies` added to `TerraformIamUserManagement` statement
- [ ] `iam:ListAttachedUserPolicies` added to `TerraformIamUserManagement` statement
- [ ] Terraform apply succeeds for user deletion

## Source links

- Issue: [#352](https://github.com/JesusFilm/forge/issues/352)
- PRs:
- None
