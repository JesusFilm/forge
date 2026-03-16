---
artifactType: plan
sourceIssueNumber: 356
sourceIssueTitle: "fix(infra): terraform apply role missing IAM permissions for user deletion"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/356"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #356

## Objective

Terraform apply can fully delete IAM users (including credential cleanup) via CI.

## Planned approach

1. Remove `iam:DeleteAccessKey` and `iam:DeleteLoginProfile` from the deny statement
2. Add `iam:ListAccessKeys` to the user management allow statement
3. Add `force_destroy = true` to the tataihono user resource

## Validation

- [ ] `iam:ListAccessKeys` added to `TerraformIamUserManagement`
- [ ] `iam:DeleteAccessKey` and `iam:DeleteLoginProfile` removed from `DenyIamCredentialMutation`
- [ ] `tataihono.nikora@jesusfilm.org` user resource has `force_destroy = true`
- [ ] Deny still blocks privilege-escalation actions (CreateAccessKey, CreateLoginProfile, AttachUserPolicy, etc.)

## Source links

- Issue: [#356](https://github.com/JesusFilm/forge/issues/356)
- PRs:
- None
