---
artifactType: issue
issueNumber: 356
issueTitle: "fix(infra): terraform apply role missing IAM permissions for user deletion"
issueUrl: "https://github.com/JesusFilm/forge/issues/356"
state: "CLOSED"
closedAt: "2026-03-11T01:19:51Z"
labels: ["fix", "infra"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #356

## Background

The `forge-github-actions-terraform-apply-prod` role cannot delete IAM users because:

1. `DenyIamCredentialMutation` blocks `iam:DeleteAccessKey` and `iam:DeleteLoginProfile` — Terraform needs these to clean up credentials before deleting users.
2. `TerraformIamUserManagement` is missing `iam:ListAccessKeys` — Terraform needs this to enumerate keys for `force_destroy = true` users.
3. `tataihono.nikora@jesusfilm.org` lacks `force_destroy = true`, so Terraform doesn't attempt login profile cleanup.

Errors seen in CI:

- `DeleteConflict: Cannot delete entity, must delete login profile first` (tataihono.nikora)
- `AccessDenied: iam:ListAccessKeys` (all dev-secrets users)

## Expected outcome

Terraform apply can fully delete IAM users (including credential cleanup) via CI.

## Acceptance criteria

- [ ] `iam:ListAccessKeys` added to `TerraformIamUserManagement`
- [ ] `iam:DeleteAccessKey` and `iam:DeleteLoginProfile` removed from `DenyIamCredentialMutation`
- [ ] `tataihono.nikora@jesusfilm.org` user resource has `force_destroy = true`
- [ ] Deny still blocks privilege-escalation actions (CreateAccessKey, CreateLoginProfile, AttachUserPolicy, etc.)

## Possible solution(s)

1. Remove `iam:DeleteAccessKey` and `iam:DeleteLoginProfile` from the deny statement
2. Add `iam:ListAccessKeys` to the user management allow statement
3. Add `force_destroy = true` to the tataihono user resource

## References

- `infra/aws/github/terraform.tf` — role policy
- `infra/aws/iam/users/tataihono/main.tf` — user resource
- `infra/aws/iam/users/dev_secrets/main.tf` — dev-secrets users

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
